/*
 * Smart Memory – leert van eerdere zendingen (browser + Node, geen dependencies).
 *
 * Een profiel is een vaste route: exporteur -> ontvanger (plaats van bestemming,
 * anders importeur), bijv. "Zhucheng Delicate -> Constellation Cold Logistics".
 * Na elke invulronde wordt het dossier bewaard: per leerbaar veld de waarde van
 * de AI en de waarde die de gebruiker uiteindelijk gebruikte, plus welke
 * aandachtspunten als akkoord zijn afgevinkt.
 *
 * Bij een nieuw AI-voorstel voor hetzelfde profiel:
 *  - Correcties: een waarde wordt overgenomen als de gebruiker die minstens
 *    MIN_BEVESTIGD keer heeft gebruikt, in minstens MIN_AANDEEL van de dossiers
 *    van dit profiel, en de AI het minstens één keer anders had (anders voegt
 *    het geheugen niets toe). Vlaggenstaten worden per schip geleerd, over alle
 *    profielen heen.
 *  - Aandachtspunten (zelfde tekst, getallen en "…" weggelaten) die vaak genoeg
 *    akkoord waren, staan voorgevinkt als "eerder akkoord". Kritieke punten
 *    (ongeldig containernummer, netto > bruto, ...) nooit automatisch, tenzij de
 *    gebruiker expliciet "altijd akkoord voor dit profiel" koos.
 *
 * Organisaties (Portbase-keuzes): welke regel in het Portbase-zoekvenster bij
 * een naam op het HC hoort, per rol (exporteur, importeur, plaats van
 * bestemming, inrichting). Bijv. "Kühne + Heitz" als importeur =
 * KUHNE + HEITZ HOLLAND B.V. | Wilgenbos 20 | 3311 JX | Dordrecht | OAI EOR |
 * 2404021 NL806694324 | IM - importer | OTH-OPER | veterinary. Geleerd als de
 * gebruiker in Portbase een regel kiest en op Save klikt, of handmatig
 * toegevoegd (regel uit Portbase plakken). Bij het invullen zoekt de invuller
 * dan op die naam en kiest precies die regel.
 *
 * Opslag gebeurt door de aanroeper (chrome.storage.local); niets verlaat de pc.
 */
