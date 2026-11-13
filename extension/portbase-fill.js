/*
 * Vult het Portbase-formulier "New declaration" (Angular Material) met het
 * AI-voorstel uit js/ggb-ai.js.
 *
 * Werkwijze per veld:
 *  - zoek het element via data-test / formcontrolname / id, anders via de
 *    zichtbare label-tekst (mat-label) van het veld;
 *  - gewone invoer: waarde zetten + input/change/blur, zodat Angular het oppakt;
 *  - mat-select: openen, wachten tot de lijst staat, de best passende optie
 *    kiezen en controleren dat Angular die overneemt (anders pijltjes + Enter);
 *  - autocomplete (combobox): typen, wachten op een passende suggestie, kiezen
 *    en controleren;
 *  - mat-button-toggle (EU standard, Consumer package indicator): altijd Yes;
 *  - zoekvensters (exporteur, importeur, grenscontrolepost, plaats van
 *    bestemming, inrichting van oorsprong, GN-code, Animo-code,
 *    erkenningsnummer): land, zoeken, wachten tot Portbase echt antwoordt
 *    (zoekverzoek terug + stabiele resultaten; geen vaste korte time-out),
 *    bij "No results" verder zoeken op trefwoorden, regel kiezen, wachten tot
 *    die als gekozen wordt getoond en dan Save in het venster; zonder
 *    duidelijke winnaar Cancel en "handmatig";
 *  - datums in de notatie van het formulier (standaard MM/DD/YYYY, 11/29/2026).
 *
 * Er wordt nooit op Save/Send van de declaratie geklikt: de declarant
 * controleert en verstuurt zelf.
 */
