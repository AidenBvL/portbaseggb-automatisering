/*
 * GGB invullen met AI – gedeelde logica (browser + Node, geen dependencies).
 *
 *  - SCHEMA      JSON-schema voor de gestructureerde uitvoer van Claude: alle
 *                velden van het Portbase-formulier "New declaration".
 *  - SYSTEM      instructies voor het uitlezen van HC / documenten.
 *  - normaliseer controleert en normaliseert het AI-resultaat (datums, landcodes,
 *                GN-codes, gewichten, containernummers) en voegt waarschuwingen toe.
 *  - naarDeclaratie zet het resultaat om naar het declaratie-object van de
 *                regel-engine, zodat de documentcheck direct kan draaien.
 *
 * De eigenlijke API-aanroep (Anthropic SDK) staat in ai/src/extract.mjs en wordt
 * gebundeld naar extension/ai.bundle.js.
 */
(function (root) {
  'use strict';

  /* Vaste keuzelijst van Portbase (dialoog "Border control post", land NL;
   * stand nov. 2026). Bij wijzigingen hier bijwerken. Het inspectiecentrum
   * vult de declarant zelf in en wordt bewust niet door de AI voorgesteld. */
  var BCP_NL = [
    ['Amsterdam', 'NLAMS1'], ['Amsterdam Airport Schiphol', 'NLAMS4'], ['Eemshaven', 'NLEEM1'], ['Harlingen', 'NLHAR1'],
    ['Maastricht', 'NLMST4'], ['Rotterdam', 'NLRTM1'], ['Vlissingen', 'NLVLI1']
  ].map(function (x) { return { naam: x[0], code: x[1], label: x[0] + ' (' + x[1] + ')' }; });

  function lijstNorm(v) { return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

  /** Zoekt een waarde ("Rotterdam", "NLRTM1", "Rotterdam (NLRTM1)", "ECT Delta") in een lijst; null als niet eenduidig. */
  function zoekInLijst(lijst, waarde) {
    var v = lijstNorm(waarde);
    if (!v) return null;
    var exact = lijst.filter(function (e) { return lijstNorm(e.label) === v || lijstNorm(e.naam) === v || lijstNorm(e.code) === v; });
    if (exact.length === 1) return exact[0];
    var code = lijst.filter(function (e) { return e.code.length > 3 && new RegExp('(^| )' + lijstNorm(e.code) + '( |$)').test(v); });
    if (code.length === 1) return code[0];
    var deel = lijst.filter(function (e) { var n = lijstNorm(e.naam); return v.length >= 3 && (n.indexOf(v) >= 0 || v.indexOf(n) >= 0); });
    if (deel.length === 1) return deel[0];
    return null;
  }

  var DOC_CODES = ['HC', 'LAB', 'CATCH', 'OFFCERT', 'PRIVATT', 'CITES', 'COI', 'PHYTO', 'COMM', 'OTHER'];
  var ZEKERHEID = ['hoog', 'middel', 'laag'];

  function veld(beschrijving, extra) {
    var waarde = { type: 'string', description: beschrijving };
    if (extra && extra.enum) waarde.enum = extra.enum;
    return {
      type: 'object',
      additionalProperties: false,
      required: ['waarde', 'bron', 'zekerheid'],
      properties: {
        waarde: waarde,
        bron: { type: 'string', description: 'Waar de waarde vandaan komt, bijv. "HC vak I.1" of "Factuur p.1". Leeg als onbekend.' },
        zekerheid: { type: 'string', enum: ZEKERHEID }
      }
    };
  }

  function obj(props) {
    return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props };
  }
  function str(d, e) { var s = { type: 'string', description: d }; if (e) s.enum = e; return s; }

  var SCHEMA = obj({
    declaratieType: veld('"PRD" voor producten van dierlijke oorsprong (CHED-P), "LNV" voor levensmiddelen/diervoeders van niet-dierlijke oorsprong (CHED-D).', { enum: ['PRD', 'LNV', ''] }),
    bol: veld('Bill of lading number (I.13), zoals op B/L of HC. Leeg als niet in de documenten.'),
    bestemming: veld('Destination (I.20-25): bijv. "Import", "Transit", "Transhipment", "Warehouse". Bij twijfel "Import".'),
    exporteur: obj({
      naam: str('Naam exporteur/afzender (HC vak I.1)'),
      adres: str('Volledig adres op één regel'),
      land: str('ISO 3166-1 alpha-2 landcode'),
      bron: str('Bron'),
      zekerheid: str('Zekerheid', ZEKERHEID)
    }),
    importeur: obj({
      naam: str('Naam importeur/ontvanger (HC vak I.5/I.6)'),
      adres: str('Volledig adres op één regel'),
      land: str('ISO 3166-1 alpha-2 landcode'),
      bron: str('Bron'),
      zekerheid: str('Zekerheid', ZEKERHEID)
    }),
    grenscontrolepost: veld('Border control post (I.4) uit de Portbase-lijst. Afleiden uit HC vak I.4 / haven van binnenkomst (zeevracht via Rotterdam: "Rotterdam (NLRTM1)", luchtvracht Schiphol: "Amsterdam Airport Schiphol (NLAMS4)").',
      { enum: BCP_NL.map(function (e) { return e.label; }).concat(['']) }),
    plaatsBestemming: veld('Place of destination (I.7): naam + adres van de plaats van bestemming.'),
    landOorsprong: veld('Country of origin (I.11), ISO alpha-2.'),
    landLading: veld('Country of loading (I.14), ISO alpha-2 (land van de laadhaven).'),
    gecertificeerdVoor: veld('Goods certified as or for (I.18).', { enum: ['Human consumption', 'Feedingstuff', 'Pharmaceutical use', 'Technical use', 'Further process', 'Other', ''] }),
    transportconditie: veld('Transport conditions (I.16).', { enum: ['Ambient', 'Chilled', 'Frozen', ''] }),
    vervoermiddel: veld('Means of transport (I.13).', { enum: ['Vessel', 'Airplane', 'Railway', 'Road vehicle', ''] }),
    vervoermiddelNaam: veld('Name / identification (I.13): naam schip/vlucht + eventueel IMO/reisnummer.'),
    vervoermiddelNationaliteit: veld('Nationality (I.13): vlaggenstaat, ISO alpha-2.'),
    aankomstDatum: veld('Expected date of arrival (I.10), formaat dd-mm-jjjj. Leeg als niet in de documenten.'),
    aankomstTijd: veld('Verwachte aankomsttijd, formaat uu:mm. Leeg als onbekend.'),
    containers: {
      type: 'array',
      description: 'Transport equipment (I.17): containers met zegelnummer.',
      items: obj({ containernummer: str('Containernummer, bijv. HLBU9066045'), zegelnummer: str('Zegelnummer'), bron: str('Bron') })
    },
    documenten: {
      type: 'array',
      description: 'Document(s) (I.9): elk aangeleverd document dat in de GGB opgenomen moet worden.',
      items: obj({
        type: str('Documentcode: HC gezondheidscertificaat, LAB gecertificeerd labrapport/analyseverslag, CATCH vangstcertificaat, OFFCERT officieel certificaat Ver. 2019/1793, PRIVATT private attestation, CITES, COI biologisch, PHYTO fytosanitair, COMM handelsdocument (factuur, paklijst, B/L), OTHER.', DOC_CODES),
        identificatie: str('Certificaat-/documentnummer precies zoals op het document'),
        datumAfgifte: str('Datum van afgifte, dd-mm-jjjj'),
        landAfgifte: str('Land van afgifte, ISO alpha-2'),
        inrichtingOorsprong: str('Establishment of origin: naam en erkenningsnummer, indien vermeld'),
        verwijstNaar: str('Nummer van het document waarnaar dit document verwijst (bijv. het HC-nummer in een labrapport). Leeg als geen verwijzing.'),
        bestand: str('Bestandsnaam van het geüploade bestand waar dit document in staat'),
        zekerheid: str('Zekerheid', ZEKERHEID)
      })
    },
    goederen: {
      type: 'array',
      description: 'Goods item(s) (I.31-I.34): één item per GN-code / partij zoals op het HC.',
      items: obj({
        gnCode: str('GN-code (I.31), 8 cijfers zonder punten/spaties, bijv. 03061792'),
        omschrijving: str('Goederenomschrijving (I.31), incl. soort (wetenschappelijke naam) indien vermeld'),
        brutoGewicht: str('Brutogewicht in kg, alleen cijfers met punt als decimaalteken'),
        nettoGewicht: str('Nettogewicht in kg, alleen cijfers met punt als decimaalteken'),
        aantalColli: str('Aantal verpakkingen (I.32), alleen cijfers'),
        verpakkingstype: str('Package type (I.32), bijv. Carton, Bag, Box, Pallet'),
        batchnummer: str('Batchnummer / lotnummer (I.34)'),
        aanvullendeEenheden: str('Additional units (I.33), indien vermeld'),
        erkenningsnummer: str('Activity / approval number (I.15): erkenningsnummer van de inrichting van oorsprong, bijv. "1234" of "IN-1234"'),
        wetenschappelijkeNaam: str('Soort, wetenschappelijke naam zoals op het HC (vak I.28 "Species"), bijv. "Penaeus vannamei" of "Gallus gallus". Leeg als niet vermeld.'),
        aardProduct: str('Aard/behandeling van het product zoals op het HC (vak I.28 "Nature of commodity", "Treatment type", "Type of product"), bijv. "Farmed, frozen", "Wild caught", "Meat preparation, frozen", "Shelf-stable composite product". Letterlijk overnemen.'),
        containernummer: str('Container waarin dit item zit, indien bekend'),
        bron: str('Bron'),
        zekerheid: str('Zekerheid', ZEKERHEID)
      })
    },
    waarschuwingen: {
      type: 'array',
      description: 'Tegenstrijdigheden tussen documenten, ontbrekende of onleesbare gegevens, en punten die de declarant moet controleren. In het Nederlands.',
      items: { type: 'string' }
    }
  });

  var SYSTEM = [
    'Je bent een ervaren douane-/NVWA-declarant in de haven van Rotterdam. Je leest de documenten van een zending',
    '(gezondheidscertificaat/HC, labrapport, vangstcertificaat, factuur, paklijst, B/L, enz.) en bepaalt wat er in de',
    'GGB (Gemeenschappelijk Gezondheidsdocument van Binnenkomst, CHED-P of CHED-D) in Portbase moet worden ingevuld.',
    '',
    'Regels:',
    '- Neem waarden letterlijk over uit de documenten. Verzin niets: als een gegeven niet in de documenten staat, laat het',
    '  veld leeg ("") en zet zekerheid op "laag". Afleidingen (bijv. CHED-type uit de GN-code, landcode uit een adres,',
    '  grenscontrolepost uit de haven van binnenkomst) zijn toegestaan, maar vermeld dat in "bron" en gebruik "middel".',
    '- Het HC is leidend voor de GGB-velden (deel I van het certificaat komt overeen met de vakken I.x in Portbase).',
    '  Gebruik factuur, paklijst en B/L voor B/L-nummer, containers, zegels, colli en gewichten als die niet op het HC staan.',
    '- Datums altijd als dd-mm-jjjj, tijden als uu:mm, landen als ISO alpha-2, GN-codes als 8 cijfers zonder scheidingstekens,',
    '  gewichten in kg met een punt als decimaalteken.',
    '- Neem elk aangeleverd certificaat of rapport op onder "documenten" (één regel per document) met het nummer precies',
    '  zoals gedrukt. Vermeld bij een labrapport naar welk HC-nummer het verwijst, als dat erin staat.',
    '- Maak één goederenitem per GN-code/partij zoals op het HC. Tel gewichten niet zelf op tenzij nodig, en meld het dan.',
    '- Neem per goederenitem de wetenschappelijke naam en de aard/behandeling van het product (vak I.28) letterlijk over;',
    '  Portbase heeft per GN-code en soort meerdere producttypes en de declarant kiest daarmee het juiste.',
    '- Meld onder "waarschuwingen" elke tegenstrijdigheid (bijv. ander gewicht of containernummer op HC dan op B/L),',
    '  onleesbare delen en gegevens die de declarant zelf moet aanvullen.'
  ].join('\n');

  /* ---------------- normalisatie ---------------- */

  function s(v) { return v == null ? '' : String(v).replace(/\s+/g, ' ').trim(); }

  var MAANDEN = { jan: 1, feb: 2, mar: 3, mrt: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** Datum naar dd-mm-jjjj; geeft '' terug als het niet te herkennen is. */
  function normDatum(v) {
    v = s(v);
    if (!v) return '';
    var m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/); // ISO
    if (m) return geldig(+m[3], +m[2], +m[1]);
    m = v.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})/); // dd-mm-jjjj
    if (m) return geldig(+m[1], +m[2], jaar(m[3]));
    m = v.match(/^(\d{1,2})[-/. ]+([A-Za-z]{3})[A-Za-z]*\.?[-/. ,]+(\d{2,4})/); // 07 Aug 2026
    if (m && MAANDEN[m[2].toLowerCase()]) return geldig(+m[1], MAANDEN[m[2].toLowerCase()], jaar(m[3]));
    m = v.match(/^([A-Za-z]{3})[A-Za-z]*\.?[ ]+(\d{1,2}),?[ ]+(\d{4})/); // Aug 7, 2026
    if (m && MAANDEN[m[1].toLowerCase()]) return geldig(+m[2], MAANDEN[m[1].toLowerCase()], +m[3]);
    return '';
  }
  function jaar(j) { j = +j; return j < 100 ? 2000 + j : j; }
  function geldig(d, m, j) {
    var dt = new Date(Date.UTC(j, m - 1, d));
    if (dt.getUTCFullYear() !== j || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
    return pad(d) + '-' + pad(m) + '-' + j;
  }

  function normTijd(v) {
    var m = s(v).match(/^(\d{1,2})[:.h](\d{2})/);
    if (!m || +m[1] > 23 || +m[2] > 59) return '';
    return pad(+m[1]) + ':' + m[2];
  }

  function normLand(v) {
    var m = s(v).toUpperCase().match(/^[A-Z]{2}$/) || s(v).toUpperCase().match(/^([A-Z]{2})\b/);
    return m ? (m[1] || m[0]) : '';
  }

  function normGn(v) { return s(v).replace(/[^0-9]/g, ''); }

  /** Getal als "13447.5": verwijdert duizendtallen, komma als decimaal. */
  function normGetal(v) {
    v = s(v).replace(/\s|kg|kgs/gi, '');
    if (!v) return '';
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, '');
    else v = v.replace(',', '.');
    return /^\d+(\.\d+)?$/.test(v) ? String(+v) : '';
  }

  /** ISO 6346-controlecijfer van een containernummer. */
  function containerGeldig(nr) {
    nr = s(nr).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z]{4}\d{7}$/.test(nr)) return false;
    var som = 0;
    for (var i = 0; i < 10; i++) {
      var c = nr.charAt(i), w;
      if (/\d/.test(c)) w = +c;
      else {
        w = c.charCodeAt(0) - 55; // A=10
        w += Math.floor((w - 1) / 10); // 11, 22, 33 overslaan
      }
      som += w * Math.pow(2, i);
    }
    return (som % 11) % 10 === +nr.charAt(10);
  }

  function normVeld(v) {
    v = v || {};
    return { waarde: s(v.waarde), bron: s(v.bron), zekerheid: ZEKERHEID.indexOf(v.zekerheid) >= 0 ? v.zekerheid : 'laag' };
  }

  /**
   * Normaliseert het ruwe AI-resultaat. Geeft altijd een volledig object terug
   * (ook bij ontbrekende velden) met extra waarschuwingen voor wat niet klopt.
   */
  function normaliseer(raw) {
    raw = raw || {};
    var w = (raw.waarschuwingen || []).map(s).filter(Boolean);
    var r = {};
    ['declaratieType', 'bol', 'bestemming', 'grenscontrolepost', 'plaatsBestemming', 'landOorsprong', 'landLading',
     'gecertificeerdVoor', 'transportconditie', 'vervoermiddel', 'vervoermiddelNaam', 'vervoermiddelNationaliteit',
     'aankomstDatum', 'aankomstTijd'].forEach(function (k) { r[k] = normVeld(raw[k]); });

    ['landOorsprong', 'landLading', 'vervoermiddelNationaliteit'].forEach(function (k) {
      var oud = r[k].waarde;
      r[k].waarde = normLand(oud);
      if (oud && !r[k].waarde) w.push('Landcode "' + oud + '" (' + k + ') is geen ISO-code; vul handmatig in.');
    });
    [['grenscontrolepost', BCP_NL, 'Grenscontrolepost']].forEach(function (x) {
      var oud = r[x[0]].waarde;
      if (!oud) return;
      var e = zoekInLijst(x[1], oud);
      r[x[0]].waarde = e ? e.label : '';
      if (!e) w.push(x[2] + ' "' + oud + '" staat niet (eenduidig) in de Portbase-lijst; kies zelf.');
    });
    if (r.aankomstDatum.waarde) {
      var d = normDatum(r.aankomstDatum.waarde);
      if (!d) w.push('Aankomstdatum "' + r.aankomstDatum.waarde + '" niet herkend.');
      r.aankomstDatum.waarde = d;
    }
    r.aankomstTijd.waarde = normTijd(r.aankomstTijd.waarde);
    r.bol.waarde = r.bol.waarde.replace(/\s+/g, '');
    if (r.declaratieType.waarde !== 'PRD' && r.declaratieType.waarde !== 'LNV') r.declaratieType.waarde = '';

    ['exporteur', 'importeur'].forEach(function (k) {
      var p = raw[k] || {};
      r[k] = { naam: s(p.naam), adres: s(p.adres), land: normLand(p.land), bron: s(p.bron), zekerheid: ZEKERHEID.indexOf(p.zekerheid) >= 0 ? p.zekerheid : 'laag' };
    });

    r.containers = (raw.containers || []).map(function (c) {
      var nr = s(c.containernummer).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (nr && !containerGeldig(nr)) w.push('Containernummer ' + nr + ' heeft een ongeldig controlecijfer (ISO 6346); controleer het nummer.');
      return { containernummer: nr, zegelnummer: s(c.zegelnummer), bron: s(c.bron) };
    }).filter(function (c) { return c.containernummer || c.zegelnummer; });

    r.documenten = (raw.documenten || []).map(function (doc) {
      var datum = normDatum(doc.datumAfgifte);
      if (s(doc.datumAfgifte) && !datum) w.push('Afgiftedatum "' + s(doc.datumAfgifte) + '" van ' + s(doc.identificatie) + ' niet herkend.');
      return {
        type: DOC_CODES.indexOf(doc.type) >= 0 ? doc.type : 'OTHER',
        identificatie: s(doc.identificatie),
        datumAfgifte: datum,
        landAfgifte: normLand(doc.landAfgifte),
        inrichtingOorsprong: s(doc.inrichtingOorsprong),
        verwijstNaar: s(doc.verwijstNaar),
        bestand: s(doc.bestand),
        zekerheid: ZEKERHEID.indexOf(doc.zekerheid) >= 0 ? doc.zekerheid : 'laag'
      };
    }).filter(function (doc) { return doc.identificatie || doc.type !== 'OTHER'; });

    r.goederen = (raw.goederen || []).map(function (g, i) {
      var gn = normGn(g.gnCode);
      if (gn && gn.length !== 8 && gn.length !== 10) w.push('Goederenitem ' + (i + 1) + ': GN-code "' + gn + '" heeft niet 8 cijfers; vul de volledige code aan.');
      var item = {
        gnCode: gn,
        omschrijving: s(g.omschrijving),
        brutoGewicht: normGetal(g.brutoGewicht),
        nettoGewicht: normGetal(g.nettoGewicht),
        aantalColli: normGetal(g.aantalColli),
        verpakkingstype: s(g.verpakkingstype),
        batchnummer: s(g.batchnummer),
        aanvullendeEenheden: s(g.aanvullendeEenheden),
        erkenningsnummer: s(g.erkenningsnummer),
        wetenschappelijkeNaam: s(g.wetenschappelijkeNaam),
        aardProduct: s(g.aardProduct),
        containernummer: s(g.containernummer).toUpperCase().replace(/[^A-Z0-9]/g, ''),
        bron: s(g.bron),
        zekerheid: ZEKERHEID.indexOf(g.zekerheid) >= 0 ? g.zekerheid : 'laag'
      };
      if (item.brutoGewicht && item.nettoGewicht && +item.nettoGewicht > +item.brutoGewicht) {
        w.push('Goederenitem ' + (i + 1) + ': nettogewicht (' + item.nettoGewicht + ') is groter dan brutogewicht (' + item.brutoGewicht + ').');
      }
      return item;
    }).filter(function (g) { return g.gnCode || g.omschrijving; });

    if (!r.declaratieType.waarde) {
      var dierlijk = r.goederen.some(function (g) { return /^(0[1-5]|1[56]|2[01]|3[05])/.test(g.gnCode); });
      if (r.goederen.length) {
        r.declaratieType = { waarde: dierlijk ? 'PRD' : 'LNV', bron: 'Afgeleid uit GN-code', zekerheid: 'middel' };
      }
    }
    if (!r.documenten.some(function (doc) { return doc.type === 'HC'; }) && r.declaratieType.waarde === 'PRD') {
      w.push('Geen gezondheidscertificaat (HC) herkend in de geüploade documenten.');
    }
    r.waarschuwingen = uniek(w);
    return r;
  }

  function uniek(arr) {
    var seen = {};
    return arr.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
  }

  /** Zet het (genormaliseerde) AI-resultaat om naar een declaratie voor ENGINE.checkDeclaration. */
  function naarDeclaratie(r) {
    return {
      bron: 'ai',
      type: r.declaratieType.waarde || 'PRD',
      eigenReferentie: r.bol.waarde,
      bol: r.bol.waarde,
      exporteur: r.exporteur.naam,
      importeur: r.importeur.naam,
      landOorsprong: r.landOorsprong.waarde,
      landLading: r.landLading.waarde,
      eta: r.aankomstDatum.waarde,
      documenten: r.documenten.map(function (doc) {
        return { naam: doc.type, type: doc.type, identificatie: doc.identificatie, datum: doc.datumAfgifte, verwijstNaar: doc.verwijstNaar, bestand: doc.bestand, landAfgifte: doc.landAfgifte };
      }),
      goederen: r.goederen.map(function (g) {
        return { gn: g.gnCode, animo: '', omschrijving: g.omschrijving, brutoGewicht: g.brutoGewicht, nettoGewicht: g.nettoGewicht };
      })
    };
  }

  /** Tekst voor de gebruikersprompt (na de documenten). */
  function gebruikersPrompt(bestandsnamen, context) {
    var t = 'Lees de bijgevoegde documenten uit en vul de GGB-velden in volgens het schema.\n' +
      'Bestanden: ' + bestandsnamen.join(', ') + '.';
    if (context && s(context)) t += '\n\nAanvullende informatie van de declarant:\n' + s(context);
    return t;
  }

  var exported = {
    SCHEMA: SCHEMA, SYSTEM: SYSTEM, DOC_CODES: DOC_CODES,
    BCP_NL: BCP_NL, zoekInLijst: zoekInLijst,
    normaliseer: normaliseer, naarDeclaratie: naarDeclaratie, gebruikersPrompt: gebruikersPrompt,
    normDatum: normDatum, normTijd: normTijd, normLand: normLand, normGetal: normGetal, containerGeldig: containerGeldig
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_AI = exported;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