(function (root) {
  'use strict';

  var VERSIE = 1, MAX_DOSSIERS = 150, MIN_BEVESTIGD = 2, MIN_AANDEEL = 0.75;

  function s(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return s(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var RECHTSVORM = /\b(b ?v|n ?v|ltd|limited|co|company|corp|corporation|gmbh|llc|inc|s ?a|spa|sarl|plc|jsc|pvt|private)\b/g;
  function kaal(v) { return norm(v).replace(RECHTSVORM, ' ').replace(/\s+/g, ' ').trim(); }

  function leeg() { return { versie: VERSIE, dossiers: [], regels: {}, organisaties: [] }; }
  /** Opgeslagen geheugen inlezen (onbekend of oud formaat: leeg beginnen). */
  function laad(x) {
    if (!x || x.versie !== VERSIE || !Array.isArray(x.dossiers)) return leeg();
    x.regels = x.regels || {};
    if (!Array.isArray(x.organisaties)) x.organisaties = [];
    return x;
  }

  /* ---------------- profielen ---------------- */

  function ontvangerVan(r) { return s(r.plaatsBestemming && r.plaatsBestemming.naam) || s(r.importeur && r.importeur.naam); }

  /** Profiel van een voorstel: {sleutel, exporteur, ontvanger} of null als een van beide namen ontbreekt. */
  function profiel(r) {
    if (!r || !r.exporteur) return null;
    var exp = kaal(r.exporteur.naam), ont = kaal(ontvangerVan(r));
    if (!exp || !ont) return null;
    return { sleutel: exp + ' > ' + ont, exporteur: s(r.exporteur.naam), ontvanger: ontvangerVan(r) };
  }

  /* ---------------- leerbare velden ---------------- */

  var ALGEMEEN = [
    ['declaratieType', 'Declaratietype'], ['bestemming', 'Bestemming'], ['grenscontrolepost', 'Grenscontrolepost'],
    ['landOorsprong', 'Land van oorsprong'], ['landLading', 'Land van lading'], ['gecertificeerdVoor', 'Gecertificeerd voor (I.18)'],
    ['transportconditie', 'Transportconditie'], ['vervoermiddel', 'Vervoermiddel']
  ];
  var ORGS = [['exporteur', 'Exporteur'], ['importeur', 'Importeur'], ['plaatsBestemming', 'Plaats van bestemming'], ['plaatsVerzending', 'Inrichting van oorsprong']];
  var ORG_VELDEN = [['naam', 'naam'], ['adres', 'adres'], ['plaats', 'plaats'], ['land', 'land'], ['erkenningsnummer', 'erkenningsnummer']];
  var GOED_VELDEN = [['gnCode', 'GN-code'], ['animoCode', 'Animo-code'], ['verpakkingstype', 'verpakking'], ['erkenningsnummer', 'erkenningsnummer'], ['aardProduct', 'aard product']];
  var DOC_VELDEN = [['portbaseType', 'type in Portbase'], ['opnemen', 'opnemen in GGB']];

  function veldW(k) { return { pad: k + '.waarde', get: function (r) { return s(r[k] && r[k].waarde); }, set: function (r, v) { r[k].waarde = v; r[k].bron = 'Smart Memory'; r[k].zekerheid = 'hoog'; } }; }

  /**
   * Leerbare velden van een voorstel: [{sleutel, label, globaal?, get(r), set(r, v)}].
   * Goederen zijn gekoppeld aan de GN-code, documenten aan het type, vlaggenstaat aan het schip.
   */
  function velden(r) {
    var v = [];
    ALGEMEEN.forEach(function (a) { if (r[a[0]]) v.push(Object.assign({ sleutel: a[0], label: a[1] }, veldW(a[0]))); });
    var schip = norm(r.vervoermiddelNaam && r.vervoermiddelNaam.waarde);
    if (schip && r.vervoermiddelNationaliteit) {
      v.push(Object.assign(veldW('vervoermiddelNationaliteit'), { sleutel: 'vlag|' + schip, label: 'Vlaggenstaat ' + s(r.vervoermiddelNaam.waarde), globaal: true }));
    }
    ORGS.forEach(function (o) {
      if (!r[o[0]]) return;
      ORG_VELDEN.forEach(function (f) {
        v.push({ sleutel: o[0] + '.' + f[0], label: o[1] + ': ' + f[1], pad: o[0] + '.' + f[0],
          get: function (x) { return s(x[o[0]][f[0]]); }, set: function (x, w) { x[o[0]][f[0]] = w; } }); // bron blijft: die geldt voor de hele organisatie
      });
    });
    var gezien = {};
    (r.goederen || []).forEach(function (g, i) {
      var gn = s(g.gnCode);
      if (!gn || gezien[gn]) return;
      gezien[gn] = 1;
      GOED_VELDEN.forEach(function (f) {
        v.push({ sleutel: 'goed:' + gn + '.' + f[0], label: 'GN ' + gn + ': ' + f[1], pad: 'goederen.' + i + '.' + f[0],
          get: function (x) { return s(x.goederen[i] && x.goederen[i][f[0]]); }, set: function (x, w) { x.goederen[i][f[0]] = w; } });
      });
    });
    var types = {};
    (r.documenten || []).forEach(function (d, i) {
      if (!d.type || types[d.type]) return;
      types[d.type] = 1;
      DOC_VELDEN.forEach(function (f) {
        v.push({ sleutel: 'doc:' + d.type + '.' + f[0], label: 'Document ' + d.type + ': ' + f[1], pad: 'documenten.' + i + '.' + f[0],
          get: function (x) { var w = x.documenten[i] && x.documenten[i][f[0]]; return typeof w === 'boolean' ? (w ? 'ja' : 'nee') : s(w); },
          set: function (x, w) { var doc = x.documenten[i]; if (f[0] === 'opnemen') doc.opnemen = w === 'ja'; else { doc[f[0]] = w; doc.portbaseTypeHandmatig = true; } } });
      });
    });
    return v;
  }

  /* ---------------- aandachtspunten ---------------- */

  /** Zelfde soort aandachtspunt over zendingen heen: getallen en "…" weg. */
  function waarschuwingSleutel(tekst) {
    return norm(s(tekst).replace(/"[^"]*"/g, ' q ').replace(/\d+([.,]\d+)*/g, ' n '));
  }
  /** Ernst van een aandachtspunt: kritiek, let (op) of info. */
  function niveau(tekst) {
    var t = s(tekst).toLowerCase();
    if (/ongeldig|controlecijfer|groter dan|geen gezondheidscertificaat|ontbreekt|verplicht/.test(t)) return 'kritiek';
    // Brutogewicht: afwijkende som, ongeldige waarde uit een document of niet te verdelen – nooit vanzelf akkoord
    if (/af van het totaal brutogewicht|is negatief|kleiner dan het nettogewicht|niet te berekenen/.test(t)) return 'kritiek';
    if (/berekend|overgenomen|standaard|afgeleid|naar rato|staat als nummer/.test(t)) return 'info';
    return 'let';
  }

  /* ---------------- leren ---------------- */

  function kopie(x) { return JSON.parse(JSON.stringify(x)); }

  /** Vaste gegevens van een voorstel als sjabloon (ruwe vorm voor GGB_AI.normaliseer). */
  function sjabloon(r) {
    var w = function (k) { return { waarde: s(r[k] && r[k].waarde), bron: 'Sjabloon', zekerheid: 'middel' }; };
    var t = {};
    ALGEMEEN.forEach(function (a) { t[a[0]] = w(a[0]); });
    ORGS.forEach(function (o) {
      var p = r[o[0]] || {};
      t[o[0]] = { naam: s(p.naam), adres: s(p.adres), plaats: s(p.plaats), land: s(p.land), erkenningsnummer: s(p.erkenningsnummer), bron: 'Sjabloon', zekerheid: 'middel' };
    });
    t.goederen = (r.goederen || []).map(function (g) {
      return { gnCode: s(g.gnCode), gnCodeHc: s(g.gnCodeHc), omschrijving: s(g.omschrijving), verpakkingstype: s(g.verpakkingstype), erkenningsnummer: s(g.erkenningsnummer),
        animoCode: s(g.animoCode), wetenschappelijkeNaam: s(g.wetenschappelijkeNaam), aardProduct: s(g.aardProduct), bron: 'Sjabloon', zekerheid: 'middel' };
    });
    t.containers = []; t.documenten = []; t.waarschuwingen = [];
    return t;
  }

  /**
   * Dossier bewaren na een invulronde.
   * @param d {id, tijd, origineel (AI-voorstel vóór het geheugen), definitief, triage {tekst: 'akkoord'}, dossierNr}
   */
  function leer(g, d) {
    var org = d.origineel, def = d.definitief;
    var p = profiel(org) || profiel(def);
    if (!p) return null;
    // Sleutels uit het AI-voorstel (zo komt de AI er de volgende keer ook mee); de getters
    // werken op index, dus get(def) leest het veld zoals de gebruiker het gebruikte.
    var obs = {};
    velden(org).forEach(function (v) {
      obs[v.sleutel] = { ai: v.get(org), finaal: v.get(def), label: v.label, globaal: !!v.globaal };
    });
    var ws = {};
    (def.waarschuwingen || []).forEach(function (t) { ws[waarschuwingSleutel(t)] = (d.triage || {})[t] === 'akkoord'; });
    var hc = (def.documenten || []).filter(function (x) { return x.type === 'HC'; })[0];
    var dossier = {
      id: s(d.id) || String(d.tijd || Date.now()), tijd: d.tijd || Date.now(), profiel: p.sleutel,
      exporteur: s(def.exporteur && def.exporteur.naam) || p.exporteur, ontvanger: ontvangerVan(def) || p.ontvanger,
      dossierNr: s(d.dossierNr), bol: s(def.bol && def.bol.waarde), hc: hc ? s(hc.identificatie) : '',
      gn: (def.goederen || []).map(function (x) { return x.gnCode; }).filter(Boolean),
      obs: obs, waarschuwingen: ws, sjabloon: sjabloon(def)
    };
    g.dossiers = g.dossiers.filter(function (x) { return x.id !== dossier.id; });
    g.dossiers.unshift(dossier);
    if (g.dossiers.length > MAX_DOSSIERS) g.dossiers.length = MAX_DOSSIERS;
    return dossier;
  }

  /* ---------------- toepassen ---------------- */

  function dossiersVan(g, sleutel) { return g.dossiers.filter(function (x) { return x.profiel === sleutel; }); }
  function regelsVan(g, sleutel) { return g.regels[sleutel] || (g.regels[sleutel] = { uit: {}, altijdAkkoord: {} }); }

  /** Statistiek per veld: welke eindwaarden, hoe vaak, en hoe vaak de AI het anders had. */
  function statistiek(lijst, sleutel) {
    var t = { totaal: 0, gecorrigeerd: 0, waarden: {} };
    lijst.forEach(function (d) {
      var o = d.obs[sleutel];
      if (!o) return;
      t.totaal++;
      if (norm(o.ai) !== norm(o.finaal)) t.gecorrigeerd++;
      var k = norm(o.finaal), w = t.waarden[k] || (t.waarden[k] = { waarde: o.finaal, n: 0 });
      w.n++;
    });
    return t;
  }

  /** Wat het geheugen weet over het profiel van dit voorstel. */
  function herken(g, r) {
    var p = profiel(r);
    if (!p) return null;
    var lijst = dossiersVan(g, p.sleutel);
    return { sleutel: p.sleutel, exporteur: p.exporteur, ontvanger: p.ontvanger, aantal: lijst.length, laatst: lijst[0] ? lijst[0].tijd : null, laatsteDossier: lijst[0] || null };
  }

  /**
   * Voorgestelde correcties voor een vers AI-voorstel: [{sleutel, label, pad, van, naar, n, totaal}].
   */
  function suggesties(g, r) {
    var p = profiel(r);
    if (!p) return [];
    var eigen = dossiersVan(g, p.sleutel), uit = regelsVan(g, p.sleutel).uit;
    return velden(r).map(function (v) {
      if (uit[v.sleutel]) return null;
      var t = statistiek(v.globaal ? g.dossiers : eigen, v.sleutel);
      if (!t.gecorrigeerd || !t.totaal) return null;
      var beste = Object.keys(t.waarden).map(function (k) { return t.waarden[k]; }).sort(function (a, b) { return b.n - a.n; })[0];
      var nu = v.get(r);
      if (!beste || !beste.waarde || beste.n < MIN_BEVESTIGD || beste.n / t.totaal < MIN_AANDEEL || norm(nu) === norm(beste.waarde)) return null;
      return { sleutel: v.sleutel, label: v.label, pad: v.pad, van: nu, naar: beste.waarde, n: beste.n, totaal: t.totaal, globaal: !!v.globaal, veld: v };
    }).filter(Boolean);
  }

  /** Status per aandachtspunt: {tekst: {akkoord, gezien, auto, altijd, niveau}}. */
  function triageAdvies(g, r) {
    var p = profiel(r), uit = {};
    var lijst = p ? dossiersVan(g, p.sleutel) : [], altijd = p ? regelsVan(g, p.sleutel).altijdAkkoord : {};
    (r.waarschuwingen || []).forEach(function (t) {
      var k = waarschuwingSleutel(t), a = 0, n = 0;
      lijst.forEach(function (d) { if (k in d.waarschuwingen) { n++; if (d.waarschuwingen[k]) a++; } });
      var nv = niveau(t);
      uit[t] = { akkoord: a, gezien: n, niveau: nv, altijd: !!altijd[k],
        auto: !!altijd[k] || (nv !== 'kritiek' && a >= MIN_BEVESTIGD && a / Math.max(1, n) >= MIN_AANDEEL) };
    });
    return uit;
  }

  /**
   * Past het geheugen toe op een vers AI-voorstel (muteert r).
   * @returns {profiel, toegepast: [...suggesties], triage: {...}}
   */
  function pasToe(g, r) {
    var toegepast = suggesties(g, r);
    toegepast.forEach(function (x) { x.veld.set(r, x.naar); delete x.veld; });
    return { profiel: herken(g, r), toegepast: toegepast, triage: triageAdvies(g, r) };
  }

  /* ---------------- beheer ---------------- */

  /** Recente routes voor het startscherm: één regel per profiel, nieuwste eerst. */
  function recentePatronen(g, max) {
    var per = {}, volgorde = [];
    g.dossiers.forEach(function (d) {
      if (!per[d.profiel]) { per[d.profiel] = { sleutel: d.profiel, exporteur: d.exporteur, ontvanger: d.ontvanger, aantal: 0, laatst: d.tijd, dossier: d, dossierNrs: [], gn: {} }; volgorde.push(d.profiel); }
      var p = per[d.profiel];
      p.aantal++;
      if (d.dossierNr && p.dossierNrs.length < 3) p.dossierNrs.push(d.dossierNr);
      d.gn.forEach(function (x) { p.gn[x] = 1; });
    });
    return volgorde.slice(0, max || 6).map(function (k) { var p = per[k]; p.gn = Object.keys(p.gn); return p; });
  }

  function dossierOpId(g, id) { return g.dossiers.filter(function (d) { return d.id === id; })[0] || null; }
  function zetUit(g, profielSleutel, veldSleutel, uit) { var r = regelsVan(g, profielSleutel); if (uit) r.uit[veldSleutel] = true; else delete r.uit[veldSleutel]; }
  function zetAltijdAkkoord(g, profielSleutel, tekst, aan) { var r = regelsVan(g, profielSleutel), k = waarschuwingSleutel(tekst); if (aan) r.altijdAkkoord[k] = true; else delete r.altijdAkkoord[k]; }
  /* ---------------- organisaties (Portbase-keuzes) ---------------- */

  var MAX_ORGS = 500;
  var ROLLEN = { exporter: 'Exporteur', importer: 'Importeur', bestemming: 'Plaats van bestemming', inrichting: 'Inrichting van oorsprong' };
  /* Kolommen van het Portbase-organisatievenster: [veld, kolomklasse (.mat-column-…), kop]. */
  var KOLOMMEN = [['naam', 'name', 'Name'], ['adres', 'address', 'Address'], ['postcode', 'postalCode', 'Postal code'], ['plaats', 'city', 'City'],
    ['erkenningsnummer', 'approvalNumber', 'Approval number'], ['idType', 'identificationType', 'ID type'], ['idNummer', 'identificationNumber', 'ID number'],
    ['activiteit', 'activity', 'Activity'], ['sectie', 'section', 'Section'], ['hoofdstuk', 'activityDepartment', 'Chapter']];

  function normRij(r) {
    var x = {};
    KOLOMMEN.forEach(function (k) { x[k[0]] = s(r && r[k[0]]).replace(/\s+/g, ' '); });
    return x;
  }
  /** Regel uit de cellen van een Portbase-tabelrij: cel(kolomklasse) -> tekst. */
  function rijUitCellen(cel) {
    var x = {};
    KOLOMMEN.forEach(function (k) { x[k[0]] = cel(k[1]); });
    return normRij(x);
  }

  /** Woorden van een bedrijfsnaam zonder rechtsvorm; Kühne = Kuehne = Kuhne, "+" en "&" tellen niet. */
  function naamWoorden(v) {
    var t = s(v).replace(/[äÄ]/g, 'a').replace(/[öÖ]/g, 'o').replace(/[üÜ]/g, 'u');
    t = norm(t).replace(/([a-z])([aou])e(?=[a-z])/g, function (m, a, b) { return a + b; }); // kuehne -> kuhne
    return t.replace(RECHTSVORM, ' ').split(/\s+/).filter(Boolean);
  }
  /**
   * Past naam a bij naam b? 3 = gelijk, 2 = de kortste is het begin van de langste
   * ("Kühne + Heitz" ~ "KUHNE + HEITZ HOLLAND B.V."; minstens 2 woorden of 8 letters), 0 = niet.
   */
  function pastNaam(a, b) {
    var ta = naamWoorden(a), tb = naamWoorden(b);
    if (!ta.length || !tb.length) return 0;
    if (ta.join(' ') === tb.join(' ')) return 3;
    var kort = ta.length <= tb.length ? ta : tb, lang = kort === ta ? tb : ta;
    if (kort.length < 2 && kort.join('').length < 8) return 0;
    return kort.every(function (w, i) { return lang[i] === w; }) ? 2 : 0;
  }

  function ids(v) { return s(v).split(/[\s,;/]+/).map(function (x) { return norm(x).replace(/ /g, ''); }).filter(Boolean); }
  function compactN(v) { return norm(v).replace(/ /g, ''); }

  /**
   * Is regel b dezelfde Portbase-regel als a? Zelfde naam, zelfde activiteit (als
   * beide bekend), en een overeenkomend ID-nummer, erkenningsnummer, of
   * postcode + plaats / adres + plaats.
   */
  function zelfdeRij(a, b) {
    a = normRij(a); b = normRij(b);
    if (!a.naam || pastNaam(a.naam, b.naam) !== 3) return false;
    if (a.activiteit && b.activiteit && norm(a.activiteit) !== norm(b.activiteit)) return false;
    var ia = ids(a.idNummer), ib = ids(b.idNummer);
    if (ia.length && ib.length) return ia.some(function (x) { return ib.indexOf(x) >= 0; });
    if (a.erkenningsnummer && b.erkenningsnummer) return compactN(a.erkenningsnummer) === compactN(b.erkenningsnummer);
    var plaats = norm(a.plaats) && norm(a.plaats) === norm(b.plaats);
    if (a.postcode && b.postcode) return plaats && compactN(a.postcode) === compactN(b.postcode);
    if (a.adres && b.adres) return plaats && norm(a.adres) === norm(b.adres);
    return !!plaats;
  }

  /** Korte omschrijving van een regel: naam · plaats · ID · activiteit. */
  function rijTekst(r) {
    r = normRij(r);
    var id = [r.idType, r.idNummer].filter(Boolean).join(' ');
    return [r.naam, [r.postcode, r.plaats].filter(Boolean).join(' '), r.erkenningsnummer, id, r.activiteit].filter(Boolean).join(' · ');
  }

  /**
   * Geleerde organisatie voor een naam (van het HC) in een rol, of null.
   * Een geleerde naam of de Portbase-naam moet passen; bij gelijke stand wint
   * exact boven "begint met", dan de vaakst gebruikte.
   */
  function vindOrganisatie(g, naam, rol, land) {
    if (!g || !g.organisaties || !s(naam)) return null;
    var best = null, score = 0;
    g.organisaties.forEach(function (e) {
      if (e.rol !== rol) return;
      if (land && e.land && s(land).toUpperCase() !== s(e.land).toUpperCase()) return;
      var sc = [e.rij.naam].concat(e.namen || []).reduce(function (m, n) { return Math.max(m, pastNaam(naam, n)); }, 0);
      if (sc < 2) return;
      sc = sc * 1e6 + (e.keer || 0) * 1e3 + ((e.tijd || 0) % 1e3) / 1e3;
      if (sc > score) { score = sc; best = e; }
    });
    return best;
  }

  /**
   * Leert een keuze: bij naam (van het HC) in rol hoort Portbase-regel rij.
   * Kiest de gebruiker voor dezelfde naam een andere regel, dan vervangt die
   * de oude (correctie). Geeft {organisatie, nieuw} of null.
   */
  function leerOrganisatie(g, x) {
    if (!g.organisaties) g.organisaties = [];
    var rij = normRij(x.rij), rol = s(x.rol), naam = s(x.naam), land = s(x.land).toUpperCase().slice(0, 2);
    if (!rij.naam || !ROLLEN[rol]) return null;
    var e = g.organisaties.filter(function (o) { return o.rol === rol && zelfdeRij(o.rij, rij); })[0];
    // Correctie: deze naam hoorde eerder bij een andere regel.
    if (naam) g.organisaties.forEach(function (o) {
      if (o === e || o.rol !== rol) return;
      var voor = (o.namen || []).length;
      o.namen = (o.namen || []).filter(function (n) { return pastNaam(n, naam) !== 3; });
      if (o.namen.length < voor && pastNaam(o.rij.naam, rij.naam) === 3) o.weg = true; // zelfde bedrijf, verkeerde regel
    });
    g.organisaties = g.organisaties.filter(function (o) { return !o.weg; });
    var nieuw = !e;
    if (!e) {
      e = { id: 'org-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7), rol: rol, land: land, namen: [], rij: rij, bron: s(x.bron) || 'portbase', keer: 0, tijd: 0 };
      g.organisaties.unshift(e);
    }
    e.rij = Object.assign({}, e.rij, Object.keys(rij).reduce(function (o, k) { if (rij[k]) o[k] = rij[k]; return o; }, {}));
    if (land) e.land = land;
    if (naam && pastNaam(naam, e.rij.naam) !== 3 && !(e.namen || []).some(function (n) { return pastNaam(n, naam) === 3; })) e.namen.push(naam);
    e.keer = (e.keer || 0) + 1;
    e.tijd = x.tijd || Date.now();
    if (g.organisaties.length > MAX_ORGS) g.organisaties.length = MAX_ORGS;
    return { organisatie: e, nieuw: nieuw };
  }

  function vergeetOrganisatie(g, id) { g.organisaties = (g.organisaties || []).filter(function (o) { return o.id !== id; }); }

  var ID_TYPE = /^(OAI|EOR|EORI|VAT|TIN|CRN|KVK|NAT|OTH|DUNS|LEI|BTW|UID|SIRET)$/i;
  var KOPPEN = KOLOMMEN.map(function (k) { return norm(k[2]); }).concat(['postal code', 'id type', 'id number', 'approval number']);

  /**
   * Regel uit een stuk geplakte tekst uit Portbase: een tabelrij (tabs tussen de
   * kolommen) of de kolommen onder elkaar, met of zonder de koppen ervoor.
   * Meerdere ID's (bijv. OAI + EOR) mogen onder elkaar staan.
   */
  function rijUitTekst(tekst) {
    var regels = s(tekst).split(/\r?\n/).map(function (r) { return r.replace(/ /g, ' ').trim(); });
    var tab = regels.filter(function (r) { return r.indexOf('\t') >= 0 && KOPPEN.indexOf(norm(r.split('\t')[0])) < 0; })[0];
    if (tab) {
      var c = tab.split('\t').map(function (x) { return x.trim(); });
      if (c.length >= 10) { var x = {}; KOLOMMEN.forEach(function (k, i) { x[k[0]] = c[i]; }); return normRij(x); }
      regels = c;
    }
    var v = regels.filter(function (r) { return r && KOPPEN.indexOf(norm(r)) < 0; });
    var r = { naam: v.shift() || '', adres: v.shift() || '' };
    if (v[0] && /^(\d{4}\s?[A-Z]{2}|\d{3,6}(-\d{3,4})?|[A-Z]{1,2}\d[\dA-Z]?\s?\d[A-Z]{2}|[A-Z]{1,2}-?\d{4,5})$/i.test(v[0]) && v.length > 1) r.postcode = v.shift();
    // Achteraan: activiteit ("IM - importer"), sectie (OTH-OPER) en hoofdstuk (veterinary).
    var ai = -1;
    v.forEach(function (x, i) { if (/^[A-Z]{2,3}\s+-\s+\S/.test(x)) ai = i; });
    if (ai >= 0) {
      var staart = v.splice(ai);
      r.activiteit = staart[0]; r.sectie = staart[1] || ''; r.hoofdstuk = staart.slice(2).join(' ');
    }
    if (v.length && !ID_TYPE.test(v[0])) r.plaats = v.shift();
    // Midden: erkenningsnummer (optioneel), ID-types, ID-nummers.
    var types = v.filter(function (x) { return x.split(/\s+/).every(function (w) { return ID_TYPE.test(w); }); });
    var rest = v.filter(function (x) { return types.indexOf(x) < 0; });
    var nTypes = types.join(' ').split(/\s+/).filter(Boolean).length;
    if (rest.length > nTypes) r.erkenningsnummer = rest.shift();
    r.idType = types.join(' ');
    r.idNummer = rest.join(' ');
    return normRij(r);
  }

  function voegOrganisatiesSamen(g, lijst) {
    var n = 0;
    (lijst || []).forEach(function (o) {
      if (!o || !o.rij || !ROLLEN[o.rol]) return;
      var e = g.organisaties.filter(function (x) { return x.id === o.id || (x.rol === o.rol && zelfdeRij(x.rij, o.rij)); })[0];
      if (!e) { g.organisaties.push(kopie(o)); n++; return; }
      (o.namen || []).forEach(function (naam) { if (!e.namen.some(function (m) { return pastNaam(m, naam) === 3; })) e.namen.push(naam); });
    });
    return n;
  }

  function vergeetProfiel(g, profielSleutel) { g.dossiers = g.dossiers.filter(function (d) { return d.profiel !== profielSleutel; }); delete g.regels[profielSleutel]; }

  /** Geheugen van een collega samenvoegen (dossiers op id, regels per profiel). */
  function voegSamen(g, x) {
    x = laad(kopie(x));
    var ids = {};
    g.dossiers.forEach(function (d) { ids[d.id] = 1; });
    var nieuw = x.dossiers.filter(function (d) { return !ids[d.id]; });
    g.dossiers = g.dossiers.concat(nieuw).sort(function (a, b) { return b.tijd - a.tijd; }).slice(0, MAX_DOSSIERS);
    Object.keys(x.regels).forEach(function (k) {
      var doel = regelsVan(g, k), bron = x.regels[k];
      Object.assign(doel.uit, bron.uit || {}); Object.assign(doel.altijdAkkoord, bron.altijdAkkoord || {});
    });
    if (!g.organisaties) g.organisaties = [];
    g.laatstSamengevoegdeOrganisaties = voegOrganisatiesSamen(g, x.organisaties);
    return nieuw.length;
  }

  var exported = {
    VERSIE: VERSIE, MIN_BEVESTIGD: MIN_BEVESTIGD, MIN_AANDEEL: MIN_AANDEEL,
    leeg: leeg, laad: laad, profiel: profiel, velden: velden, waarschuwingSleutel: waarschuwingSleutel, niveau: niveau,
    leer: leer, herken: herken, suggesties: suggesties, triageAdvies: triageAdvies, pasToe: pasToe, sjabloon: sjabloon,
    recentePatronen: recentePatronen, dossierOpId: dossierOpId, zetUit: zetUit, zetAltijdAkkoord: zetAltijdAkkoord,
    vergeetProfiel: vergeetProfiel, voegSamen: voegSamen, kopie: kopie,
    ROLLEN: ROLLEN, KOLOMMEN: KOLOMMEN, rijUitCellen: rijUitCellen, rijUitTekst: rijUitTekst, normRij: normRij, rijTekst: rijTekst,
    pastNaam: pastNaam, zelfdeRij: zelfdeRij, vindOrganisatie: vindOrganisatie, leerOrganisatie: leerOrganisatie, vergeetOrganisatie: vergeetOrganisatie
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_GEHEUGEN = exported;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