(function (root) {
  'use strict';

  var RULES = root.GGB_RULES || {};
  var DOC_TYPES = RULES.DOC_TYPES || {};

  /* ---------------- hulpfuncties ---------------- */

  function txt(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function q(sel, ctx) { try { return (ctx || document).querySelector(sel); } catch (e) { return null; } }
  function qa(sel, ctx) { try { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function wacht(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

  /**
   * Pauze tussen stappen. Portbase (Angular) verwerkt een klik pas na change
   * detection en haalt zoekresultaten via de API op; te snel doorklikken gaf
   * lege keuzes en "Save" zonder gekozen regel.
   */
  var TEMPO = 350;

  /* Toestand van de lopende invulronde: max. wachttijd op zoekresultaten, trefwoorden, stoppen, voortgang. */
  var run = { maxWacht: 120000, trefwoorden: true, gestopt: false, status: function () {} };
  function maxWacht() { return run.maxWacht; }
  /** Stopt de lopende invulronde (knop "Stop" in het paneel). */
  function stop() { run.gestopt = true; }
  function instellen(opts) {
    opts = opts || {};
    run.maxWacht = Math.max(10, +opts.maxWacht || 120) * 1000;
    run.trefwoorden = opts.trefwoorden !== false;
    run.status = typeof opts.status === 'function' ? opts.status : function () {};
  }

  async function wachtOp(fn, timeout) {
    var eind = Date.now() + (timeout || 2500);
    while (Date.now() < eind) {
      if (run.gestopt) return null;
      var r = fn();
      if (r) return r;
      await wacht(80);
    }
    return null;
  }

  /**
   * Wacht tot fn() een waarde geeft die minstens rustMs gelijk blijft (zelfde
   * element of zelfde handtekening). Zo wordt niet gekozen uit een lijst die nog
   * wordt opgebouwd of gefilterd.
   */
  async function wachtStabiel(fn, rustMs, timeout, sleutel) {
    sleutel = sleutel || function (x) { return x; };
    var eind = Date.now() + (timeout || 4000), vorige = null, sinds = 0;
    while (Date.now() < eind) {
      if (run.gestopt) return null;
      var r = fn();
      var k = r ? sleutel(r) : null;
      if (k !== vorige) { vorige = k; sinds = Date.now(); }
      else if (r && Date.now() - sinds >= rustMs) return r;
      await wacht(60);
    }
    var laatst = fn();
    return laatst || null;
  }

  /** Klik zoals een gebruiker: pointer- en muisgebeurtenissen gevolgd door click. */
  function klik(el) {
    var o = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: 1 };
    try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse', isPrimary: true }, o))); } catch (e) { /* oudere browser */ }
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'mouse', isPrimary: true }, o, { buttons: 0 }))); } catch (e) { /* oudere browser */ }
    el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, o, { buttons: 0 })));
    el.click();
  }

  /**
   * Toets naar één veld (pijltjes/Enter voor de keuzelijst). Het veld zelf
   * verwerkt de toets; daarboven wordt hij tegengehouden, zodat de zijbalk
   * met het formulier (sluit op toetsen als Escape) er niets van merkt.
   */
  function toets(el, key, keyCode) {
    var ev = new KeyboardEvent('keydown', { key: key, code: key, keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true });
    var ouder = el.parentElement;
    var stop = function (e) { if (e === ev) e.stopPropagation(); };
    if (ouder) ouder.addEventListener('keydown', stop);
    try { el.dispatchEvent(ev); } finally { if (ouder) ouder.removeEventListener('keydown', stop); }
  }

  /** Eerste element voor de selectors; zichtbare elementen gaan voor (verborgen secties hergebruiken data-test-namen). */
  function eerste(selectors, ctx) {
    var verborgen = null;
    for (var i = 0; i < selectors.length; i++) {
      var els = qa(selectors[i], ctx);
      for (var j = 0; j < els.length; j++) {
        if (zichtbaar(els[j])) return els[j];
        if (!verborgen) verborgen = els[j];
      }
    }
    return verborgen;
  }

  /** Zoekt een veld op label-tekst (mat-label in een mat-form-field of losse label). */
  function opLabel(re, ctx) {
    var velden = qa('mat-form-field, .mat-mdc-form-field', ctx);
    for (var i = 0; i < velden.length; i++) {
      var l = q('mat-label, label', velden[i]);
      if (l && re.test(txt(l))) {
        var c = q('mat-select, textarea, input:not([type="hidden"]):not(.hidden)', velden[i]);
        if (c) return c;
      }
    }
    var labels = qa('mat-label, label', ctx);
    for (var j = 0; j < labels.length; j++) {
      if (!re.test(txt(labels[j]))) continue;
      var box = labels[j].closest('.col, .row, div') || labels[j].parentElement;
      var c2 = box && q('mat-select, textarea, input:not([type="hidden"]):not(.hidden):not([hidden]), button[data-test]', box);
      if (c2) return c2;
    }
    return null;
  }

  function zoek(def, ctx) {
    return eerste(def.sel || [], ctx) || (def.label ? opLabel(def.label, ctx) : null);
  }

  function isSelect(el) { return el && (el.tagName === 'MAT-SELECT' || el.getAttribute('role') === 'combobox' && el.tagName !== 'INPUT'); }
  function isAutocomplete(el) {
    return el && el.tagName === 'INPUT' && (el.getAttribute('aria-autocomplete') === 'list' || el.getAttribute('role') === 'combobox' || el.hasAttribute('matautocomplete') || el.classList.contains('mat-mdc-autocomplete-trigger'));
  }

  function zetWaarde(el, waarde) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, waarde);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function blur(el) {
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function zichtbaar(el) { return !!(el && (el.offsetParent !== null || el.getClientRects().length)); }

  /**
   * Opties van de geopende keuzelijst/autocomplete. Portbase (Angular CDK met
   * popover="manual") zet het paneel naast het veld en niet in
   * .cdk-overlay-container; het veld wijst er via aria-controls naar.
   */
  function eigenPaneel(el) {
    if (!el || !el.getAttribute) return null;
    var ids = [el.getAttribute('aria-controls'), el.id ? el.id + '-panel' : ''];
    for (var i = 0; i < ids.length; i++) {
      var p = ids[i] ? document.getElementById(ids[i]) : null;
      if (p) return p;
    }
    return null;
  }

  function opties(el) {
    var eigen = eigenPaneel(el);
    var panelen = eigen ? [eigen] : qa('[role="listbox"], .mat-mdc-select-panel, .mat-mdc-autocomplete-panel, .cdk-overlay-container, .cdk-overlay-popover').filter(zichtbaar);
    var gezien = [];
    panelen.forEach(function (p) {
      qa('mat-option, [role="option"]', p).forEach(function (o) { if (gezien.indexOf(o) < 0) gezien.push(o); });
    });
    return gezien.filter(function (o) {
      return zichtbaar(o) && !o.classList.contains('mdc-list-item--disabled') && o.getAttribute('aria-disabled') !== 'true';
    });
  }

  /** Hoe goed past tekst t bij zoekterm (0 = niet, 4 = exact). Spaties tellen niet mee voor codes als OTPU 605155 7. */
  function termScore(tekst, term) {
    var t = norm(tekst), n = norm(term);
    if (!n || !t) return 0;
    if (t === n || t.replace(/ /g, '') === n.replace(/ /g, '')) return 4;
    if (new RegExp('(^| )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(t)) return 3;
    if (t.indexOf(n) === 0) return 2;
    if (n.length > 3 && (t.indexOf(n) >= 0 || (n.length >= 6 && t.replace(/ /g, '').indexOf(n.replace(/ /g, '')) >= 0))) return 1;
    return 0;
  }

  /** Kiest de optie die het best bij een van de zoektermen past. */
  function besteOptie(lijst, termen) {
    var best = null, score = 0;
    lijst.forEach(function (o) {
      var t = txt(o);
      termen.forEach(function (term, ti) {
        var sc = termScore(t, term);
        if (!sc) return;
        sc = sc * 100 - ti; // bij gelijke match wint de eerste (eigenlijke) zoekterm
        if (sc > score) { score = sc; best = o; }
      });
    });
    return best;
  }

  /** Past de tekst (minstens als heel woord) bij een van de termen? */
  function pastBij(tekst, termen) {
    return (termen || []).some(function (t) { return termScore(tekst, t) >= 3; });
  }

  /**
   * Sluit de open keuzelijst/suggestielijst van één veld. NOOIT met Escape:
   * Escape sluit de Portbase-zijbalk met het hele formulier (en een dialoog).
   * Een keuzelijst sluit via zijn eigen doorzichtige backdrop; een
   * suggestielijst via een klik op een neutrale plek in hetzelfde formulier
   * of venster (de titel), zoals een gebruiker naast de lijst klikt.
   */
  async function sluitOverlay(el) {
    if (!el || !(paneelOpen(el) || opties(el).length)) return;
    var p = eigenPaneel(el), pane = p && p.closest('.cdk-overlay-pane');
    var bd = pane && pane.previousElementSibling;
    // Alleen de doorzichtige backdrop van dit paneel (die van een dialoog is donker en sluit de dialoog).
    if (bd && bd.classList.contains('cdk-overlay-backdrop') && bd.classList.contains('cdk-overlay-transparent-backdrop')) bd.click();
    else {
      var dlg = el.closest('mat-dialog-container, [role="dialog"]'), kaart = el.closest('mat-card-content');
      var neutraal = (dlg && q('[mat-dialog-title], h2', dlg)) || (kaart && q('mat-card-title', kaart)) || el.closest('.row') || el.closest('form');
      if (neutraal) klik(neutraal);
    }
    await wachtOp(function () { return !paneelOpen(el) && !opties(el).length; }, 1000);
  }

  /** Tekst van de gekozen waarde in een mat-select ('' als leeg). */
  function selectTekst(el) { return txt(q('.mat-mdc-select-value-text, .mat-select-value-text', el)); }
  function paneelOpen(el) { return el.getAttribute('aria-expanded') === 'true' || !!eigenPaneel(el); }
  function optieGekozen(o) { return o.getAttribute('aria-selected') === 'true'; }

  /**
   * Terugval als een klik op de optie niet aankomt: met de pijltjestoetsen naar
   * de optie (aria-activedescendant, zoals de CDK ListKeyManager) en Enter.
   */
  async function kiesMetToetsen(el, doelTekst, klaar) {
    el.focus();
    for (var i = 0; i < 80; i++) {
      var lijst = opties(el);
      var doel = lijst.filter(function (o) { return txt(o) === doelTekst; })[0];
      if (!doel) return false;
      var actief = el.getAttribute('aria-activedescendant');
      if (actief && actief === doel.id) {
        toets(el, 'Enter', 13);
        return !!(await wachtOp(klaar, 1500));
      }
      var pos = lijst.map(function (o) { return o.id; }).indexOf(actief);
      if (pos >= 0 && pos > lijst.indexOf(doel)) toets(el, 'ArrowUp', 38);
      else toets(el, 'ArrowDown', 40);
      await wacht(50);
    }
    return false;
  }

  async function kiesInSelect(el, termen) {
    var huidig = selectTekst(el);
    if (huidig && termen.some(function (t) { return termScore(huidig, t) === 4; })) return { ok: true, gekozen: huidig };
    for (var poging = 0; poging < 2; poging++) {
      if (!paneelOpen(el)) {
        el.focus();
        klik(q('.mat-mdc-select-trigger', el) || el);
      }
      // Wachten tot het paneel klaar is (opties aanwezig en niet meer veranderend).
      var lijst = await wachtStabiel(function () { var o = opties(el); return o.length ? o : null; }, 250, 4000,
        function (l) { return l.length + ':' + (l[0].id || txt(l[0])); });
      if (!lijst) { await sluitOverlay(el); continue; }
      var o = besteOptie(lijst, termen);
      if (!o) { await sluitOverlay(el); return { ok: false, melding: 'geen passende optie voor "' + termen[0] + '" (opties: ' + lijst.slice(0, 8).map(txt).join(', ') + ')' }; }
      var tekst = txt(o);
      var klaar = function () { return optieGekozen(o) || (selectTekst(el) && termScore(selectTekst(el), tekst) === 4); };
      try { o.scrollIntoView({ block: 'nearest' }); } catch (e) { /* geen scroll */ }
      klik(o);
      var ok = await wachtOp(klaar, 1200);
      if (!ok) ok = await kiesMetToetsen(el, tekst, klaar);
      if (ok) {
        // Angular sluit het paneel en zet de waarde na change detection.
        await wachtOp(function () { return termScore(selectTekst(el), tekst) === 4; }, 1500);
        await sluitOverlay(el);
        await wacht(TEMPO);
        return { ok: true, gekozen: selectTekst(el) || tekst };
      }
      await sluitOverlay(el);
      await wacht(TEMPO);
    }
    if (!opties(el).length && !selectTekst(el)) return { ok: false, melding: 'keuzelijst ging niet open of Portbase nam de keuze niet over; kies zelf' };
    return { ok: false, melding: 'optie voor "' + termen[0] + '" aangeklikt, maar Portbase nam die niet over; kies zelf' };
  }

  /**
   * Autocomplete: zoekterm typen, wachten tot er een passende suggestie staat
   * (de lijst wordt via de API gefilterd), die kiezen en controleren dat het
   * veld de keuze heeft overgenomen.
   */
  async function kiesInAutocomplete(el, zoekterm, termen, timeout) {
    termen = termen && termen.length ? termen : [zoekterm];
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* geen scroll */ }
    zetWaarde(el, zoekterm);
    var o = await wachtStabiel(function () { var l = opties(el); return l.length ? besteOptie(l, termen) : null; }, 300, timeout || 8000);
    if (!o) {
      var l = opties(el);
      await sluitOverlay(el); blur(el);
      return { ok: false, melding: l.length ? 'geen passende suggestie voor "' + zoekterm + '" (opties: ' + l.slice(0, 6).map(txt).join(', ') + ')' : 'geen suggesties verschenen voor "' + zoekterm + '"; kies zelf uit de lijst' };
    }
    var tekst = txt(o);
    var klaar = function () {
      var w = String(el.value || '').trim();
      if (optieGekozen(o) || (norm(w) && norm(w) !== norm(zoekterm))) return true;
      // Paneel dicht en het veld toont (een deel van) de optie; Portbase toont na de keuze soms
      // alleen de code, bijv. "VN" voor "VN - Viet Nam", gelijk aan wat getypt is.
      return !!w && !opties(el).length && (termScore(w, tekst) >= 3 || termScore(tekst, w) >= 3);
    };
    klik(o);
    var ok = await wachtOp(klaar, 1500);
    if (!ok) ok = await kiesMetToetsen(el, tekst, klaar);
    await wacht(TEMPO);
    if (!ok) { await sluitOverlay(el); return { ok: false, melding: 'suggestie "' + tekst + '" aangeklikt, maar Portbase nam die niet over; kies zelf' }; }
    return { ok: true, gekozen: String(el.value || '').trim() || tekst };
  }

  /**
   * Vult één veld. def: {naam, sel, label, soort?, termen?}
   * Geeft {naam, waarde, status: 'ingevuld'|'handmatig'|'niet gevonden'|'fout'|'overgeslagen', melding}
   */
  async function vulVeld(def, waarde, ctx, opts, zoekOpdracht) {
    if (def.datum && waarde) waarde = AI_DATUM(waarde, opts.datumFormaat);
    var r = { naam: def.naam, waarde: waarde, status: 'ingevuld', melding: '' };
    if (!waarde) { r.status = 'overgeslagen'; return r; }
    if (run.gestopt) { r.status = 'overgeslagen'; r.melding = 'gestopt'; return r; }
    var el = zoek(def, ctx);
    if (!el) { r.status = 'niet gevonden'; r.melding = 'veld niet gevonden op de pagina'; return r; }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') { r.status = 'handmatig'; r.melding = 'veld is niet bewerkbaar'; return r; }
    if (def.soort === 'dialoog' || el.tagName === 'BUTTON') {
      // Portbase kiest dit via een zoekdialoog.
      r.knop = el;
      r.zoekterm = def.zoekterm ? def.zoekterm(waarde) : waarde;
      r.zoek = zoekOpdracht || { term: r.zoekterm };
      if (!opts.overschrijven) {
        var gekozen = huidigeKeuze(el);
        if (gekozen) { r.status = 'overgeslagen'; r.melding = 'al gekozen (' + gekozen + ')'; return r; }
      }
      if (!opts.dialogen) { r.status = 'handmatig'; r.melding = 'kies via "' + txt(el) + '"'; return r; }
      var dres = await afhandelen(el, r.zoek, opts);
      r.status = dres.opgeslagen ? 'ingevuld' : 'handmatig';
      r.melding = dres.melding || '';
      if (dres.opgeslagen && !(await keuzeOvergenomen(def, ctx, el))) {
        r.status = 'handmatig';
        r.melding += ' (Save geklikt, maar Portbase toont geen keuze; controleer en kies zelf)';
      }
      return r;
    }
    if (!opts.overschrijven && el.tagName === 'INPUT' && String(el.value || '').trim()) {
      r.status = 'overgeslagen'; r.melding = 'al ingevuld (' + el.value + ')'; return r;
    }
    try {
      el.scrollIntoView({ block: 'center' });
      var termen = (def.termen ? def.termen(waarde) : [waarde]).filter(Boolean);
      if (def.soort === 'tekst') {
        zetWaarde(el, waarde);
        blur(el);
        await sluitOverlay(el);
      } else if (isSelect(el)) {
        var s = await kiesInSelect(el, termen);
        if (!s.ok) { r.status = 'handmatig'; r.melding = s.melding; } else r.melding = s.gekozen !== waarde ? 'gekozen: ' + s.gekozen : '';
      } else if (el.readOnly || def.soort === 'selector') {
        r.status = 'handmatig'; r.melding = 'kies via de zoekknop van Portbase';
      } else if (isAutocomplete(el) || def.soort === 'autocomplete') {
        var a = await kiesInAutocomplete(el, def.zoekterm ? def.zoekterm(waarde) : waarde, termen);
        if (!a.ok) { r.status = 'handmatig'; r.melding = a.melding; } else r.melding = a.melding || (a.gekozen && a.gekozen !== waarde ? 'gekozen: ' + a.gekozen : '');
      } else {
        zetWaarde(el, waarde);
        blur(el);
      }
    } catch (e) {
      r.status = 'fout'; r.melding = e.message;
    }
    return r;
  }

  /** dd-mm-jjjj -> notatie van het formulier (standaard MM/DD/YYYY, bijv. 11/29/2026). */
  function AI_DATUM(v, formaat) {
    var ai = root.GGB_AI;
    if (ai && ai.naarPortbaseDatum) return ai.naarPortbaseDatum(v, formaat);
    var m = String(v).match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m && formaat !== 'DD-MM-YYYY' ? m[2] + '/' + m[1] + '/' + m[3] : v;
  }

  /**
   * Wat er nu gekozen is bij een dialoogknop. Nieuwe Portbase-opbouw: een
   * alleen-lezen veld (bijv. gn-code-selector) met een knop "Edit" ernaast;
   * oude opbouw: alleen een knop "Select …" waarvan de tekst de keuze wordt.
   */
  function huidigeKeuze(knop) {
    var vak = knop.closest('mat-form-field');
    var veld = vak && q('input[readonly], input[data-test$="-selector"]', vak);
    if (veld) return String(veld.value || '').trim();
    var t = txt(knop);
    return t && !/^(select\b|edit$)/i.test(t) ? t : '';
  }

  /**
   * Heeft Portbase de keuze uit het zoekvenster overgenomen? Alleen te zien bij
   * een alleen-lezen veld naast de knop of een knop "Select …" die van tekst
   * verandert; anders (bijv. alleen "Edit") wordt de Save vertrouwd.
   */
  async function keuzeOvergenomen(def, ctx, knop) {
    function nu() { var k = (knop && knop.isConnected ? knop : zoek(def, ctx)); return k || null; }
    var ok = await wachtOp(function () { var k = nu(); return k && huidigeKeuze(k) ? true : null; }, 2500);
    if (ok) return true;
    var k = nu();
    if (!k) return true;
    var vak = k.closest('mat-form-field');
    var controleerbaar = !!(vak && q('input[readonly], input[data-test$="-selector"]', vak)) || /^select\b/i.test(txt(k));
    return !controleerbaar;
  }

  /* ---------------- velddefinities ---------------- */

  function landTermen(code) { var naam = (root.GGB_LANDNAMEN || {})[code]; return [code, naam].filter(Boolean); }

  function zonderLand(v) { return String(v || '').replace(/\s*\([A-Z]{2}\)\s*$/, ''); }
  function zonderCode(v) { return String(v || '').replace(/\s*\([A-Z]{2}[A-Z0-9]{2,}\)\s*$/, ''); }
  function codeTussenHaakjes(v) { var m = String(v || '').match(/\(([A-Z]{2}[A-Z0-9]{2,})\)/); return m ? m[1] : v; }

  var VERVOER_TERMEN = {
    // Portbase-opties: Sea transport, Rail transport, Road transport, Air transport
    Vessel: ['Sea transport', 'Vessel', 'Sea'], Airplane: ['Air transport', 'Airplane', 'Air'],
    'Road vehicle': ['Road transport', 'Road vehicle', 'Road'], Railway: ['Rail transport', 'Railway', 'Rail']
  };

  // Selectors volgens de Portbase-pagina "New declaration" (Angular Material).
  // Let op: verborgen secties (Transit, Transhipment, Means of transport after
  // border) hergebruiken data-test-namen, daarom eerst op formulier/component scopen.
  var ALGEMEEN = [
    { naam: 'Bill of lading number (I.13)', key: 'bol', sel: ['app-form-general input[data-test="bill-of-lading-number"]', 'input[data-test="bill-of-lading-number"]'], label: /^bill of lading number/i },
    { naam: 'Destination (I.20-25)', key: 'bestemming', sel: ['mat-select[data-test="purpose-code"]', 'mat-select[formcontrolname="purposeCode"]'], label: /^destination/i },
    { naam: 'Exporter (I.1)', key: 'exporteur', sel: ['button[data-test="organisation-dialog-exporter"]'], label: /^exporter/i, soort: 'dialoog', zoekterm: zonderLand,
      dialoogZoek: function (r) { return orgZoek(r.exporteur, 'exporter', r.exporteur.land || r.landOorsprong.waarde, r); } },
    { naam: 'Importer (I.6)', key: 'importeur', sel: ['button[data-test="organisation-dialog-importer"]'], label: /^importer/i, soort: 'dialoog', zoekterm: zonderLand,
      dialoogZoek: function (r) { return orgZoek(r.importeur, 'importer', r.importeur.land || 'NL', r); } },
    { naam: 'Border control post (I.4)', key: 'grenscontrolepost', sel: ['button[data-test="border-control-post-dialog"]'], label: /^border control post/i, soort: 'dialoog', zoekterm: codeTussenHaakjes,
      dialoogZoek: function (r) { var v = r.grenscontrolepost.waarde; return { term: zonderCode(v), code: codeTussenHaakjes(v), land: 'NL' }; } },
    { naam: 'Place of destination (I.7)', key: 'plaatsBestemming', sel: ['button[data-test="place-of-destination-dialog"]'], label: /^place of destination/i, soort: 'dialoog',
      dialoogZoek: function (r) { return orgZoek(r.plaatsBestemming, 'bestemming', r.plaatsBestemming.land || r.importeur.land || 'NL', r); } },
    { naam: 'Country of origin (I.11)', key: 'landOorsprong', sel: ['app-form-general input[formcontrolname="countryOfOriginUnCode"]', 'input[data-test="country-of-origin-un-code"]'], label: /^country of origin/i, termen: landTermen },
    { naam: 'Country of loading (I.14)', key: 'landLading', sel: ['app-form-general input[formcontrolname="countryOfLoadingUnCode"]', 'input[formcontrolname="countryOfLoadingUnCode"]'], label: /^country of loading/i, termen: landTermen },
    // Altijd dezelfde cargo handler (autocomplete; zoeken op "Cory Brothers", kiezen "Cory Brothers B.V.").
    { naam: 'Cargo handler', key: 'cargoHandler', vast: 'Cory Brothers B.V.', sel: ['app-form-general input[data-test="cargo-handler"]', 'input[data-test="cargo-handler"]', 'input#cargoHandler', 'input[formcontrolname="cargoHandler"]'], label: /^cargo handler/i,
      soort: 'autocomplete', zoekterm: function () { return 'Cory Brothers'; } },
    { naam: 'Goods certified as or for (I.18)', key: 'gecertificeerdVoor', sectie: 'Goods', sel: ['mat-select[data-test="goods-intended-use-code"]', 'mat-select[formcontrolname="goodsIntendedUseCode"]'], label: /^goods certified/i },
    { naam: 'Transport conditions (I.16)', key: 'transportconditie', sectie: 'Goods', sel: ['mat-select[data-test="transport-conditions-code"]', 'mat-select[formcontrolname="transportConditionsCode"]'], label: /^transport conditions/i },
    { naam: 'Means of transport (I.13)', key: 'vervoermiddel', sectie: 'Means of transport', sel: ['mat-select[data-test="arrival-means-of-transport-mode"]', 'app-form-means-of-transport-before-border mat-select[formcontrolname="mode"]'],
      termen: function (v) { return VERVOER_TERMEN[v] || [v]; } },
    { naam: 'Name / identification (I.13)', key: 'vervoermiddelNaam', sectie: 'Means of transport', sel: ['input[data-test="arrival-means-of-transport-identification"]', 'app-form-means-of-transport-before-border input[formcontrolname="identification"]'] },
    { naam: 'Nationality (I.13)', key: 'vervoermiddelNationaliteit', sectie: 'Means of transport', sel: ['input[data-test="arrival-means-of-transport-nationality-un-code"]', 'app-form-means-of-transport-before-border input[formcontrolname="nationalityUnCode"]'], termen: landTermen },
    { naam: 'Expected date of arrival (I.10)', key: 'aankomstDatum', sectie: 'Means of transport', sel: ['app-form-means-of-transport-before-border input[data-test="arrival-date-time-estimated"]', 'input[data-test="arrival-date-time-estimated"]'], soort: 'tekst', datum: true },
    { naam: 'Expected time of arrival', key: 'aankomstTijd', sectie: 'Means of transport', sel: ['app-form-means-of-transport-before-border input[data-test="start-time"]', 'app-form-means-of-transport-before-border input.mat-timepicker-input'], soort: 'tekst' }
  ];

  var CONTAINER = [
    { naam: 'Equipment number', key: 'containernummer', sel: ['input[formcontrolname="equipmentNumber"]'], label: /^equipment number/i },
    { naam: 'Seal number', key: 'zegelnummer', sel: ['input[formcontrolname="sealNumber"]'], label: /^seal number/i }
  ];

  var DOCUMENT = [
    { naam: 'Type', key: 'type', sel: ['mat-select[data-test="document-type"]', 'mat-select[formcontrolname="documentType"]'], label: /^type$/i,
      // waarde is het exacte Portbase-type (bijv. "Certified lab report 2019/1793 (4)") of een documentcode
      termen: function (v) { var d = DOC_TYPES[v]; return d ? [d.portbase] : [v, String(v).replace(/\s*\([A-Z]?\d+\)\s*$/, '')]; } },
    { naam: 'Identification', key: 'identificatie', sel: ['input[data-test="document-number"]', 'input[formcontrolname="documentNumber"]'], label: /^identification$/i },
    { naam: 'Date of issue', key: 'datumAfgifte', sel: ['input[data-test="document-date-of-issue"]', 'input[formcontrolname="dateOfIssue"]'], label: /^date of issue/i, soort: 'tekst', datum: true },
    { naam: 'Establishment of origin', key: 'inrichtingOorsprong', sel: ['button[data-test="organisation-dialog"]'], label: /^establishment of origin/i, soort: 'dialoog',
      dialoogZoek: function (r, doc) {
        var pv = r.plaatsVerzending || {};
        var erk = pv.erkenningsnummer || (r.goederen || []).map(function (g) { return g.erkenningsnummer; }).filter(Boolean)[0] || '';
        return orgZoek(Object.assign({}, pv, { naam: pv.naam || doc.inrichtingOorsprong, erkenningsnummer: erk }), 'inrichting', pv.land || doc.landAfgifte || r.landOorsprong.waarde, r);
      } },
    { naam: 'Country of issue', key: 'landAfgifte', sel: ['input[data-test="document-country-un-code-of-issue"]', 'input[formcontrolname="countryUnCodeOfIssue"]'], label: /^country of issue/i, termen: landTermen }
  ];

  var GOED = [
    { naam: 'GN-code (I.31)', key: 'gnCode', sel: ['button[data-test="gn-code-dialog"]'], label: /^gn-code/i, soort: 'dialoog',
      dialoogZoek: function (r, g) {
        var a = animoInfo(g.animoCode);
        return { gn: g.gnCode, hc: g.gnCodeHc, term: g.gnCodeHc || g.gnCode, wetenschappelijk: g.wetenschappelijkeNaam, aard: g.aardProduct, animo: g.animoCode, omschrijving: g.omschrijving, hints: [g.aardProduct, a ? a.omschrijving : '', g.omschrijving].join(' ') };
      } },
    { naam: 'Goods description (I.31)', key: 'omschrijving', nietInvullen: true, sel: ['input[data-test="goods-description"]', 'input[formcontrolname="goodsDescription"]'], label: /^goods description/i },
    { naam: 'Gross weight (I.34)', key: 'brutoGewicht', sel: ['input[data-test="gross-weight"]', 'input[formcontrolname="grossWeight"]'], label: /^gross weight/i },
    { naam: 'Nett weight (I.34)', key: 'nettoGewicht', sel: ['input[data-test="nett-weight"]', 'input[formcontrolname="nettWeight"]'], label: /^nett? weight/i },
    { naam: 'Number of packages (I.32)', key: 'aantalColli', sel: ['input[data-test="packaging-number-of-packages"]', 'input[formcontrolname="numberOfPackages"]'], label: /^number of packages/i },
    { naam: 'Package type (I.32)', key: 'verpakkingstype', sel: ['mat-select[data-test="packaging-package-type"]', 'mat-select[formcontrolname="packageType"]'], label: /^package type/i,
      termen: verpakkingTermen },
    { naam: 'Batch number (I.34)', key: 'batchnummer', sel: ['input[formcontrolname="batchNumber"]'], label: /^batch number/i },
    { naam: 'Additional units (I.33)', key: 'aanvullendeEenheden', sel: ['input[formcontrolname="additionalUnits"]'], label: /^additional units/i },
    { naam: 'Activity / approval number (I.15)', key: 'erkenningsnummer', sel: ['button[data-test="establishment-dialog"]', 'button[data-test="organisation-dialog"]'], label: /^activity \/ approval number/i, soort: 'dialoog',
      dialoogZoek: function (r, g) {
        var pv = r.plaatsVerzending || {};
        return orgZoek(Object.assign({}, pv, { erkenningsnummer: g.erkenningsnummer || pv.erkenningsnummer }), 'inrichting', pv.land || r.landOorsprong.waarde || r.exporteur.land, r);
      } },
    { naam: 'Equipment number', key: 'containernummer', sel: ['mat-select[formcontrolname="equipmentNumber"]'], label: /^equipment number/i }
  ];

  /** Verpakkingssoort van het HC/de paklijst naar de Portbase-opties, bijv. "Carton (CT)", "Bag (BG)". */
  var VERPAKKING = [
    [/^(ctns?|cartons?|carton box(es)?|cartoon)$/i, 'Carton (CT)'], [/^(box(es)?|bx)$/i, 'Box (BX)'],
    [/^(bags?|sacks?|bg)$/i, 'Bag (BG)'], [/^(pallets?|plts?|px)$/i, 'Pallet (PX)'], [/^(packages?|pkgs?|pk|packs?)$/i, 'Package (PK)'],
    [/^(cases?|cs)$/i, 'Case (CS)'], [/^(cans?|tins?)$/i, 'Can (CA)'], [/^(drums?|dr)$/i, 'Drum (DR)'], [/^(jars?)$/i, 'Jar (JR)'],
    [/^(trays?)$/i, 'Tray (DT)'], [/^(crates?)$/i, 'Crate (CR)'], [/^(bulk)$/i, 'Bulk (VR)'], [/^(totes?)$/i, 'Tote (TT)'],
    [/^(containers?)$/i, 'Container (CN)'], [/^(unpacked|unpackaged|loose)$/i, 'Unpacked or unpackaged (NA)']
  ];
  function verpakkingTermen(v) {
    var w = String(v || '').trim();
    var kaal = w.replace(/\s*\([A-Z0-9]{2}\)\s*$/, '');
    var t = VERPAKKING.filter(function (x) { return x[0].test(kaal); }).map(function (x) { return x[1]; });
    return t.concat([w, kaal, kaal.replace(/e?s$/i, '')]).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }

  /** Knoppen Yes/No (mat-button-toggle) die altijd op Yes moeten. */
  var TOGGLES = [
    { naam: 'EU standard', sel: ['mat-button-toggle-group[formcontrolname="euStandard"]', 'mat-button-toggle-group[data-test="eu-standard"]', 'mat-button-toggle-group[formcontrolname*="euStandard" i]'], label: /^eu[\s-]*standards?\b/i, waarde: 'Yes' },
    { naam: 'Consumer package indicator (I.31)', sel: ['mat-button-toggle-group[formcontrolname="consumerPackageIndicator"]', 'mat-button-toggle-group[data-test="consumer-package-indicator"]'], label: /^consumer package indicator/i, waarde: 'Yes' }
  ];

  /** Zoekopdracht voor de organisatiedialoog. Met erkenningsnummer eerst daarop zoeken, anders op naam. */
  function orgZoek(org, rol, land, r) {
    org = org || {};
    var z = { naam: org.naam || '', adres: org.adres || '', plaats: org.plaats || '', erkenning: org.erkenningsnummer || '', land: land || '', rol: rol, sector: sectorVan(r) };
    if (z.erkenning && (rol === 'inrichting' || rol === 'bestemming')) return Object.assign(z, { type: 'APPROVAL_NUMBER', term: z.erkenning, terugval: z.naam ? { type: 'NAME', term: z.naam } : null });
    return Object.assign(z, { type: 'NAME', term: z.naam, terugval: z.erkenning ? { type: 'APPROVAL_NUMBER', term: z.erkenning } : null });
  }

  /** Sector ("Chapter" in Portbase) die bij de goederen past: visserijproducten -> fishing. */
  function sectorVan(r) {
    return (r && r.goederen || []).some(function (g) { return /^(03|1604|1605|0508)/.test(String(g.gnCode || '')); }) ? 'fishing' : '';
  }

  function animoInfo(code) {
    var lijst = (root.GGB_AI && root.GGB_AI.ANIMO_CODES) || [];
    return lijst.filter(function (a) { return a.code === code; })[0] || null;
  }

  /** Alle zichtbare Yes/No-groepen voor een toggle-definitie (via selector of de label-tekst ervoor). */
  function toggleGroepen(def, ctx) {
    var groepen = [];
    function voegToe(g) { if (g && groepen.indexOf(g) < 0) groepen.push(g); }
    def.sel.forEach(function (s) { qa(s, ctx).forEach(voegToe); });
    qa('mat-label, label', ctx).filter(function (l) { return def.label.test(txt(l)); }).forEach(function (l) {
      var box = l.closest('.col, .error-placeholder, mat-form-field') || l.parentElement;
      voegToe(box && q('mat-button-toggle-group', box));
    });
    return groepen.filter(zichtbaar);
  }

  function toggleAan(b) {
    var t = b.closest('mat-button-toggle');
    return b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-pressed') === 'true' || !!(t && t.classList.contains('mat-button-toggle-checked'));
  }

  /** Zet een mat-button-toggle-group op de knop met de gegeven tekst en controleert dat Angular die overneemt. */
  async function zetToggle(groep, waarde) {
    var knoppen = qa('mat-button-toggle button, button.mat-button-toggle-button', groep);
    var doel = knoppen.filter(function (b) { return norm(txt(b)) === norm(waarde); })[0];
    if (!doel) return { status: 'niet gevonden', melding: 'knop "' + waarde + '" niet gevonden' };
    if (toggleAan(doel)) return { status: 'ingevuld', melding: 'stond al op ' + waarde };
    if (doel.disabled || groep.getAttribute('aria-disabled') === 'true') return { status: 'handmatig', melding: 'niet bewerkbaar' };
    var was = knoppen.filter(function (b) { return b !== doel && toggleAan(b); }).map(txt)[0];
    try { doel.scrollIntoView({ block: 'center' }); } catch (e) { /* geen scroll */ }
    klik(doel);
    var ok = await wachtOp(function () { return toggleAan(doel); }, 1500);
    await wacht(TEMPO / 2);
    if (!ok) return { status: 'handmatig', melding: 'klik op "' + waarde + '" werd niet overgenomen; kies zelf' };
    return { status: 'ingevuld', melding: was ? 'was ' + was : '' };
  }

  /** Sectienaam voor het verslag: "Goods item 2" als de groep in een goederenitem staat. */
  function sectieVan(el, standaard) {
    var kaart = el.closest('app-form-goods-items mat-card');
    if (!kaart) return standaard;
    var alle = qa('app-form-goods-items mat-card').filter(function (k) { return q('input, mat-select', k); });
    return 'Goods item ' + (alle.indexOf(kaart) + 1);
  }

  /** Waarde van een algemeen veld uit het AI-resultaat. */
  function algemeneWaarde(r, key) {
    if (key === 'exporteur' || key === 'importeur' || key === 'plaatsBestemming') {
      var p = r[key] || {};
      return p.naam ? p.naam + (p.land ? ' (' + p.land + ')' : '') : '';
    }
    return r[key] ? r[key].waarde : '';
  }

  /* ---------------- herhaalde secties ---------------- */

  /** Sectie via component-selector, anders via de titel (mat-card-title) van het blok. */
  function vindSectie(sectieSel, titelRe) {
    var s = q(sectieSel);
    if (s || !titelRe) return s;
    var titels = qa('mat-card-title, h2, h3');
    for (var i = 0; i < titels.length; i++) {
      if (titelRe.test(txt(titels[i]))) return titels[i].closest('mat-card-content') || titels[i].parentElement;
    }
    return null;
  }

  function kaarten(sectieSel, titelRe) {
    var sectie = vindSectie(sectieSel, titelRe);
    if (!sectie) return [];
    // Alleen bewerkbare kaarten (opgeslagen rijen hebben geen invoervelden).
    return qa('mat-card', sectie).filter(function (k) { return q('input, mat-select', k) && k.getAttribute('data-test') !== 'document-form-item-saved'; });
  }

  function kaartIsLeeg(kaart) {
    return qa('input:not([type="hidden"]):not([type="radio"]):not([type="file"]):not([hidden])', kaart).every(function (i) { return !String(i.value || '').trim(); });
  }

  function knopMetTekst(re, ctx) {
    return qa('button', ctx).filter(function (b) { return re.test(txt(b)) && !b.disabled; })[0] || null;
  }

  /** Geeft een lege bewerkbare kaart terug, zo nodig na klikken op "Add ...". */
  async function legeKaart(sectieSel, titelRe, addSel, addRe, gebruikt) {
    function vrij() { return kaarten(sectieSel, titelRe).filter(function (k) { return gebruikt.indexOf(k) < 0 && kaartIsLeeg(k); })[0] || null; }
    if (vrij()) return vrij();
    var sectie = vindSectie(sectieSel, titelRe);
    var knop = (sectie && (eerste(addSel, sectie) || knopMetTekst(addRe, sectie))) || eerste(addSel) || null;
    if (!knop || knop.disabled) return null;
    var voor = kaarten(sectieSel, titelRe).length;
    knop.click();
    await wachtOp(function () { return kaarten(sectieSel, titelRe).length > voor; }, 2500);
    return vrij();
  }

  /** Zet een bestand in de upload van een documentkaart. */
  function uploadBestand(kaart, bestand) {
    var input = q('input[data-test="upload-document-input"]', kaart) || q('input[type="file"]', kaart);
    if (!input || !bestand) return false;
    var dt = new DataTransfer();
    dt.items.add(bestand);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /* ---------------- hoofdroutine ---------------- */

  /**
   * Vult het formulier.
   * @param {object} r        genormaliseerd AI-resultaat (GGB_AI.normaliseer)
   * @param {object} [opts]   {overschrijven, dialogen, bestanden: {naam: File}, datumFormaat ('MM/DD/YYYY' | 'DD-MM-YYYY'),
   *                           maxWacht (s, op zoekresultaten), trefwoorden (bool), voortgang: fn(tekst, {stap, totaal})}
   * @returns {Promise<{naam, waarde, status, melding, sectie}[]>}
   */
  async function vul(r, opts) {
    opts = opts || {};
    var stappen = 2 + ALGEMEEN.length + (r.containers || []).length + (r.documenten || []).filter(function (x) { return x.opnemen !== false; }).length + (r.goederen || []).length;
    var stap = 0, fase = '';
    var meld = function (t) {
      if (t) { fase = t; stap++; }
      if (opts.voortgang) opts.voortgang(t, { stap: Math.min(stap, stappen), totaal: stappen });
    };
    run.gestopt = false;
    instellen({ maxWacht: opts.maxWacht, trefwoorden: opts.trefwoorden, status: function (t) { if (opts.voortgang) opts.voortgang(fase + (t ? ' · ' + t : ''), { stap: Math.min(stap, stappen), totaal: stappen }); } });
    var verslag = [];
    var form = q('app-declaration-form') || document;

    function push(sectie, res) { res.sectie = sectie; verslag.push(res); }
    opts.dialogen = opts.dialogen !== false;
    function zoekVoor(def, item) { return def.dialoogZoek ? def.dialoogZoek(r, item) : null; }

    // Declaratietype (radio)
    var type = r.declaratieType && r.declaratieType.waarde;
    if (type) {
      var radio = q('mat-radio-group[data-test="goods-classification-code"] input[value="' + type + '"]', form) || q('input[type="radio"][name="goodsClassificationCode"][value="' + type + '"]', form);
      var res = { naam: 'Declaration type', waarde: type === 'PRD' ? 'CHED-P' : 'CHED-D', status: 'ingevuld', melding: '' };
      if (!radio) { res.status = 'niet gevonden'; res.melding = 'keuzerondje niet gevonden'; }
      else if (radio.disabled) { res.status = 'handmatig'; res.melding = 'niet bewerkbaar'; }
      else if (!radio.checked) { radio.click(); await wacht(250); }
      push('General', res);
    }

    for (var i = 0; i < ALGEMEEN.length && !run.gestopt; i++) {
      var def = ALGEMEEN[i];
      meld(def.naam.replace(/\s*\(.*$/, '') + '…');
      push(def.sectie || 'General',
        await vulVeld(def, def.vast || algemeneWaarde(r, def.key), form, opts, zoekVoor(def)));
    }

    var gebruikt = [];
    for (var c = 0; c < (r.containers || []).length && !run.gestopt; c++) {
      meld('Container ' + (c + 1) + '…');
      var ck = await legeKaart('app-form-transport-equipments', /^transport equipment/i, ['button[data-test="add-transport-equipment"]'], /add (transport )?equipment/i, gebruikt);
      if (!ck) {
        push('Transport equipment', { naam: 'Container ' + (c + 1), waarde: r.containers[c].containernummer + ' / ' + r.containers[c].zegelnummer, status: 'niet gevonden', melding: 'geen (lege) regel voor transportmiddelen gevonden' });
        continue;
      }
      gebruikt.push(ck);
      for (var cf = 0; cf < CONTAINER.length; cf++) push('Transport equipment ' + (c + 1), await vulVeld(CONTAINER[cf], r.containers[c][CONTAINER[cf].key], ck, opts));
    }

    gebruikt = [];
    // Alleen de documenten die in de GGB horen (meestal alleen het HC); de rest was bron voor de gegevens.
    var ggbDocs = (r.documenten || []).filter(function (x) { return x.opnemen !== false; }).map(function (x) {
      return Object.assign({}, x, { type: x.portbaseType || x.type });
    });
    for (var d = 0; d < ggbDocs.length && !run.gestopt; d++) {
      var doc = ggbDocs[d];
      meld('Document ' + (d + 1) + '…');
      var dk = await legeKaart('app-form-documents', /^document\(s\)/i, ['button[data-test="add-document"]'], /add document/i, gebruikt);
      if (!dk) {
        push('Document(s)', { naam: 'Document ' + (d + 1), waarde: doc.type + ' ' + doc.identificatie, status: 'niet gevonden', melding: 'geen (lege) documentregel gevonden' });
        continue;
      }
      gebruikt.push(dk);
      if (!doc.inrichtingOorsprong) {
        var pv = r.plaatsVerzending || {};
        doc.inrichtingOorsprong = pv.naam || pv.erkenningsnummer || (r.goederen || []).map(function (x) { return x.erkenningsnummer; }).filter(Boolean)[0] || '';
      }
      for (var df = 0; df < DOCUMENT.length; df++) push('Document ' + (d + 1), await vulVeld(DOCUMENT[df], doc[DOCUMENT[df].key], dk, opts, zoekVoor(DOCUMENT[df], doc)));
      var bestand = opts.bestanden && doc.bestand ? opts.bestanden[doc.bestand] : null;
      if (bestand && bestand.type !== 'application/pdf') {
        push('Document ' + (d + 1), { naam: 'Upload document', waarde: bestand.name, status: 'handmatig', melding: 'Portbase accepteert alleen PDF; zet de afbeelding eerst om naar PDF' });
      } else if (bestand) {
        var ok = uploadBestand(dk, bestand);
        push('Document ' + (d + 1), { naam: 'Upload document', waarde: bestand.name, status: ok ? 'ingevuld' : 'handmatig', melding: ok ? '' : 'uploadveld niet gevonden; upload zelf' });
      }
    }

    gebruikt = [];
    for (var g = 0; g < (r.goederen || []).length && !run.gestopt; g++) {
      meld('Goederenitem ' + (g + 1) + '…');
      var gk = await legeKaart('app-form-goods-items', /^goods item/i, ['button[data-test="add-goods-item"]'], /add goods item/i, gebruikt);
      if (!gk) {
        push('Goods item(s)', { naam: 'Goederenitem ' + (g + 1), waarde: r.goederen[g].gnCode + ' ' + r.goederen[g].omschrijving, status: 'niet gevonden', melding: 'geen (lege) goederenregel gevonden' });
        continue;
      }
      gebruikt.push(gk);
      var item = Object.assign({}, r.goederen[g]);
      if (!item.erkenningsnummer && r.plaatsVerzending) item.erkenningsnummer = r.plaatsVerzending.erkenningsnummer || '';
      if (!item.containernummer && (r.containers || []).length === 1) item.containernummer = r.containers[0].containernummer;
      for (var gf = 0; gf < GOED.length; gf++) {
        if (GOED[gf].nietInvullen) continue; // Portbase vult de omschrijving zelf na het kiezen van de GN-code
        var gres = await vulVeld(GOED[gf], item[GOED[gf].key], gk, opts, zoekVoor(GOED[gf], item));
        push('Goods item ' + (g + 1), gres);
        // Na de GN-code de bijbehorende Animo-code kiezen.
        if (GOED[gf].key === 'gnCode') push('Goods item ' + (g + 1), await vulAnimo(gk, item, gres, opts));
      }
    }

    // Vaste Yes/No-keuzes: EU standard en Consumer package indicator (elk goederenitem) altijd Yes.
    meld('Vaste keuzes…');
    for (var t = 0; t < TOGGLES.length && !run.gestopt; t++) {
      var groepen = toggleGroepen(TOGGLES[t], form);
      if (!groepen.length) { push('General', { naam: TOGGLES[t].naam, waarde: TOGGLES[t].waarde, status: 'overgeslagen', melding: 'veld niet op deze pagina' }); continue; }
      for (var tg = 0; tg < groepen.length; tg++) {
        var tres = await zetToggle(groepen[tg], TOGGLES[t].waarde);
        push(sectieVan(groepen[tg], 'General'), Object.assign({ naam: TOGGLES[t].naam, waarde: TOGGLES[t].waarde }, tres));
      }
    }

    if (run.gestopt) verslag.push({ sectie: 'Invullen', naam: 'Gestopt', waarde: '', status: 'handmatig', melding: 'gestopt door de gebruiker; de rest is niet ingevuld' });
    run.gestopt = false;
    meld('');
    return verslag;
  }

  /* ---------------- zoekdialogen ---------------- */

  function cel(rij, kolom) { return txt(q('.mat-column-' + kolom, rij)); }
  var RECHTSVORM = /\b(b ?v|n ?v|ltd|limited|pvt|private|llc|inc|co|company|corp|corporation|gmbh|s ?a|sarl|spa|bv|jsc|plc)\b/g;
  function kaal(s) { return norm(s).replace(RECHTSVORM, '').replace(/\s+/g, ' ').trim(); }
  function compact(s) { return norm(s).replace(/ /g, ''); }
  var UMLAUT = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'Ä': 'AE', 'Ö': 'OE', 'Ü': 'UE', 'ß': 'ss', 'ẞ': 'SS' };
  /** Umlauts uitgeschreven: "Kühne + Heitz" -> "Kuehne + Heitz". */
  function uitgeschreven(s) { return String(s || '').normalize('NFC').replace(/[äöüÄÖÜßẞ]/g, function (c) { return UMLAUT[c]; }); }
  /** Zoekvariant met uitgeschreven umlauts in hoofdletters ("KUEHNE + HEITZ"), of '' als er geen umlaut in staat. */
  function umlautVariant(s) { var u = uitgeschreven(s); return u !== String(s || '').normalize('NFC') ? u.toUpperCase() : ''; }
  /** Score voor naam a tegen zoeknaam b (40 exact, 20 begin, 10 deel); Kühne = Kuehne = Kuhne. */
  function naamScore(a, b) {
    return Math.max.apply(null, [[kaal(a), kaal(b)], [kaal(uitgeschreven(a)), kaal(uitgeschreven(b))]].map(function (x) {
      var kn = x[0], kz = x[1];
      if (!kn || !kz) return 0;
      if (kn === kz) return 40;
      if (kn.indexOf(kz) === 0 || kz.indexOf(kn) === 0) return 20;
      return kn.indexOf(kz) >= 0 ? 10 : 0;
    }));
  }
  var STOP = { the: 1, and: 1, van: 1, der: 1, den: 1, het: 1, number: 1, street: 1 };
  function woorden(s) { return norm(s).split(' ').filter(function (w) { return w.length >= 3 && !STOP[w]; }); }
  /** Deel van de woorden van b dat ook in a voorkomt (0..1). */
  function overlap(a, b) {
    var A = {}, wa = woorden(a), wb = woorden(b);
    if (!wa.length || !wb.length) return 0;
    wa.forEach(function (w) { A[w] = 1; });
    var raak = wb.filter(function (w) { return A[w]; }).length;
    return raak / Math.min(wa.length, wb.length);
  }

  /** Is de regel door Angular als gekozen verwerkt (klasse op mat-radio-button/checkbox of de rij)? */
  function rijGekozen(rij) {
    if (q('.mat-mdc-radio-checked, .mat-radio-checked, .mat-mdc-checkbox-checked, .mat-checkbox-checked', rij)) return true;
    return /\b(selected|mat-mdc-row-selected|highlight)\b/.test(rij.className || '');
  }

  /**
   * Kiest een regel in een zoekvenster en wacht tot Angular de keuze heeft
   * verwerkt. Pas daarna mag Save: anders sluit het venster zonder keuze.
   */
  async function selecteerRij(rij) {
    rij.scrollIntoView({ block: 'center' });
    rij.style.outline = '3px solid #0b5fa5';
    // Native input eerst: in Angular Material reageert alleen die (of het label) op een klik.
    var invoer = eerste(['.mat-column-selection input[type="radio"]', '.mat-column-selection input[type="checkbox"]', 'input[type="radio"]', 'input[type="checkbox"]'], rij);
    var pogingen = [invoer, q('.mat-column-selection label, .mat-column-selection .mdc-radio, .mat-column-selection button', rij), q('mat-radio-button, mat-checkbox', rij), rij]
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    for (var i = 0; i < pogingen.length; i++) {
      if (i === 0 && pogingen[0] === invoer) pogingen[0].click(); else klik(pogingen[i]);
      if (!invoer && pogingen[i] === rij && !q('mat-radio-button, mat-checkbox', rij)) { await wacht(TEMPO); return true; } // lijst zonder keuzerondje
      if (await wachtOp(function () { return rijGekozen(rij); }, 1500)) { await wacht(TEMPO); return true; }
    }
    // Native vinkje staat wel aan maar Angular toont het (nog) niet: niet op Save vertrouwen.
    return false;
  }

  /** Kies de beste regel als die duidelijk wint; anders kandidaten markeren. */
  function kiesBeste(rijen, scores, drempel, marge) {
    var volg = rijen.map(function (r, i) { return { r: r, s: scores[i] }; }).sort(function (a, b) { return b.s - a.s; });
    var best = volg[0], tweede = volg[1];
    if (best && best.s >= drempel && (!tweede || best.s - tweede.s >= marge)) return { rij: best.r };
    var kandidaten = volg.filter(function (x) { return x.s > 0 && best && best.s - x.s < marge; }).map(function (x) { return x.r; });
    kandidaten.forEach(function (r) { r.style.outline = '2px dashed #b26a00'; });
    return { kandidaten: kandidaten };
  }

  /* ---- organisaties (exporteur, importeur, plaats van bestemming, inrichting) ---- */

  function orgRijen(dialoog) {
    return qa('[data-test="organisations-list-row"], [data-test="organisations-list"] mat-row, [data-test="organisations-list"] tr.mat-mdc-row', dialoog).filter(function (rij) {
      return !rij.classList.contains('mat-mdc-no-data-row') && !rij.classList.contains('cdk-no-data-row') && !rij.matches('mat-header-row, .mat-mdc-header-row');
    });
  }

  var ROL = {
    exporter: /\bex\b|export/, importer: /\bim\b|import/,
    inrichting: /\bpp\b|\bes\b|\bcs\b|establish|processing|plant|cold|factory|vessel/,
    bestemming: /\bes\b|\bcs\b|establish|cold|store|warehouse|import/
  };

  /**
   * Score van een organisatie-regel. Basis: naam (exact op rechtsvorm na: 40)
   * of erkenningsnummer (exact: 50). Extra: rol (Activity), sector (Chapter),
   * adres en plaats. Zie de dialoog "Exporter": dezelfde naam komt vaak meerdere
   * keren voor met een andere activiteit en een ander adres.
   */
  function rijScore(rij, zoek) {
    var naamZoek = zoek.naam || (zoek.type !== 'APPROVAL_NUMBER' ? zoek.term : '');
    var erkZoek = zoek.erkenning || (zoek.type === 'APPROVAL_NUMBER' ? zoek.term : '');
    var naam = cel(rij, 'name') || txt(rij), s = 0, basis = false;
    if (naamZoek) {
      var ns = naamScore(naam, naamZoek);
      s += ns;
      if (ns === 40) basis = true;
    }
    if (erkZoek) {
      var er = compact(cel(rij, 'approvalNumber')), ez = compact(erkZoek);
      if (er && er === ez) { s += 50; basis = true; }
      else if (er && ez && er.replace(/\D/g, '') === ez.replace(/\D/g, '') && ez.replace(/\D/g, '')) { s += 35; basis = true; }
      else if (er && ez) s -= 15;
    }
    if (!basis && s < 20) return 0;
    var rol = ROL[zoek.rol];
    if (rol && rol.test(norm(cel(rij, 'activity')))) s += 15;
    if (zoek.sector && norm(cel(rij, 'activityDepartment')) === zoek.sector) s += 6;
    if (zoek.adres) s += Math.round(overlap(uitgeschreven(zoek.adres + ' ' + (zoek.plaats || '')), uitgeschreven(cel(rij, 'address'))) * 20);
    var stad = norm(uitgeschreven(cel(rij, 'city')));
    if (stad && zoek.plaats && stad === norm(uitgeschreven(zoek.plaats))) s += 10;
    else if (stad && zoek.adres && norm(uitgeschreven(zoek.adres)).indexOf(stad) >= 0) s += 5;
    return Math.max(s, 0);
  }

  async function zoekOrganisatieEenmaal(dialoog, zoek, type, term) {
    var termEl = q('input[data-test="search-term"]', dialoog);
    var radio = q('[data-test="search-type"] input[value="' + type + '"]', dialoog);
    if (!radio && type !== 'NAME' && q('[data-test="search-type"]', dialoog)) return null; // zoektype bestaat niet in dit venster
    if (radio && !radio.checked) { radio.click(); await wachtOp(function () { return radio.checked; }, 1000); await wacht(TEMPO / 2); }
    term = String(term || '').trim();
    if (term.length < 3 || !termEl) return null;
    zetWaarde(termEl, term);
    blur(termEl);
    await wacht(TEMPO);
    var knop = q('button[data-test="select-search"]', dialoog);
    if (!knop) return null;
    var r = await zoekEnWacht(dialoog, knop, orgRijen, 'zoeken op "' + term + '"');
    return r && r.length ? r : null;
  }

  var GENERIEK = { seafood: 1, seafoods: 1, foods: 1, food: 1, trading: 1, import: 1, export: 1, international: 1, group: 1, industries: 1, industry: 1, products: 1, product: 1, marine: 1, frozen: 1, holding: 1, enterprise: 1, enterprises: 1, joint: 1, stock: 1, company: 1, limited: 1, private: 1, corporation: 1, processing: 1, factory: 1, branch: 1, logistics: 1 };

  /**
   * Zoekopdrachten voor een organisatievenster: eerst de opdracht zelf (en de
   * terugval op naam/erkenningsnummer); na "No results" op trefwoorden: naam
   * zonder rechtsvorm en leestekens, de eerste woorden van de naam, losse
   * kenmerkende woorden, het erkenningsnummer zonder letters en de plaats.
   * Staat er een umlaut in de naam of plaats, dan direct daarna ook een keer
   * met de umlaut uitgeschreven in hoofdletters: Kühne + Heitz -> KUEHNE + HEITZ.
   */
  function orgPogingen(zoek) {
    var p = [{ type: zoek.type || 'NAME', term: zoek.term }];
    if (zoek.terugval && zoek.terugval.term) p.push(zoek.terugval);
    if (run.trefwoorden) {
      var kaalNaam = kaal(zoek.naam || '');
      if (kaalNaam) p.push({ type: 'NAME', term: kaalNaam, trefwoord: true });
      var w = kaalNaam.split(' ').filter(function (x) { return x.length >= 2; });
      if (w.length > 2) p.push({ type: 'NAME', term: w.slice(0, 2).join(' '), trefwoord: true });
      w.filter(function (x) { return x.length >= 4 && !GENERIEK[x]; }).sort(function (a, b) { return b.length - a.length; }).slice(0, 2)
        .forEach(function (x) { p.push({ type: 'NAME', term: x, trefwoord: true }); });
      var cijfers = String(zoek.erkenning || '').replace(/\D/g, '');
      if (cijfers.length >= 3 && cijfers !== compact(zoek.erkenning)) p.push({ type: 'APPROVAL_NUMBER', term: cijfers, trefwoord: true });
      if (zoek.plaats) p.push({ type: 'CITY', term: zoek.plaats, trefwoord: true });
    }
    p = p.reduce(function (uit, x) {
      uit.push(x);
      var v = x.type !== 'APPROVAL_NUMBER' ? umlautVariant(x.term) : '';
      if (v) uit.push(Object.assign({}, x, { term: v, umlaut: true }));
      return uit;
    }, []);
    var gezien = {};
    return p.filter(function (x) {
      var k = x.type + '|' + norm(x.term);
      if (!norm(x.term) || String(x.term).trim().length < 3 || gezien[k]) return false;
      gezien[k] = 1;
      return true;
    });
  }

  /** Staat het land al goed in het landveld van een zoekvenster? (bijv. "VN - Viet Nam") */
  function landKlopt(landEl, land) {
    var w = String(landEl.value || '').trim();
    return !!w && pastBij(w, landTermen(land));
  }

  /** Land kiezen in het zoekvenster (autocomplete); een ander, eerder gekozen land wordt vervangen. */
  async function kiesLand(landEl, land) {
    if (!landEl || !land || landKlopt(landEl, land)) return { ok: true };
    await kiesInAutocomplete(landEl, land, landTermen(land));
    var ok = !!(await wachtOp(function () { return landKlopt(landEl, land); }, 1500));
    await wacht(TEMPO);
    return { ok: ok };
  }

  async function zoekOrganisatie(dialoog, zoek) {
    var landEl = q('input[data-test="search-country"]', dialoog);
    // Ook als het land niet te bevestigen is, gewoon zoeken: de zoekterm moet er altijd in.
    var landOk = (await kiesLand(landEl, zoek.land)).ok;
    var landNoot = landOk ? '' : ' (land ' + zoek.land + ' niet bevestigd; controleer het landveld)';
    var pogingen = orgPogingen(zoek), geprobeerd = [];
    if (!pogingen.length) return { ok: true, melding: 'zoekterm te kort; zoek zelf' + landNoot };
    for (var i = 0; i < pogingen.length && !run.gestopt; i++) {
      var p = pogingen[i];
      geprobeerd.push('"' + p.term + '"');
      var rijen = await zoekOrganisatieEenmaal(dialoog, zoek, p.type, p.term);
      if (!rijen) continue; // "No results": volgende zoekterm
      var scores = rijen.map(function (r) { return rijScore(r, zoek); });
      // Resultaten, maar niets dat op de naam/het nummer lijkt: verder met het volgende trefwoord.
      if (Math.max.apply(null, scores) <= 0) { geprobeerd[geprobeerd.length - 1] += ' (' + rijen.length + ' niet passend)'; continue; }
      var keuze = kiesBeste(rijen, scores, 40, 8);
      var via = p.trefwoord ? ' (via trefwoord "' + p.term + '")' : p.umlaut ? ' (via "' + p.term + '")' : '';
      if (keuze.rij) {
        var c = keuze.rij;
        if (!(await selecteerRij(c))) return { ok: true, melding: 'regel ' + cel(c, 'name') + ' aangeklikt, maar Portbase nam de keuze niet over; kies zelf' };
        return { ok: true, gekozen: true, melding: 'gekozen: ' + [cel(c, 'name'), cel(c, 'city'), cel(c, 'approvalNumber'), cel(c, 'activity')].filter(Boolean).join(' · ') + via };
      }
      return { ok: true, melding: rijen.length + ' resultaten voor "' + p.term + '"' + (keuze.kandidaten.length ? ', ' + keuze.kandidaten.length + ' mogelijk (gemarkeerd)' : ', geen duidelijke match') + '; kies zelf' + landNoot };
    }
    if (run.gestopt) return { ok: true, melding: 'gestopt' };
    // Oorspronkelijke zoekopdracht terugzetten, zodat de gebruiker daar verder kan zoeken.
    var r0 = q('[data-test="search-type"] input[value="' + pogingen[0].type + '"]', dialoog), t0 = q('input[data-test="search-term"]', dialoog);
    if (r0 && !r0.checked) r0.click();
    if (t0) { zetWaarde(t0, pogingen[0].term); blur(t0); }
    return { ok: true, melding: 'geen resultaten voor "' + (zoek.term || zoek.naam) + '" (' + (zoek.land || '?') + ')' + (geprobeerd.length > 1 ? ', ook niet op trefwoorden (' + geprobeerd.slice(1).join(', ') + ')' : '') + '; zoek zelf of voeg handmatig toe' + landNoot };
  }

  /* ---- lijstdialogen (Border control post) ---- */

  /** Rijen van een resultatentabel in een dialoog (zonder kop- en "geen resultaten"-rijen). */
  function lijstRijen(dialoog) {
    return qa('mat-row, tr, [role="row"]', dialoog).filter(function (rij) {
      if (rij.matches('mat-header-row, .mat-mdc-header-row, .mat-mdc-no-data-row, .cdk-no-data-row')) return false;
      if (q('th, mat-header-cell, [role="columnheader"]', rij)) return false;
      return !!txt(rij);
    });
  }
  function cellen(rij) {
    var c = qa('mat-cell, td, [role="cell"]', rij).map(function (x) { return norm(txt(x)); }).filter(Boolean);
    return c.length ? c : [norm(txt(rij))];
  }

  async function kiesUitLijst(dialoog, zoek) {
    var landEl = eerste(['input[data-test="search-country"]', 'input[formcontrolname*="ountry"]', 'input[aria-autocomplete="list"]'], dialoog);
    await kiesLand(landEl, zoek.land);
    var start = Date.now();
    var rijen = await wachtStabiel(function () {
      run.status('lijst laden (' + Math.round((Date.now() - start) / 1000) + 's)');
      var r = lijstRijen(dialoog); return r.length && !bezig(dialoog) ? r : null;
    }, 500, maxWacht(), function (r) { return r.length + ':' + txt(r[0]); });
    if (!rijen) return { ok: true, melding: run.gestopt ? 'gestopt' : 'geen lijst verschenen; kies zelf' };
    var code = norm(zoek.code), naam = norm(zoek.term);
    var scores = rijen.map(function (rij) {
      var c = cellen(rij);
      if (code && c.indexOf(code) >= 0) return 4;
      if (naam && c.indexOf(naam) >= 0) return 3;
      return naam && c.some(function (x) { return x.indexOf(naam) >= 0; }) ? 1 : 0;
    });
    var keuze = kiesBeste(rijen, scores, 3, 1);
    if (keuze.rij) {
      if (!(await selecteerRij(keuze.rij))) return { ok: true, melding: 'regel aangeklikt, maar Portbase nam de keuze niet over; kies zelf' };
      return { ok: true, gekozen: true, melding: 'gekozen: ' + qa('mat-cell, td, [role="cell"]', keuze.rij).map(txt).filter(Boolean).join(' · ') };
    }
    return { ok: true, melding: keuze.kandidaten.length ? keuze.kandidaten.length + ' mogelijke regels gemarkeerd; kies zelf' : '"' + (zoek.term || zoek.code) + '" niet in de lijst; kies zelf' };
  }

  /* ---- GN-code ---- */

  function gnRijen(dialoog) {
    return qa('[data-test="gn-codes-list-row"], [data-test="gn-codes-list"] mat-row', dialoog);
  }

  /** Score van een GN-regel: GN (Portbase toont 4-8 cijfers) en soort. */
  function gnScore(rij, gn, soort) {
    var c = txt(q('.mat-column-gnCode', rij)).replace(/\D/g, '');
    var g = 0;
    if (c && c === gn) g = 3;
    else if (c && (gn.indexOf(c) === 0 || c.indexOf(gn) === 0)) g = 2;
    if (!g) return 0;
    var s = 0, wn = norm(txt(q('.mat-column-scientificName', rij))), zs = norm(soort);
    if (zs && wn === zs) s = 2;
    else if (zs && wn && wn.split(' ')[0] === zs.split(' ')[0]) s = 1;
    return g * 10 + s;
  }

  /** Hoe goed past een producttype bij de omschrijving (aard product, Animo-omschrijving)? 0.. */
  function typeOvereenkomst(productType, hints) {
    var tw = woorden(productType).filter(function (w) { return w.length >= 4; }), hw = woorden(hints);
    if (!tw.length || !hw.length) return 0;
    var punten = tw.reduce(function (som, w) {
      var p = 0;
      hw.forEach(function (h) {
        if (h === w || (Math.min(h.length, w.length) >= 5 && (h.indexOf(w) === 0 || w.indexOf(h) === 0))) p = Math.max(p, 2);
        else if (w.length >= 8 && h.indexOf(w) > 0) p = Math.max(p, 2); // "vleesproducten" in "pluimveevleesproducten"
        else if (h.length >= 6 && w.length >= 6 && h.slice(0, 6) === w.slice(0, 6)) p = Math.max(p, 1);
      });
      return som + p;
    }, 0);
    return punten / tw.length;
  }

  function geenResultaat(dialoog) { return q('.mat-mdc-no-data-row, .cdk-no-data-row, ic-no-results', dialoog); }

  /** Laadt het venster nog (spinner/voortgangsbalk)? */
  function bezig(dialoog) {
    return qa('mat-progress-bar, mat-progress-spinner, mat-spinner, .mat-mdc-progress-bar, .mat-mdc-progress-spinner, [role="progressbar"], .spinner, .loading, .loader', dialoog).some(zichtbaar);
  }

  /**
   * Zegt Portbase "No results"? Kijkt naar de "geen gegevens"-regel en de tekst
   * van de resultatentabel ("Start with search" is de begintoestand, geen antwoord).
   */
  function zegtGeenResultaten(dialoog) {
    var t = qa('.mat-mdc-no-data-row, .cdk-no-data-row, ic-no-results, mat-table, table, [role="table"], .search-results', dialoog).map(txt).join(' ');
    return /no results?\b|no (matching )?(data|records|organisations?|items?) found|nothing found|geen (zoek)?resultaten/i.test(t);
  }

  /**
   * Netwerkverkeer van de pagina sinds tijdstip t (zie page-net.js): is er een
   * verzoek gestart, loopt er nog een, en wanneer kwam het laatste antwoord.
   * Zonder page-net.js: { gezien: false } en gelden alleen de DOM-regels.
   */
  function verkeerSinds(t) {
    var n = null;
    try { n = JSON.parse(document.documentElement.getAttribute('data-ggb-net') || 'null'); } catch (e) { n = null; }
    if (!n) return { actief: false, gezien: false, lopend: 0, klaar: 0 };
    return {
      actief: true,
      gezien: (n.g || []).some(function (x) { return x >= t; }),
      lopend: (n.l || []).filter(function (x) { return x >= t; }).length,
      klaar: (n.k || []).filter(function (x) { return x[0] >= t; }).reduce(function (m, x) { return Math.max(m, x[1]); }, 0)
    };
  }

  /**
   * Klikt Search en wacht op het antwoord van Portbase: regels ([...]),
   * "geen resultaten" ([]) of geen reactie (null).
   *
   * Er is geen vaste korte time-out: zolang het zoekverzoek van Portbase loopt
   * (of het venster een spinner toont) wordt gewacht, tot de ingestelde
   * maximale wachttijd (standaard 2 minuten). Angular toont tijdens het zoeken
   * vaak al "No results"; dat geldt pas als antwoord als het zoekverzoek terug
   * is (of, als er geen verkeer te zien is, als die staat een tijd blijft).
   * Regels gelden pas als ze niet meer veranderen.
   */
  async function zoekEnWacht(dialoog, knop, rijenFn, label) {
    var oud = rijenFn(dialoog)[0];
    await wachtOp(function () { return !knop.disabled; }, 3000);
    var start = Date.now();
    knop.click();
    var eind = start + maxWacht(), vorige = null, sinds = start;
    while (Date.now() < eind) {
      await wacht(100);
      if (run.gestopt || !dialoog.isConnected) return null;
      var nu = Date.now(), verstreken = nu - start, sec = Math.round(verstreken / 1000);
      if (label) run.status(label + (sec >= 2 ? ' – wachten op Portbase (' + sec + 's)' : ''));
      var r = rijenFn(dialoog), nr = !r.length && zegtGeenResultaten(dialoog), leeg = !r.length && geenResultaat(dialoog);
      var sig = r.length ? 'R' + r.length + ':' + txt(r[0]).slice(0, 120) : (nr ? 'N' : leeg ? 'L:' + txt(leeg) : '-');
      if (sig !== vorige) { vorige = sig; sinds = nu; }
      var net = verkeerSinds(start - 50);
      if (net.lopend || bezig(dialoog)) continue;          // Portbase is nog aan het zoeken
      var rust = nu - sinds;
      var antwoord = net.gezien && nu - net.klaar >= 300;   // zoekverzoek is terug
      var zonderVerkeer = !net.gezien && verstreken >= 3000; // geen verzoek gezien (lokaal filter of geen page-net)
      if (r.length && rust >= 600 && (r[0] !== oud || antwoord || (zonderVerkeer && verstreken > 4000))) return r;
      if (nr && rust >= 800 && antwoord) return [];
      if ((nr || leeg) && rust >= 2000 && zonderVerkeer) return [];
      if (!r.length && rust >= 3000 && (antwoord || (zonderVerkeer && verstreken >= 6000))) return []; // geen tabel en geen melding
    }
    if (run.gestopt) return null;
    var laatst = rijenFn(dialoog);
    return laatst.length ? laatst : (zegtGeenResultaten(dialoog) || geenResultaat(dialoog) ? [] : null);
  }

  /*
   * Kenmerken om tussen Portbase-producttypes te kiezen, bijv. bij 03074399 +
   * Sepia lycidas: "Gefokte dieren" of "Wilde dieren". Uit het HC ("Wild stock",
   * "Farmed", "Aquaculture") en de Animo-code (206107 aquacultuur, 102108 overig/wild).
   */
  var KENMERKEN = [
    ['wild', /\bwild|\bcaught\b|\bcapture|\bvangst|\bgevangen|\bfished\b/],
    ['kweek', /\bfarm|aquacult|\bcultur|\bkweek|\bgekweekt|gefokt|\bfokk|\bbred\b|\braised\b/],
    ['bereiding', /bereiding|\bpreparation|\bmarinated|\bseasoned|\bgemarineerd|\bgekruid|\bgehakt|\bminced/],
    ['vleesproduct', /vleesproduct|\bmeat products?\b|\bcooked\b|\bgekookt|\bverhit|\bheat treated|\bsmoked\b|\bgerookt|\bcanned\b|\bingeblikt/],
    ['samengesteld', /samengesteld|\bcomposite/],
    ['niet-houdbaar', /\bniet houdba|\bnot shelf|\bperishable/],
    ['houdbaar', /\bhoudba|\bshelf stable|\bambient/]
  ];
  var TEGENSTELLING = { wild: 'kweek', kweek: 'wild', bereiding: 'vleesproduct', vleesproduct: 'bereiding', houdbaar: 'niet-houdbaar', 'niet-houdbaar': 'houdbaar' };
  var ANIMO_KENMERKEN = { 206107: ['kweek'], 102108: ['wild'], 101105: ['bereiding'], 201105: ['bereiding'], 202105: ['bereiding'], 201100: ['vleesproduct'], 202103: ['kweek'], 202104: ['wild'], 121000: ['samengesteld', 'niet-houdbaar'], 121001: ['samengesteld', 'houdbaar'] };

  function kenmerken(tekst) {
    var t = norm(tekst), k = [];
    KENMERKEN.forEach(function (x) { if (x[1].test(t)) k.push(x[0]); });
    if (k.indexOf('niet-houdbaar') >= 0) k = k.filter(function (x) { return x !== 'houdbaar'; });
    // Tegenstrijdig in dezelfde tekst (bijv. "wild of gekweekt"): niet laten meetellen.
    return k.filter(function (x) { return k.indexOf(TEGENSTELLING[x]) < 0; });
  }

  /** +2 per gedeeld kenmerk, -3 per tegengesteld kenmerk (producttype vs HC/Animo). */
  function kenmerkScore(productType, hints, animo) {
    var typ = kenmerken(productType);
    var hint = kenmerken(hints).concat(ANIMO_KENMERKEN[animo] || []);
    hint = hint.filter(function (x, i, a) { return a.indexOf(x) === i && a.indexOf(TEGENSTELLING[x]) < 0; });
    return typ.reduce(function (s, x) { return s + (hint.indexOf(x) >= 0 ? 2 : 0) - (hint.indexOf(TEGENSTELLING[x]) >= 0 ? 3 : 0); }, 0);
  }

  /** Beoordeel de regels van één zoekopdracht: duidelijke winnaar, kandidaten, of niets passends. */
  function beoordeelGn(rijen, gn, zoek) {
    var basis = rijen.map(function (r) { return gnScore(r, gn, zoek.wetenschappelijk); });
    var max = Math.max.apply(null, basis);
    if (max <= 0) return { max: 0 };
    var hints = zoek.hints || zoek.aard || '';
    var scores = rijen.map(function (r, j) {
      if (basis[j] !== max) return 0;
      var pt = txt(q('.mat-column-productType', r));
      return 100 + Math.round(typeOvereenkomst(pt, hints) * 10) + kenmerkScore(pt, hints, zoek.animo) * 10;
    });
    var keuze = kiesBeste(rijen, scores, 100, 3);
    keuze.max = max;
    return keuze;
  }

  async function zoekGn(dialoog, zoek) {
    var gn = String(zoek.gn || zoek.term || '').replace(/\D/g, '');
    var hc = String(zoek.hc || '').replace(/\D/g, '');
    if (!gn) gn = hc;
    var termEl = eerste(['input[data-test="name"]', 'input[formcontrolname="name"]'], dialoog);
    var wnEl = q('input[data-test="scientific-name"], input[formcontrolname="scientificName"]', dialoog);
    var knop = q('button[data-test="select-search"]', dialoog);
    if (!termEl || !knop) return { ok: true, melding: 'zoekveld niet gevonden; zoek zelf op ' + gn };
    // Zoals de declarant: de code zoals op het HC + wetenschappelijke naam. Niet gevonden of geen
    // passende regel: de volledige GN-code, dan 6 cijfers, dan 4 cijfers; daarna hetzelfde zonder naam.
    var codes = [hc, gn, gn.slice(0, 6), gn.slice(0, 4)].filter(function (p, i, a) { return p && p.length >= 4 && a.indexOf(p) === i; });
    if (!codes.length) return { ok: true, melding: 'GN-code "' + gn + '" te kort om te zoeken' };
    var soort = String(zoek.wetenschappelijk || '').trim();
    var pogingen = [];
    if (soort && wnEl) codes.forEach(function (c) { pogingen.push([c, soort]); });
    codes.forEach(function (c) { pogingen.push([c, '']); });
    // Na "No results": trefwoorden (geslacht uit de Latijnse naam, woorden uit de omschrijving); de GN-code moet wel kloppen.
    if (run.trefwoorden) {
      var geslacht = soort.split(/\s+/)[0] || '';
      if (geslacht.length >= 4) { pogingen.push([geslacht, '']); if (wnEl) pogingen.push([codes[codes.length - 1], geslacht]); }
      woorden(zoek.omschrijving || '').filter(function (w) { return w.length >= 4; }).sort(function (a, b) { return b.length - a.length; }).slice(0, 2)
        .forEach(function (w) { pogingen.push([w, '']); });
      pogingen = pogingen.filter(function (p, i) { return !pogingen.slice(0, i).some(function (x) { return x[0] === p[0] && x[1] === p[1]; }); });
    }
    var info = function (r) { return [txt(q('.mat-column-gnCode', r)), txt(q('.mat-column-scientificName', r)), txt(q('.mat-column-productType', r))].filter(Boolean).join(' · '); };
    var geprobeerd = [], zonderMatch = [];
    for (var i = 0; i < pogingen.length && !run.gestopt; i++) {
      zetWaarde(termEl, pogingen[i][0]); blur(termEl);
      if (wnEl) { zetWaarde(wnEl, pogingen[i][1]); blur(wnEl); }
      await wacht(TEMPO);
      var gebruikt = pogingen[i][0] + (pogingen[i][1] ? ' + ' + pogingen[i][1] : '');
      geprobeerd.push(gebruikt);
      var rijen = await zoekEnWacht(dialoog, knop, gnRijen, 'GN-code zoeken op "' + gebruikt + '"');
      if (!rijen || !rijen.length) continue;            // niets gevonden: volgende poging
      var keuze = beoordeelGn(rijen, gn, zoek);
      if (!keuze.max) { zonderMatch.push(gebruikt); continue; } // wel regels, maar geen passende GN-code
      if (keuze.rij) {
        if (!(await selecteerRij(keuze.rij))) return { ok: true, melding: 'regel ' + info(keuze.rij) + ' aangeklikt, maar Portbase nam de keuze niet over; kies zelf' };
        return { ok: true, gekozen: true, melding: 'gekozen: ' + info(keuze.rij) + ' (gezocht: ' + gebruikt + ')' };
      }
      // Passende GN-code maar meerdere producttypes zonder duidelijke winnaar: een andere zoekterm helpt niet.
      var types = keuze.kandidaten.map(function (r) { return txt(q('.mat-column-productType', r)); }).filter(function (x, j, a) { return x && a.indexOf(x) === j; });
      return { ok: true, melding: keuze.kandidaten.length + ' regels gemarkeerd; kies het producttype: ' + types.join(' · ') + (zoek.aard ? ' (HC: ' + zoek.aard + ')' : '') };
    }
    if (run.gestopt) return { ok: true, melding: 'gestopt' };
    if (zonderMatch.length) return { ok: true, melding: 'wel resultaten voor "' + zonderMatch[0] + '", maar geen passende GN-code (' + gn + '); kies zelf' };
    return { ok: true, melding: 'geen GN-codes gevonden (gezocht: ' + geprobeerd.join('; ') + '); zoek zelf (bijv. op omschrijving)' };
  }

  /* ---- Animo-code ---- */

  function animoRijen(dialoog) {
    return qa('[data-test="animo-codes-list-row"], [data-test="animo-codes-list"] mat-row', dialoog);
  }

  async function zoekAnimo(dialoog, zoek) {
    var code = String(zoek.animo || zoek.term || '').trim();
    if (!code) return { ok: true, melding: 'geen Animo-code in het voorstel; kies zelf' };
    function vind() { return animoRijen(dialoog).filter(function (r) { return txt(q('.mat-column-animoCode', r)) === code; })[0] || null; }
    // De volledige lijst komt via de API; eerst wachten tot die er staat (zolang Portbase nog laadt).
    var start = Date.now();
    await wachtStabiel(function () {
      run.status('Animo-lijst laden (' + Math.round((Date.now() - start) / 1000) + 's)');
      var r = animoRijen(dialoog), net = verkeerSinds(start - 2000);
      if (net.lopend || bezig(dialoog)) return null;
      return r.length ? r : (Date.now() - start > 3000 ? 'leeg' : null);
    }, 400, Math.min(maxWacht(), 60000), function (r) { return r === 'leeg' ? r : r.length; });
    var rij = vind();
    var termEl = q('input[data-test="search-term"], input[formcontrolname="searchTerm"]', dialoog);
    var knop = q('button[data-test="search-button"], button[type="submit"]', dialoog);
    if (!rij && termEl && knop) {
      // Eerst op de code; bij "No results" op trefwoorden uit de omschrijving van de code.
      var a = animoInfo(code), termen = [code];
      if (run.trefwoorden && a) woorden(a.omschrijving).filter(function (w) { return w.length >= 5; }).slice(0, 2).forEach(function (w) { termen.push(w); });
      for (var i = 0; i < termen.length && !rij && !run.gestopt; i++) {
        zetWaarde(termEl, termen[i]);
        blur(termEl);
        await wacht(TEMPO);
        await zoekEnWacht(dialoog, knop, animoRijen, 'Animo zoeken op "' + termen[i] + '"');
        rij = vind();
      }
    }
    if (!rij) return { ok: true, melding: run.gestopt ? 'gestopt' : 'Animo-code ' + code + ' niet in de lijst, ook niet op trefwoorden; kies zelf' };
    if (!(await selecteerRij(rij))) return { ok: true, melding: 'Animo-code ' + code + ' aangeklikt, maar Portbase nam de keuze niet over; kies zelf' };
    return { ok: true, gekozen: true, melding: 'gekozen: ' + code + ' · ' + txt(q('.mat-column-description', rij)) };
  }

  /* ---- dialogen openen, verwerken en afsluiten ---- */

  function dialogen() { return qa('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]'); }

  /** Herkent het type dialoog en voert de zoekopdracht uit. */
  async function verwerkDialoog(dialoog, zoek) {
    await wachtOp(function () { return q('input, mat-table, table', dialoog); }, 15000);
    if (q('app-animo-code-dialog, [data-test="animo-codes-list"]', dialoog)) return zoekAnimo(dialoog, zoek);
    if (q('app-gn-code-dialog, [data-test="gn-codes-list"]', dialoog)) return zoekGn(dialoog, zoek);
    if (q('input[data-test="search-term"]', dialoog) && q('[data-test="organisations-list"], [data-test="search-type"]', dialoog)) return zoekOrganisatie(dialoog, zoek);
    if (zoek.code || q('mat-table, table, [role="table"], input[aria-autocomplete="list"]', dialoog)) return kiesUitLijst(dialoog, zoek);
    var veld = await wachtOp(function () {
      return qa('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled])', dialoog).filter(function (i) { return i.offsetParent !== null || i.getClientRects().length; })[0];
    }, 2000);
    if (!veld) return { ok: true, melding: 'dialoog geopend; geen zoekveld gevonden' };
    if (zoek.term) { zetWaarde(veld, zoek.term); veld.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); }
    return { ok: true, melding: 'zoekterm ingevuld; kies het resultaat' };
  }

  /**
   * Opent een Portbase-zoekdialoog via de knop en voert de zoekopdracht uit
   * (zoeken + best passende regel aanvinken). Klikt zelf niet op Save; zie afhandelen().
   */
  async function zoekInDialoog(knop, zoek) {
    if (typeof zoek === 'string' || !zoek) zoek = { term: zoek || '' };
    var voor = dialogen().length;
    if (!knop || !knop.isConnected) return { ok: false, melding: 'knop niet meer op de pagina' };
    knop.scrollIntoView({ block: 'center' });
    knop.click();
    var dialoog = await wachtOp(function () { var d = dialogen(); return d.length > voor ? d[d.length - 1] : null; }, 15000);
    if (!dialoog) return { ok: false, melding: run.gestopt ? 'gestopt' : 'dialoog ging niet open' };
    var res = await verwerkDialoog(dialoog, zoek);
    res.dialoog = dialoog;
    return res;
  }

  /** Klikt Save (bij een duidelijke keuze) of Cancel in de dialoog en wacht tot die dicht is. */
  async function sluitDialoog(dialoog, opslaan) {
    var knop = q(opslaan ? 'button[data-test="save"]' : 'button[data-test="cancel"], button[mat-dialog-close]', dialoog);
    if (!knop) return false;
    // Niet via wachtOp: ook na "Stop" moet het venster netjes sluiten (Cancel).
    async function tot(fn, ms) { var eind = Date.now() + ms; while (Date.now() < eind) { if (fn()) return true; await wacht(80); } return !!fn(); }
    if (!(await tot(function () { return !knop.disabled && knop.getAttribute('aria-disabled') !== 'true'; }, 3000))) return false;
    await wacht(TEMPO);
    knop.click();
    // Save kan een verzoek naar Portbase doen; wachten tot het venster dicht is.
    var dicht = await tot(function () { return !dialoog.isConnected; }, 15000);
    if (dicht) await wacht(TEMPO);
    return dicht;
  }

  /**
   * Dialoogveld volledig afhandelen: openen, zoeken, kiezen en bij een
   * duidelijke keuze op Save klikken. Zonder duidelijke keuze: Cancel, zodat
   * het invullen verder kan; via "Zoek in Portbase" in het verslag kan de
   * gebruiker het daarna zelf doen. Nooit Save/Send van de declaratie.
   */
  async function afhandelen(knop, zoek, opts) {
    var res = await zoekInDialoog(knop, zoek);
    return afronden(res, opts);
  }
  async function afronden(res, opts) {
    var d = res.dialoog;
    if (!d) return res;
    if (res.gekozen && !run.gestopt && opts && opts.dialogen !== false) {
      res.opgeslagen = await sluitDialoog(d, true);
      if (!res.opgeslagen) res.melding += ' (Save lukte niet; klik zelf op Save)';
    } else if (opts && opts.dialogen !== false) {
      await sluitDialoog(d, false);
    }
    return res;
  }

  /** Animo-code na de GN-code: de dialoog opent vanzelf of via een knop in het goederenitem. */
  async function vulAnimo(kaart, item, gnRes, opts) {
    var r = { naam: 'ANIMO code', waarde: item.animoCode || '', status: 'overgeslagen', melding: '' };
    if (!item.animoCode) { r.melding = 'geen Animo-code in het voorstel'; return r; }
    if (!opts.dialogen) { r.status = 'handmatig'; return r; }
    var gnMislukt = gnRes && gnRes.status !== 'ingevuld' && gnRes.status !== 'overgeslagen';
    var animoVeld = q('input[data-test="animo-code-selector"], #animoCodeSelector', kaart);
    var huidig = animoVeld ? String(animoVeld.value || '').trim() : '';
    if (huidig && !opts.overschrijven) {
      r.status = huidig.indexOf(item.animoCode) === 0 ? 'ingevuld' : 'handmatig';
      r.melding = huidig.indexOf(item.animoCode) === 0 ? 'al ingevuld door Portbase (' + huidig + ')' : 'Portbase vulde ' + huidig + ' in; voorstel was ' + item.animoCode + ' – controleer';
      return r;
    }
    var zoek = { animo: item.animoCode };
    // Portbase kan het Animo-venster zelf openen na Save in het GN-venster; daar even op wachten.
    var open = gnMislukt ? null : await wachtOp(function () { return dialogen().filter(function (d) { return q('app-animo-code-dialog, [data-test="animo-codes-list"]', d); })[0]; }, 2500);
    var res;
    if (open) {
      res = await verwerkDialoog(open, zoek);
      res.dialoog = open;
    } else {
      var knop = eerste(['button[data-test="animo-code-dialog"]', 'button[data-test*="animo"]'], kaart) || knopMetTekst(/animo/i, kaart);
      if (!knop) { r.status = 'handmatig'; r.melding = 'Animo-knop niet gevonden; kies ' + item.animoCode + ' zelf'; return r; }
      // Ook als de GN-code niet lukte: het Animo-venster is los te openen (tenzij Portbase de knop uitschakelt).
      if (knop.disabled || knop.getAttribute('aria-disabled') === 'true') { r.status = 'handmatig'; r.melding = gnMislukt ? 'Animo-knop pas actief na de GN-code; kies eerst de GN-code, dan ' + item.animoCode : 'Animo-knop niet actief; kies ' + item.animoCode + ' zelf'; return r; }
      r.knop = knop;
      r.zoek = zoek;
      res = await zoekInDialoog(knop, zoek);
    }
    res = await afronden(res, opts);
    r.status = res.opgeslagen ? 'ingevuld' : 'handmatig';
    r.melding = res.melding || '';
    var veld = q('input[data-test="animo-code-selector"], #animoCodeSelector', kaart);
    if (res.opgeslagen && veld && !(await wachtOp(function () { return String(veld.value || '').trim(); }, 2500))) {
      r.status = 'handmatig';
      r.melding += ' (Save geklikt, maar het Animo-veld is leeg; kies zelf)';
    }
    return r;
  }

  /** Is er een bewerkbaar declaratieformulier op de pagina? */
  function formulierAanwezig() {
    var f = q('app-declaration-form');
    if (!f) return false;
    if (q('[data-test="info-message-form-not-editable"]', f)) return false;
    return qa('input:not([disabled]):not([type="hidden"])', f).length > 0;
  }

  var exported = { vul: vul, stop: stop, instellen: instellen, orgPogingen: orgPogingen, verkeerSinds: verkeerSinds, vulVeld: vulVeld, zoekInDialoog: zoekInDialoog, afhandelen: afhandelen, rijScore: rijScore, gnScore: gnScore, kenmerkScore: kenmerkScore, typeOvereenkomst: typeOvereenkomst, orgZoek: orgZoek, lijstRijen: lijstRijen, formulierAanwezig: formulierAanwezig, besteOptie: besteOptie, ALGEMEEN: ALGEMEEN, DOCUMENT: DOCUMENT, GOED: GOED, CONTAINER: CONTAINER };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_FILL = exported;
})(typeof window !== 'undefined' ? window : this);
