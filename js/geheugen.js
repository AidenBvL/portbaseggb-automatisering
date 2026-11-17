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
 * Opslag gebeurt door de aanroeper (chrome.storage.local); niets verlaat de pc.
 */
(function (root) {
  'use strict';

  var VERSIE = 1, MAX_DOSSIERS = 150, MIN_BEVESTIGD = 2, MIN_AANDEEL = 0.75;

  function s(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return s(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var RECHTSVORM = /\b(b ?v|n ?v|ltd|limited|co|company|corp|corporation|gmbh|llc|inc|s ?a|spa|sarl|plc|jsc|pvt|private)\b/g;
  function kaal(v) { return norm(v).replace(RECHTSVORM, ' ').replace(/\s+/g, ' ').trim(); }

  function leeg() { return { versie: VERSIE, dossiers: [], regels: {} }; }
  /** Opgeslagen geheugen inlezen (onbekend of oud formaat: leeg beginnen). */
  function laad(x) {
    if (!x || x.versie !== VERSIE || !Array.isArray(x.dossiers)) return leeg();
    x.regels = x.regels || {};
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
    return nieuw.length;
  }

  var exported = {
    VERSIE: VERSIE, MIN_BEVESTIGD: MIN_BEVESTIGD, MIN_AANDEEL: MIN_AANDEEL,
    leeg: leeg, laad: laad, profiel: profiel, velden: velden, waarschuwingSleutel: waarschuwingSleutel, niveau: niveau,
    leer: leer, herken: herken, suggesties: suggesties, triageAdvies: triageAdvies, pasToe: pasToe, sjabloon: sjabloon,
    recentePatronen: recentePatronen, dossierOpId: dossierOpId, zetUit: zetUit, zetAltijdAkkoord: zetAltijdAkkoord,
    vergeetProfiel: vergeetProfiel, voegSamen: voegSamen, kopie: kopie
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_GEHEUGEN = exported;
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
