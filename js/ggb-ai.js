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

  /* Animo-codes zoals in de Portbase-dialoog "ANIMO code" (stand nov. 2026). */
  var ANIMO_CODES = [
    ['101101', "Vers Vlees, slachtafvallen en vleesproducten / Vlees van als landbouwhuisdier gehouden hoefdieren"],
    ['101105', "Vers Vlees, slachtafvallen en vleesproducten / Gehakt vlees, vleesbereidingen en separatorvlees"],
    ['102108', "Andere visserijproducten dan 206107 (FQ3)"],
    ['102148', "Levende schaaldieren of verse vis manueel ontdaan van kop en ingewanden uit Canada"],
    ['103110', "Hele eieren / Eggs and egg products"],
    ['104112', "Reuzel en gesmolten vet / MC"],
    ['1041122', "Reuzel en gesmolten vet / Diervoeder"],
    ['1041123', "Reuzel en gesmolten vet / Technisch Farmaceutisch"],
    ['105113', "Darmen (natuurlijke) / Behandelde magen, blazen en darmen: uitsluitend ingewanden"],
    ['106110', "Broedeieren / Eggs and egg products"],
    ['107110', "Eiproducten / Eggs and egg products MC gekoeld/bevroren"],
    ['119000', "Insecten voor MC"],
    ['120116', "Zeer verfijnde producten"],
    ['121000', "Samengestelde producten hoog risico"],
    ['121001', "Samengestelde producten laag risico"],
    ['201100', "Vlees van pluimvee en producten daarvan / Pluimveevleesproducten voor MC"],
    ['201102', "Vlees van pluimvee en producten daarvan / Vlees van pluimvee en lagomorfen"],
    ['201105', "Vlees van pluimvee en producten daarvan / Gehakt vlees, vleesbereidingen en separatorvlees"],
    ['202102', "Konijnenvlees, vlees van wild en producten daarvan / Vlees van pluimvee en lagomorfen"],
    ['202103', "Konijnenvlees, vlees van wild en producten daarvan / Vlees van gekweekt wild"],
    ['202104', "Konijnenvlees, vlees van wild en producten daarvan / Vlees van vrij wild"],
    ['202105', "Konijnenvlees, vlees van wild en producten daarvan / Gehakt vlees, vleesbereidingen en separatorvlees"],
    ['2031092', "Melk en melkproducten (MC) / Rauwe melk en zuivelproducten obv colostrum gekoeld/bevroren"],
    ['2031093', "Melk en melkproducten (MC) / Overige zuivelproducten ambient"],
    ['204110', "Eiproducten / Eggs and egg products MC, ambient"],
    ['205000', "Verwerkte dierlijke eiwitten voor menselijke consumptie"],
    ['206107', "Visproducten aquacult. en 2-kleppige weekdieren MC, tenzij hermetisch verpakt én ambient"],
    ['207000', "Honing"],
    ['301201', "Sperma"],
    ['302202', "Embryo's"],
    ['303000', "Mest"],
    ['304002', "Melk en melkproducten / Technisch Farmaceutisch"],
    ['304302', "Melk en melkproducten / Diervoeder"],
    ['305114', "Gelatine en collageen Humaan en technisch of farmaceutisch gebruik"],
    ['305115', "Collageen technisch of farmaceutisch gebruik"],
    ['305145', "Gelatine en collageen diervoeder"],
    ['305416', "Gelatine voor de fotografische industrie"],
    ['306111', "Kikkerbilletjes en Slakken"],
    ['307001', "Beenderen en producten / Meel van beenderen/ Vleesbeendermeel / Gedroogde kanen (Techn./Farmaceut.)"],
    ['307304', "Beenderen en producten / Meel van beenderen/ Vleesbeendermeel / Gedroogde kanen (Diervoeder)"],
    ['308000', "Huiden"],
    ['309304', "Haar van varkens, wol, haar en veren / Meel van veren"],
    ['310304', "Hoornen, hoeven en producten uit hoornen en hoeven / Meel van hoornen / Meel van hoeven"],
    ['311000', "Producten van de bijenteelt"],
    ['312000', "Jachttrofeeën"],
    ['313304', "Verwerkt voeder voor gezelschapsdieren / alle incl. op basis van verwerkte huiden"],
    ['314000', "Grondstoffen voor vervaardiging petfood"],
    ['315000', "Farmac. Grondstoffen o.a. bloedproducten, klieren en organen"],
    ['316304', "Bloedproducten voor technisch gebruik / Meel van bloed"],
    ['317000', "Pathogenen"],
    ['318000', "Hooi en stro"],
    ['319000', "Tussenproducten"],
    ['400304', "Overig / Mengsels van onder 307000 t/m 316000 genoemde meelsoorten"]
  ].map(function (x) { return { code: x[0], omschrijving: x[1] }; });

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

  function organisatie(beschrijving) {
    var o = obj({
      naam: str('Naam precies zoals op het document'),
      adres: str('Straat/adres zoals op het document, op één regel (zonder plaats en land)'),
      plaats: str('Plaats/stad (bijv. "Binh An", "Rotterdam")'),
      land: str('ISO 3166-1 alpha-2 landcode'),
      erkenningsnummer: str('Erkennings-/approval-/registratienummer indien vermeld (bijv. "DL 1022"), anders leeg'),
      bron: str('Bron, bijv. "HC vak I.1"'),
      zekerheid: str('Zekerheid', ZEKERHEID)
    });
    o.description = beschrijving;
    return o;
  }

  var SCHEMA = obj({
    declaratieType: veld('"PRD" voor producten van dierlijke oorsprong (CHED-P), "LNV" voor levensmiddelen/diervoeders van niet-dierlijke oorsprong (CHED-D).', { enum: ['PRD', 'LNV', ''] }),
    bol: veld('Bill of lading number (I.13), zoals op B/L of HC. Leeg als niet in de documenten.'),
    bestemming: veld('Destination (I.20-25): bijv. "Import", "Transit", "Transhipment", "Warehouse". Bij twijfel "Import".'),
    exporteur: organisatie('Exporteur/afzender (HC vak I.1 "Consignor/Exporter")'),
    importeur: organisatie('Importeur = HC vak I.5 "Consignee/Importer" (NIET I.6 "Operator responsible")'),
    grenscontrolepost: veld('Border control post (I.4) uit de Portbase-lijst. Afleiden uit HC vak I.4 / haven van binnenkomst (zeevracht via Rotterdam: "Rotterdam (NLRTM1)", luchtvracht Schiphol: "Amsterdam Airport Schiphol (NLAMS4)").',
      { enum: BCP_NL.map(function (e) { return e.label; }).concat(['']) }),
    plaatsBestemming: organisatie('Place of destination = HC vak I.12 "Place of destination", met approval number en land (kan buiten NL liggen, bijv. DE)'),
    plaatsVerzending: organisatie('Place of dispatch / inrichting van oorsprong (HC vak I.11 "Place of dispatch"), met erkenningsnummer ("Approval number")'),
    landOorsprong: veld('Country of origin (I.11), ISO alpha-2.'),
    landLading: veld('Country of loading (I.14), ISO alpha-2 (land van de laadhaven).'),
    gecertificeerdVoor: veld('Goods certified as or for = HC vak I.20 "Certified as or for" (Products for human consumption -> Human consumption).', { enum: ['Human consumption', 'Feedstuff', 'Pharmaceutical use', 'Technical use', 'Further processing', 'Trade sample', 'Other', ''] }),
    transportconditie: veld('Transport conditions (I.16).', { enum: ['Ambient', 'Chilled', 'Frozen', ''] }),
    vervoermiddel: veld('Means of transport = HC vak I.15 "Mode".', { enum: ['Vessel', 'Airplane', 'Railway', 'Road vehicle', ''] }),
    vervoermiddelNaam: veld('Name / identification (I.13): naam schip/vlucht + eventueel IMO/reisnummer.'),
    vervoermiddelNationaliteit: veld('Nationality (I.13): vlaggenstaat, ISO alpha-2.'),
    aankomstDatum: veld('Expected date of arrival (I.10), formaat dd-mm-jjjj. Leeg als niet in de documenten.'),
    aankomstTijd: veld('Verwachte aankomsttijd, formaat uu:mm. Leeg als onbekend.'),
    totaalColli: veld('HC vak I.24 Total number of packages (alleen het getal).'),
    totaalNettoGewicht: veld('HC vak I.26 Total net weight in kg.'),
    totaalBrutoGewicht: veld('HC vak I.26 Total gross weight in kg (of uit paklijst/B/L).'),
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
        brutoGewicht: str('Brutogewicht van deze HC-regel in kg; leeg als het HC het per regel niet geeft'),
        nettoGewicht: str('Nettogewicht in kg, alleen cijfers met punt als decimaalteken'),
        aantalColli: str('Aantal verpakkingen (I.32), alleen cijfers'),
        verpakkingstype: str('Package type (I.32), bijv. Carton, Bag, Box, Pallet'),
        batchnummer: str('Batchnummer / lotnummer (I.34)'),
        aanvullendeEenheden: str('Additional units (I.33), indien vermeld'),
        erkenningsnummer: str('Activity / approval number (I.15): erkenningsnummer van de inrichting van oorsprong, bijv. "1234" of "IN-1234"'),
        animoCode: str('Animo-code (Portbase/NVWA) die bij dit product hoort, uit de lijst: ' + ANIMO_CODES.map(function (a) { return a.code + ' = ' + a.omschrijving; }).join('; ') + '. Vis uit aquacultuur en tweekleppige weekdieren: 206107; wild gevangen vis: 102108. Leeg als je het niet zeker weet.', ANIMO_CODES.map(function (a) { return a.code; }).concat([''])),
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
    '- Het HC is leidend. Vakken van het HC (TRACES-model) -> GGB in Portbase:',
    '    I.1 Consignor/Exporter -> exporteur; I.5 Consignee/Importer -> importeur (NIET I.6 Operator responsible);',
    '    I.7 Country of origin -> landOorsprong; I.11 Place of dispatch -> plaatsVerzending (met Approval number);',
    '    I.12 Place of destination -> plaatsBestemming (met Approval number en land); I.13 Place of loading -> landLading;',
    '    I.15 Means of transport: Mode -> vervoermiddel, Identification "SHIP NAME 123W | Singapore" -> naam "SHIP NAME 123W"',
    '    en nationaliteit SG; I.16 Entry Border Control Post -> grenscontrolepost; I.17 Accompanying documents -> B/L-nummer;',
    '    I.18 Transport conditions -> transportconditie; I.19 Container/Seal -> containers; I.20 Certified as or for -> gecertificeerdVoor;',
    '    I.22 For internal market -> bestemming "Import" (I.21 For transit -> "Transit"); I.2 Certificate reference -> nummer van het HC;',
    '    I.27 Description of consignment -> goederen (CN code, Species, Nature of commodity, Batch number, Package count, Net weight,',
    '    Manufacturing plant). Brutogewichten per product uit paklijst of B/L als het HC alleen een totaal geeft.',
    '- Goederenitems moeten identiek zijn aan het HC: maak precies één goederenitem per regel van vak I.27 (#1, #2, …),',
    '  in dezelfde volgorde, ook als GN-code en soort gelijk zijn. Niet samenvoegen en niet splitsen. Per regel: Commodity',
    '  (GN-code), Species, Nature of commodity + Treatment type (aard), Batch number, Package count, Net weight en',
    '  Manufacturing plant (erkenningsnummer). Brutogewicht per regel alleen als het op het HC staat, anders leeg laten:',
    '  de extensie verdeelt het totale brutogewicht (I.26) naar rato van het nettogewicht. Neem de totalen I.24/I.26 over.',
    '  Gebruik factuur, paklijst en B/L voor B/L-nummer, containers, zegels, colli en gewichten als die niet op het HC staan.',
    '- Datums altijd als dd-mm-jjjj, tijden als uu:mm, landen als ISO alpha-2, GN-codes als 8 cijfers zonder scheidingstekens,',
    '  gewichten in kg met een punt als decimaalteken.',
    '- Neem elk aangeleverd document op onder "documenten" (één regel per document) met het nummer precies zoals gedrukt,',
    '  ook factuur, paklijst en B/L (als COMM). Welke documenten in de GGB komen, bepaalt de declarant aan de hand van de',
    '  NVWA-regels (meestal alleen het HC, soms een labrapport). Vermeld bij een labrapport naar welk HC-nummer het verwijst.',
    '- Maak één goederenitem per GN-code/partij zoals op het HC. Tel gewichten niet zelf op tenzij nodig, en meld het dan.',
    '- Neem bij exporteur (I.1), importeur (I.5/I.6), plaats van bestemming (I.7/I.12) en plaats van verzending (I.11,',
    '  inrichting van oorsprong) naam, adres, plaats, land en erkenningsnummer letterlijk over: daarmee wordt in Portbase',
    '  het juiste bedrijf gekozen (dezelfde naam komt vaak meerdere keren voor met een ander adres of andere activiteit).',
    '- Kies per goederenitem de Animo-code uit de lijst in het schema (bijv. vis uit aquacultuur 206107, wild gevangen 102108).',
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
    // Een chat-AI (handmatige modus) geeft soms een kale waarde i.p.v. {waarde, bron, zekerheid}.
    if (v == null || typeof v !== 'object') return { waarde: s(v), bron: '', zekerheid: s(v) ? 'middel' : 'laag' };
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
    ['declaratieType', 'bol', 'bestemming', 'grenscontrolepost', 'landOorsprong', 'landLading',
     'gecertificeerdVoor', 'transportconditie', 'vervoermiddel', 'vervoermiddelNaam', 'vervoermiddelNationaliteit',
     'aankomstDatum', 'aankomstTijd', 'totaalColli', 'totaalNettoGewicht', 'totaalBrutoGewicht'].forEach(function (k) { r[k] = normVeld(raw[k]); });
    ['totaalColli', 'totaalNettoGewicht', 'totaalBrutoGewicht'].forEach(function (k) { r[k].waarde = normGetal(r[k].waarde); });

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
    var OUD_GEBRUIK = { feedingstuff: 'Feedstuff', 'further process': 'Further processing', 'products for human consumption': 'Human consumption' };
    if (OUD_GEBRUIK[r.gecertificeerdVoor.waarde.toLowerCase()]) r.gecertificeerdVoor.waarde = OUD_GEBRUIK[r.gecertificeerdVoor.waarde.toLowerCase()];

    ['exporteur', 'importeur', 'plaatsBestemming', 'plaatsVerzending'].forEach(function (k) {
      var p = raw[k] || {};
      if (typeof p !== 'object') p = { naam: p, zekerheid: s(p) ? 'middel' : 'laag' };
      if (p.waarde != null && p.naam == null) p = { naam: p.waarde, bron: p.bron, zekerheid: p.zekerheid }; // oud formaat {waarde}
      r[k] = { naam: s(p.naam), adres: s(p.adres), plaats: s(p.plaats), land: normLand(p.land), erkenningsnummer: s(p.erkenningsnummer),
        bron: s(p.bron), zekerheid: ZEKERHEID.indexOf(p.zekerheid) >= 0 ? p.zekerheid : 'laag' };
    });
    if (!r.bestemming.waarde) r.bestemming = { waarde: 'Import', bron: 'Standaard (niet in de documenten)', zekerheid: 'middel' };

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
        animoCode: ANIMO_CODES.some(function (a) { return a.code === s(g.animoCode); }) ? s(g.animoCode) : '',
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

    verdeelBruto(r, w);
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

  /**
   * Het HC geeft per regel (I.27) meestal alleen nettogewicht. Ontbreekt het
   * brutogewicht per regel, dan wordt het totaal (I.26) naar rato van het
   * nettogewicht verdeeld (1 decimaal; de laatste regel vangt de afronding op).
   * Anders: controle dat de som klopt met het totaal.
   */
  function verdeelBruto(r, w) {
    var items = r.goederen, totaal = +r.totaalBrutoGewicht.waarde;
    if (!items.length) return;
    var netto = items.map(function (g) { return +g.nettoGewicht || 0; });
    var somNetto = netto.reduce(function (a, b) { return a + b; }, 0);
    var leeg = items.filter(function (g) { return !g.brutoGewicht; });
    if (totaal && leeg.length === items.length && somNetto > 0) {
      var rest = totaal;
      items.forEach(function (g, i) {
        var v = i === items.length - 1 ? rest : Math.round(totaal * netto[i] / somNetto * 10) / 10;
        rest = Math.round((rest - v) * 10) / 10;
        g.brutoGewicht = String(Math.round(v * 10) / 10);
      });
      w.push('Brutogewicht per goederenitem berekend naar rato van het nettogewicht (totaal ' + totaal + ' kg, HC I.26); controleer of dat zo gewenst is.');
    } else if (totaal && !leeg.length) {
      var som = items.reduce(function (a, g) { return a + (+g.brutoGewicht || 0); }, 0);
      if (Math.abs(som - totaal) > 1) w.push('Som van de brutogewichten (' + Math.round(som * 10) / 10 + ' kg) wijkt af van het totaal op het HC (' + totaal + ' kg).');
    }
    var tn = +r.totaalNettoGewicht.waarde;
    if (tn && somNetto && Math.abs(somNetto - tn) > 1) w.push('Som van de nettogewichten (' + Math.round(somNetto * 10) / 10 + ' kg) wijkt af van het totaal op het HC (' + tn + ' kg).');
    var tc = +r.totaalColli.waarde, somColli = items.reduce(function (a, g) { return a + (+g.aantalColli || 0); }, 0);
    if (tc && somColli && somColli !== tc) w.push('Som van de colli (' + somColli + ') wijkt af van het totaal op het HC (' + tc + ').');
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
      documenten: r.documenten.filter(function (doc) { return doc.opnemen !== false; }).map(function (doc) {
        return { naam: doc.type, type: doc.type, identificatie: doc.identificatie, datum: doc.datumAfgifte, verwijstNaar: doc.verwijstNaar, bestand: doc.bestand, landAfgifte: doc.landAfgifte };
      }),
      goederen: r.goederen.map(function (g) {
        return { gn: g.gnCode, animo: g.animoCode || '', omschrijving: g.omschrijving, brutoGewicht: g.brutoGewicht, nettoGewicht: g.nettoGewicht };
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

  /* ---------------- documenten in de GGB ---------------- */

  /* Documenttypes zoals in de Portbase-keuzelijst "Type" (Document(s), I.9). */
  var PORTBASE_DOCTYPE = {
    HC: 'Health certificate (636)', LAB: 'Certified lab report (162)', CATCH: 'Catch certificate / private attestation (916)',
    PRIVATT: 'Catch certificate / private attestation (916)', OFFCERT: 'Official certificate 2019/1793 (100)',
    COI: 'Certificate of Inspection (COI) (C644)', CITES: 'Import permit (521)', PHYTO: 'Certificate (16)',
    COMM: 'Commercial invoice (380)', OTHER: 'Certificate (16)'
  };
  /* Volledige keuzelijst van Portbase (stand nov. 2026), voor handmatig corrigeren. */
  var PORTBASE_DOCTYPES = ["Analysis certificate (1)", "Certified lab report 2019/1793 (4)", "Analysis certificate 2019/1793 (5)", "Certified lab report 2020/1158 (6)", "Certified lab report 2011/884 (7)", "Analysis certificate 2011/884 (8)", "Certificate (16)", "Official certificate 2019/1793 (100)", "Proof of purchase (105)", "Certified lab report (162)", "Order (220)", "Packing list (271)", "Request for import (303)", "Health certificate 2011/884 (309)", "Contract (315)", "Proforma invoice (325)", "Official certificate 2020/1158 (375)", "Commercial invoice (380)", "Import permit (521)", "Heat treatment certificate (625)", "Customs receipt (635)", "Health certificate (636)", "Delivery order (640)", "Certificate of Inspection (COI) (C644)", "General transport document (701)", "Bill of lading (705)", "Sea waybill (710)", "Air waybill (740)", "Freight invoice (780)", "Delivery notice (784)", "Freight list (785)", "Container manifest (788)", "Veterinary certificate (853)", "Inspection certificate (856)", "Certificate of origin (861)", "Statement 2011/884 (862)", "Catch certificate / private attestation (916)", "Customs invoice (935)", "Transit declaration (950)", "Administrative document (960)"];

  /* Varianten per EU-verordening (herkend aan de regel die het document vraagt). */
  var VERORDENINGEN = [
    { naam: '2019/1793', re: /2019\/1793|1793\/19|179319/, types: { LAB: 'Certified lab report 2019/1793 (4)', OFFCERT: 'Official certificate 2019/1793 (100)' } },
    { naam: '2020/1158', re: /2020\/1158|1158\/20|115820/, types: { LAB: 'Certified lab report 2020/1158 (6)', OFFCERT: 'Official certificate 2020/1158 (375)' } },
    { naam: '2011/884', re: /2011\/884|0?884\/11|088411/, types: { LAB: 'Certified lab report 2011/884 (7)', HC: 'Health certificate 2011/884 (309)' } }
  ];

  /**
   * Bepaalt per document of het in de GGB hoort (alleen wat de NVWA-/TARIC-regels
   * vragen; factuur, paklijst en B/L zijn alleen bron) en welk Portbase-type erbij hoort.
   * @param r          genormaliseerd voorstel (documenten krijgen opnemen, reden, portbaseType)
   * @param eisen      per goederenitem de vereisten uit ENGINE.requirementsFor(...).vereisten
   * @param regelOpId  functie id -> regel (voor de bron/verordening), optioneel
   */
  function bepaalGgbDocumenten(r, eisen, regelOpId) {
    var gevraagd = {};
    (eisen || []).forEach(function (lijst) {
      (lijst || []).forEach(function (v) {
        [v.type].concat(v.alternatieven || []).forEach(function (t) {
          var g = gevraagd[t] || (gevraagd[t] = { niveau: v.niveau, ids: [] });
          if (v.niveau === 'verplicht') g.niveau = 'verplicht';
          g.ids = g.ids.concat(v.regelIds || []);
        });
      });
    });
    (r.documenten || []).forEach(function (doc) {
      var g = gevraagd[doc.type];
      var tekst = g ? g.ids.map(function (id) { var regel = regelOpId ? regelOpId(id) : null; return id + ' ' + (regel ? (regel.bron || '') + ' ' + (regel.naam || '') : ''); }).join(' ') : '';
      var ver = VERORDENINGEN.filter(function (v) { return v.re.test(tekst) && v.types[doc.type]; })[0];
      if (!doc.portbaseTypeHandmatig) doc.portbaseType = ver ? ver.types[doc.type] : (PORTBASE_DOCTYPE[doc.type] || PORTBASE_DOCTYPE.OTHER);
      doc.gevraagd = !!g;
      doc.reden = g ? (g.niveau === 'verplicht' ? 'Vereist' : 'Ter beoordeling') + (ver ? ' (Ver. ' + ver.naam + ')' : '') + ' volgens de regels'
        : 'Niet gevraagd door de regels; alleen bron voor gegevens';
      if (g && g.niveau !== 'verplicht') doc.reden += ' – zelf aanvinken als de NVWA het wil zien';
      // Standaard alleen verplichte documenten (meestal alleen het HC); "ter beoordeling" zet de declarant zelf aan.
      if (typeof doc.opnemen !== 'boolean') doc.opnemen = !!g && g.niveau === 'verplicht';
    });
    return r;
  }

  /* ---------------- aanbieders en instellingen ---------------- */

  var PROVIDERS = {
    claude: { naam: 'Claude', bedrijf: 'Anthropic', standaardModel: 'claude-opus-5-5', sleutelUrl: 'https://console.anthropic.com/settings/keys', sleutelVoorbeeld: 'sk-ant-…', effort: true },
    openai: { naam: 'ChatGPT', bedrijf: 'OpenAI', standaardModel: '', sleutelUrl: 'https://platform.openai.com/api-keys', sleutelVoorbeeld: 'sk-…' },
    gemini: { naam: 'Gemini', bedrijf: 'Google', standaardModel: 'gemini-pro-latest', sleutelUrl: 'https://aistudio.google.com/apikey', sleutelVoorbeeld: 'AIza…' },
    handmatig: { naam: 'Handmatig', bedrijf: 'via een chat (zonder API-sleutel)' }
  };
  var EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

  /** Normaliseert opgeslagen instellingen (ook het oude formaat {apiKey, model, effort} voor Claude). */
  function instellingen(raw) {
    raw = raw || {};
    var oud = !raw.provider && (raw.apiKey || raw.model);
    var claude = raw.claude || (oud ? { apiKey: raw.apiKey, model: raw.model, effort: raw.effort } : {});
    var r = {
      provider: PROVIDERS[raw.provider] ? raw.provider : 'claude',
      claude: { apiKey: s(claude.apiKey), model: s(claude.model) || PROVIDERS.claude.standaardModel, effort: EFFORTS.indexOf(claude.effort) >= 0 ? claude.effort : 'high' },
      openai: { apiKey: s((raw.openai || {}).apiKey), model: s((raw.openai || {}).model) || PROVIDERS.openai.standaardModel },
      gemini: { apiKey: s((raw.gemini || {}).apiKey), model: s((raw.gemini || {}).model) || PROVIDERS.gemini.standaardModel }
    };
    return r;
  }

  /** Is de gekozen aanbieder klaar voor automatisch uitlezen? Geeft een foutmelding of ''. */
  function aanbiederProbleem(inst) {
    if (inst.provider === 'handmatig') return 'Handmatige modus: kopieer de prompt en plak het JSON-antwoord.';
    var p = inst[inst.provider];
    if (!p.apiKey) return 'Geen API-sleutel voor ' + PROVIDERS[inst.provider].naam + ' ingesteld.';
    if (!p.model) return 'Geen model voor ' + PROVIDERS[inst.provider].naam + ' gekozen.';
    return '';
  }

  /** Volledige prompt voor de handmatige modus (in een chat plakken samen met de documenten). */
  function handmatigePrompt(bestandsnamen, context) {
    var namen = bestandsnamen && bestandsnamen.length ? bestandsnamen : ['(de bijgevoegde documenten)'];
    return SYSTEM + '\n\n' +
      '=== OPDRACHT ===\n' + gebruikersPrompt(namen, context) + '\n\n' +
      '=== ANTWOORDFORMAAT ===\n' +
      'Antwoord UITSLUITEND met één JSON-object, zonder uitleg en zonder markdown, dat voldoet aan dit JSON-schema. ' +
      'Gebruik voor onbekende waarden een lege string "" en zet "zekerheid" dan op "laag". ' +
      'Vul bij "bestand" de bestandsnaam van het document in zoals hierboven genoemd.\n' +
      JSON.stringify(SCHEMA);
  }

  /** Haalt het JSON-object uit een geplakt chat-antwoord (ook met ```json-blokken of tekst eromheen). */
  function leesJsonAntwoord(tekst) {
    var t = String(tekst || '').trim();
    if (!t) throw new Error('Plak eerst het antwoord van de AI.');
    var blok = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (blok) t = blok[1].trim();
    var begin = t.indexOf('{'), eind = t.lastIndexOf('}');
    if (begin < 0 || eind <= begin) throw new Error('Geen JSON-object gevonden in het antwoord.');
    var json;
    try {
      json = JSON.parse(t.slice(begin, eind + 1));
    } catch (e) {
      throw new Error('Het antwoord is geen geldige JSON (' + e.message + '). Vraag de AI om alleen het JSON-object te geven.');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('Het antwoord is geen JSON-object.');
    var bekend = Object.keys(SCHEMA.properties).filter(function (k) { return k in json; });
    if (bekend.length < 3) throw new Error('Het JSON-object lijkt niet op een GGB-voorstel (te weinig bekende velden).');
    return json;
  }

  var exported = {
    ANIMO_CODES: ANIMO_CODES, PORTBASE_DOCTYPE: PORTBASE_DOCTYPE, PORTBASE_DOCTYPES: PORTBASE_DOCTYPES, bepaalGgbDocumenten: bepaalGgbDocumenten,
    PROVIDERS: PROVIDERS, EFFORTS: EFFORTS, instellingen: instellingen, aanbiederProbleem: aanbiederProbleem,
    handmatigePrompt: handmatigePrompt, leesJsonAntwoord: leesJsonAntwoord,
    SCHEMA: SCHEMA, SYSTEM: SYSTEM, DOC_CODES: DOC_CODES,
    BCP_NL: BCP_NL, zoekInLijst: zoekInLijst,
    normaliseer: normaliseer, naarDeclaratie: naarDeclaratie, gebruikersPrompt: gebruikersPrompt,
    normDatum: normDatum, normTijd: normTijd, normLand: normLand, normGetal: normGetal, containerGeldig: containerGeldig
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_AI = exported;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
