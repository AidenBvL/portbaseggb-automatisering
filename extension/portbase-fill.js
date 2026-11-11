/*
 * Vult het Portbase-formulier "New declaration" (Angular Material) met het
 * AI-voorstel uit js/ggb-ai.js.
 *
 * Werkwijze per veld:
 *  - zoek het element via data-test / formcontrolname / id, anders via de
 *    zichtbare label-tekst (mat-label) van het veld;
 *  - gewone invoer: waarde zetten + input/change/blur, zodat Angular het oppakt;
 *  - mat-select: openen en de optie met de best passende tekst kiezen;
 *  - autocomplete (combobox): typen en de eerste passende optie kiezen;
 *  - velden die Portbase via een zoekdialoog laat kiezen (exporteur, importeur,
 *    grenscontrolepost, plaats van bestemming, inrichting van oorsprong,
 *    GN-code, erkenningsnummer) worden NIET automatisch gekozen maar als
 *    "handmatig" gemeld; vanuit het verslag kan de dialoog met de zoekterm
 *    worden geopend (zoekInDialoog).
 *
 * Er wordt nooit op Opslaan/Verzenden geklikt: de declarant controleert en
 * verstuurt zelf.
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

  async function wachtOp(fn, timeout) {
    var eind = Date.now() + (timeout || 2500);
    while (Date.now() < eind) {
      var r = fn();
      if (r) return r;
      await wacht(80);
    }
    return null;
  }

  function eerste(selectors, ctx) {
    for (var i = 0; i < selectors.length; i++) {
      var el = q(selectors[i], ctx);
      if (el) return el;
    }
    return null;
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
  function opties(el) {
    var panelen = [];
    var id = el && el.getAttribute && el.getAttribute('aria-controls');
    var eigen = id ? document.getElementById(id) : null;
    if (eigen) panelen.push(eigen);
    else panelen = qa('[role="listbox"], .mat-mdc-select-panel, .mat-mdc-autocomplete-panel, .cdk-overlay-container, .cdk-overlay-popover').filter(zichtbaar);
    var gezien = [];
    panelen.forEach(function (p) {
      qa('mat-option, [role="option"]', p).forEach(function (o) { if (gezien.indexOf(o) < 0) gezien.push(o); });
    });
    return gezien.filter(function (o) {
      return zichtbaar(o) && !o.classList.contains('mdc-list-item--disabled') && o.getAttribute('aria-disabled') !== 'true';
    });
  }

  /** Kiest de optie die het best bij een van de zoektermen past. */
  function besteOptie(lijst, termen) {
    var best = null, score = 0;
    lijst.forEach(function (o) {
      var t = norm(txt(o));
      termen.forEach(function (term, ti) {
        var n = norm(term);
        if (!n) return;
        var sc = 0;
        if (t === n) sc = 4;
        else if (new RegExp('(^| )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(t)) sc = 3;
        else if (t.indexOf(n) === 0) sc = 2;
        else if (n.length > 3 && t.indexOf(n) >= 0) sc = 1;
        if (!sc) return;
        sc = sc * 100 - ti; // bij gelijke match wint de eerste (eigenlijke) zoekterm
        if (sc > score) { score = sc; best = o; }
      });
    });
    return best;
  }

  /** Sluit een open keuzelijst. Met el: alleen het paneel van dat veld (veilig binnen een dialoog). */
  function sluitOverlay(el) {
    if (el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })); return; }
    if (q('mat-dialog-container')) return; // nooit een Portbase-dialoog wegklikken
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    var bd = q('.cdk-overlay-backdrop');
    if (bd) bd.click();
  }

  async function kiesInSelect(el, termen) {
    var trigger = q('.mat-mdc-select-trigger', el) || el;
    trigger.click();
    var lijst = await wachtOp(function () { var o = opties(el); return o.length ? o : null; }, 3000);
    if (!lijst) { sluitOverlay(el); return { ok: false, melding: 'keuzelijst ging niet open' }; }
    var o = besteOptie(lijst, termen);
    if (!o) { sluitOverlay(el); return { ok: false, melding: 'geen passende optie voor "' + termen[0] + '" (opties: ' + lijst.slice(0, 8).map(txt).join(', ') + ')' }; }
    o.click();
    await wacht(150);
    return { ok: true, gekozen: txt(o) };
  }

  async function kiesInAutocomplete(el, zoekterm, termen) {
    zetWaarde(el, zoekterm);
    var lijst = await wachtOp(function () { var o = opties(el); return o.length ? o : null; }, 5000);
    if (!lijst) { blur(el); return { ok: false, melding: 'geen suggesties verschenen; kies zelf uit de lijst' }; }
    var o = besteOptie(lijst, termen);
    if (!o) { sluitOverlay(el); return { ok: false, melding: 'geen passende suggestie voor "' + zoekterm + '"' }; }
    o.click();
    await wacht(150);
    return { ok: true, gekozen: txt(o) };
  }

  /**
   * Vult één veld. def: {naam, sel, label, soort?, termen?}
   * Geeft {naam, waarde, status: 'ingevuld'|'handmatig'|'niet gevonden'|'fout'|'overgeslagen', melding}
   */
  async function vulVeld(def, waarde, ctx, opts, zoekOpdracht) {
    var r = { naam: def.naam, waarde: waarde, status: 'ingevuld', melding: '' };
    if (!waarde) { r.status = 'overgeslagen'; return r; }
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
        sluitOverlay(el);
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
    { naam: 'Goods certified as or for (I.18)', key: 'gecertificeerdVoor', sectie: 'Goods', sel: ['mat-select[data-test="goods-intended-use-code"]', 'mat-select[formcontrolname="goodsIntendedUseCode"]'], label: /^goods certified/i },
    { naam: 'Transport conditions (I.16)', key: 'transportconditie', sectie: 'Goods', sel: ['mat-select[data-test="transport-conditions-code"]', 'mat-select[formcontrolname="transportConditionsCode"]'], label: /^transport conditions/i },
    { naam: 'Means of transport (I.13)', key: 'vervoermiddel', sectie: 'Means of transport', sel: ['mat-select[data-test="arrival-means-of-transport-mode"]', 'app-form-means-of-transport-before-border mat-select[formcontrolname="mode"]'],
      termen: function (v) { return VERVOER_TERMEN[v] || [v]; } },
    { naam: 'Name / identification (I.13)', key: 'vervoermiddelNaam', sectie: 'Means of transport', sel: ['input[data-test="arrival-means-of-transport-identification"]', 'app-form-means-of-transport-before-border input[formcontrolname="identification"]'] },
    { naam: 'Nationality (I.13)', key: 'vervoermiddelNationaliteit', sectie: 'Means of transport', sel: ['input[data-test="arrival-means-of-transport-nationality-un-code"]', 'app-form-means-of-transport-before-border input[formcontrolname="nationalityUnCode"]'], termen: landTermen },
    { naam: 'Expected date of arrival (I.10)', key: 'aankomstDatum', sectie: 'Means of transport', sel: ['app-form-means-of-transport-before-border input[data-test="arrival-date-time-estimated"]', 'input[data-test="arrival-date-time-estimated"]'], soort: 'tekst' },
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
    { naam: 'Date of issue', key: 'datumAfgifte', sel: ['input[data-test="document-date-of-issue"]', 'input[formcontrolname="dateOfIssue"]'], label: /^date of issue/i, soort: 'tekst' },
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
        return { gn: g.gnCode, term: g.gnCode, wetenschappelijk: g.wetenschappelijkeNaam, aard: g.aardProduct, animo: g.animoCode, hints: [g.aardProduct, a ? a.omschrijving : '', g.omschrijving].join(' ') };
      } },
    { naam: 'Goods description (I.31)', key: 'omschrijving', nietInvullen: true, sel: ['input[data-test="goods-description"]', 'input[formcontrolname="goodsDescription"]'], label: /^goods description/i },
    { naam: 'Gross weight (I.34)', key: 'brutoGewicht', sel: ['input[data-test="gross-weight"]', 'input[formcontrolname="grossWeight"]'], label: /^gross weight/i },
    { naam: 'Nett weight (I.34)', key: 'nettoGewicht', sel: ['input[data-test="nett-weight"]', 'input[formcontrolname="nettWeight"]'], label: /^nett? weight/i },
    { naam: 'Number of packages (I.32)', key: 'aantalColli', sel: ['input[data-test="packaging-number-of-packages"]', 'input[formcontrolname="numberOfPackages"]'], label: /^number of packages/i },
    { naam: 'Package type (I.32)', key: 'verpakkingstype', sel: ['mat-select[data-test="packaging-package-type"]', 'mat-select[formcontrolname="packageType"]'], label: /^package type/i,
      termen: function (v) { return [v, String(v).replace(/s$/i, ''), /carton/i.test(v) ? 'Box' : '']; } },
    { naam: 'Batch number (I.34)', key: 'batchnummer', sel: ['input[formcontrolname="batchNumber"]'], label: /^batch number/i },
    { naam: 'Additional units (I.33)', key: 'aanvullendeEenheden', sel: ['input[formcontrolname="additionalUnits"]'], label: /^additional units/i },
    { naam: 'Activity / approval number (I.15)', key: 'erkenningsnummer', sel: ['button[data-test="establishment-dialog"]', 'button[data-test="organisation-dialog"]'], label: /^activity \/ approval number/i, soort: 'dialoog',
      dialoogZoek: function (r, g) {
        var pv = r.plaatsVerzending || {};
        return orgZoek(Object.assign({}, pv, { erkenningsnummer: g.erkenningsnummer || pv.erkenningsnummer }), 'inrichting', pv.land || r.landOorsprong.waarde || r.exporteur.land, r);
      } },
    { naam: 'Equipment number', key: 'containernummer', sel: ['mat-select[formcontrolname="equipmentNumber"]'], label: /^equipment number/i }
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
   * @param {object} [opts]   {overschrijven: bool, bestanden: {naam: File}, voortgang: fn(tekst)}
   * @returns {Promise<{naam, waarde, status, melding, sectie}[]>}
   */
  async function vul(r, opts) {
    opts = opts || {};
    var meld = opts.voortgang || function () {};
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

    meld('Algemene gegevens…');
    for (var i = 0; i < ALGEMEEN.length; i++) {
      var def = ALGEMEEN[i];
      push(def.sectie || 'General',
        await vulVeld(def, algemeneWaarde(r, def.key), form, opts, zoekVoor(def)));
    }

    var gebruikt = [];
    for (var c = 0; c < (r.containers || []).length; c++) {
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
    for (var d = 0; d < ggbDocs.length; d++) {
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
    for (var g = 0; g < (r.goederen || []).length; g++) {
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

    meld('');
    return verslag;
  }

  /* ---------------- zoekdialogen ---------------- */

  function cel(rij, kolom) { return txt(q('.mat-column-' + kolom, rij)); }
  var RECHTSVORM = /\b(b ?v|n ?v|ltd|limited|pvt|private|llc|inc|co|company|corp|corporation|gmbh|s ?a|sarl|spa|bv|jsc|plc)\b/g;
  function kaal(s) { return norm(s).replace(RECHTSVORM, '').replace(/\s+/g, ' ').trim(); }
  function compact(s) { return norm(s).replace(/ /g, ''); }
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

  function selecteerRij(rij) {
    // Native input eerst: in Angular Material reageert alleen die (of het label) op een klik.
    var keuze = eerste(['.mat-column-selection input[type="radio"]', '.mat-column-selection input[type="checkbox"]', '.mat-column-selection label', '.mat-column-selection button'], rij);
    (keuze || rij).click();
    rij.style.outline = '3px solid #0b5fa5';
    rij.scrollIntoView({ block: 'center' });
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
      var kn = kaal(naam), kz = kaal(naamZoek);
      if (kn && kn === kz) { s += 40; basis = true; }
      else if (kn && kz && (kn.indexOf(kz) === 0 || kz.indexOf(kn) === 0)) s += 20;
      else if (kn && kz && kn.indexOf(kz) >= 0) s += 10;
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
    if (zoek.adres) s += Math.round(overlap(zoek.adres + ' ' + (zoek.plaats || ''), cel(rij, 'address')) * 20);
    var stad = norm(cel(rij, 'city'));
    if (stad && zoek.plaats && stad === norm(zoek.plaats)) s += 10;
    else if (stad && zoek.adres && norm(zoek.adres).indexOf(stad) >= 0) s += 5;
    return Math.max(s, 0);
  }

  async function zoekOrganisatieEenmaal(dialoog, zoek, type, term) {
    var termEl = q('input[data-test="search-term"]', dialoog);
    var radio = q('[data-test="search-type"] input[value="' + type + '"]', dialoog);
    if (radio && !radio.checked) { radio.click(); await wacht(100); }
    term = String(term || '').trim();
    if (term.length < 3) return null;
    zetWaarde(termEl, term);
    blur(termEl);
    var knop = q('button[data-test="select-search"]', dialoog);
    if (!knop) return null;
    var r = await zoekEnWacht(dialoog, knop, orgRijen);
    return r && r.length ? r : null;
  }

  async function zoekOrganisatie(dialoog, zoek) {
    var landEl = q('input[data-test="search-country"]', dialoog);
    if (landEl && zoek.land && !String(landEl.value || '').trim()) {
      var l = await kiesInAutocomplete(landEl, zoek.land, landTermen(zoek.land));
      if (!l.ok) return { ok: true, melding: 'kies eerst het land (' + zoek.land + ') en klik Search' };
    }
    var type = zoek.type || 'NAME', term = zoek.term;
    var rijen = await zoekOrganisatieEenmaal(dialoog, zoek, type, term);
    if (!rijen && zoek.terugval && zoek.terugval.term) {
      type = zoek.terugval.type; term = zoek.terugval.term;
      rijen = await zoekOrganisatieEenmaal(dialoog, zoek, type, term);
    }
    if (!rijen) return { ok: true, melding: String(term || '').trim().length < 3 ? 'zoekterm te kort; zoek zelf' : 'geen resultaten voor "' + term + '" (' + (zoek.land || '?') + '); zoek zelf of voeg handmatig toe' };
    var keuze = kiesBeste(rijen, rijen.map(function (r) { return rijScore(r, zoek); }), 40, 8);
    if (keuze.rij) {
      selecteerRij(keuze.rij);
      var c = keuze.rij;
      return { ok: true, gekozen: true, melding: 'gekozen: ' + [cel(c, 'name'), cel(c, 'city'), cel(c, 'approvalNumber'), cel(c, 'activity')].filter(Boolean).join(' · ') };
    }
    return { ok: true, melding: rijen.length + ' resultaten voor "' + term + '"' + (keuze.kandidaten.length ? ', ' + keuze.kandidaten.length + ' mogelijk (gemarkeerd)' : ', geen duidelijke match') + '; kies zelf' };
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
    if (landEl && zoek.land && !String(landEl.value || '').trim()) {
      var l = await kiesInAutocomplete(landEl, zoek.land, landTermen(zoek.land));
      if (!l.ok) return { ok: true, melding: 'kies eerst het land (' + zoek.land + ')' };
    }
    var rijen = await wachtOp(function () { var r = lijstRijen(dialoog); return r.length ? r : null; }, 8000);
    if (!rijen) return { ok: true, melding: 'geen lijst verschenen; kies zelf' };
    var code = norm(zoek.code), naam = norm(zoek.term);
    var scores = rijen.map(function (rij) {
      var c = cellen(rij);
      if (code && c.indexOf(code) >= 0) return 4;
      if (naam && c.indexOf(naam) >= 0) return 3;
      return naam && c.some(function (x) { return x.indexOf(naam) >= 0; }) ? 1 : 0;
    });
    var keuze = kiesBeste(rijen, scores, 3, 1);
    if (keuze.rij) {
      selecteerRij(keuze.rij);
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
        else if (h.length >= 6 && w.length >= 6 && h.slice(0, 6) === w.slice(0, 6)) p = Math.max(p, 1);
      });
      return som + p;
    }, 0);
    return punten / tw.length;
  }

  function geenResultaat(dialoog) { return q('.mat-mdc-no-data-row, .cdk-no-data-row, ic-no-results', dialoog); }

  /** Klikt Search en wacht op nieuwe regels ([]: "geen resultaten"; null: geen reactie). */
  async function zoekEnWacht(dialoog, knop, rijenFn) {
    var oud = rijenFn(dialoog)[0], oudLeeg = geenResultaat(dialoog), oudTekst = oudLeeg ? txt(oudLeeg) : '';
    knop.click();
    return wachtOp(function () {
      var r = rijenFn(dialoog);
      if (r.length && r[0] !== oud) return r;
      var leeg = geenResultaat(dialoog);
      if (leeg && (leeg !== oudLeeg || txt(leeg) !== oudTekst) && !r.length) return [];
      return null;
    }, 6000);
  }

  async function zoekGn(dialoog, zoek) {
    var gn = String(zoek.gn || zoek.term || '').replace(/\D/g, '');
    var termEl = eerste(['input[data-test="name"]', 'input[formcontrolname="name"]'], dialoog);
    var wnEl = q('input[data-test="scientific-name"], input[formcontrolname="scientificName"]', dialoog);
    var knop = q('button[data-test="select-search"]', dialoog);
    if (!termEl || !knop) return { ok: true, melding: 'zoekveld niet gevonden; zoek zelf op ' + gn };
    var codes = [gn, gn.slice(0, 6), gn.slice(0, 4)].filter(function (p, i, a) { return p.length >= 4 && a.indexOf(p) === i; });
    if (!codes.length) return { ok: true, melding: 'GN-code "' + gn + '" te kort om te zoeken' };
    // Eerst GN-code + Latijnse naam (zoals de declarant doet), dan zonder naam.
    var soort = String(zoek.wetenschappelijk || '').trim();
    var pogingen = [];
    if (soort && wnEl) codes.forEach(function (c) { pogingen.push([c, soort]); });
    codes.forEach(function (c) { pogingen.push([c, '']); });
    var rijen = null, gebruikt = '';
    for (var i = 0; i < pogingen.length && !(rijen && rijen.length); i++) {
      zetWaarde(termEl, pogingen[i][0]); blur(termEl);
      if (wnEl) { zetWaarde(wnEl, pogingen[i][1]); blur(wnEl); }
      gebruikt = pogingen[i][0] + (pogingen[i][1] ? ' + ' + pogingen[i][1] : '');
      rijen = await zoekEnWacht(dialoog, knop, gnRijen);
    }
    if (!rijen || !rijen.length) return { ok: true, melding: 'geen GN-codes gevonden voor ' + gn + (soort ? ' / ' + soort : '') + '; zoek zelf (bijv. op omschrijving)' };
    var basis = rijen.map(function (r) { return gnScore(r, gn, zoek.wetenschappelijk); });
    var max = Math.max.apply(null, basis);
    if (max <= 0) return { ok: true, melding: rijen.length + ' resultaten voor "' + gebruikt + '", maar geen passende GN-code; kies zelf' };
    // Gelijke GN + soort: het producttype beslist (aard product + Animo-omschrijving).
    var scores = rijen.map(function (r, j) { return basis[j] === max ? 100 + Math.round(typeOvereenkomst(txt(q('.mat-column-productType', r)), zoek.hints || zoek.aard || '') * 10) : 0; });
    var info = function (r) { return [txt(q('.mat-column-gnCode', r)), txt(q('.mat-column-scientificName', r)), txt(q('.mat-column-productType', r))].filter(Boolean).join(' · '); };
    var keuze = kiesBeste(rijen, scores, 100, 3);
    if (keuze.rij) {
      selecteerRij(keuze.rij);
      return { ok: true, gekozen: true, melding: 'gekozen: ' + info(keuze.rij) };
    }
    var types = keuze.kandidaten.map(function (r) { return txt(q('.mat-column-productType', r)); }).filter(function (x, j, a) { return x && a.indexOf(x) === j; });
    return { ok: true, melding: keuze.kandidaten.length + ' regels gemarkeerd; kies het producttype: ' + types.join(' · ') + (zoek.aard ? ' (HC: ' + zoek.aard + ')' : '') };
  }

  /* ---- Animo-code ---- */

  function animoRijen(dialoog) {
    return qa('[data-test="animo-codes-list-row"], [data-test="animo-codes-list"] mat-row', dialoog);
  }

  async function zoekAnimo(dialoog, zoek) {
    var code = String(zoek.animo || zoek.term || '').trim();
    if (!code) return { ok: true, melding: 'geen Animo-code in het voorstel; kies zelf' };
    function vind() { return animoRijen(dialoog).filter(function (r) { return txt(q('.mat-column-animoCode', r)) === code; })[0] || null; }
    var rij = await wachtOp(vind, 1500);
    if (!rij) {
      var termEl = q('input[data-test="search-term"], input[formcontrolname="searchTerm"]', dialoog);
      var knop = q('button[data-test="search-button"], button[type="submit"]', dialoog);
      if (termEl && knop) {
        zetWaarde(termEl, code);
        blur(termEl);
        knop.click();
        rij = await wachtOp(vind, 5000);
      }
    }
    if (!rij) return { ok: true, melding: 'Animo-code ' + code + ' niet in de lijst; kies zelf' };
    selecteerRij(rij);
    return { ok: true, gekozen: true, melding: 'gekozen: ' + code + ' · ' + txt(q('.mat-column-description', rij)) };
  }

  /* ---- dialogen openen, verwerken en afsluiten ---- */

  function dialogen() { return qa('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]'); }

  /** Herkent het type dialoog en voert de zoekopdracht uit. */
  async function verwerkDialoog(dialoog, zoek) {
    await wachtOp(function () { return q('input, mat-table, table', dialoog); }, 2000);
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
    var dialoog = await wachtOp(function () { var d = dialogen(); return d.length > voor ? d[d.length - 1] : null; }, 3000);
    if (!dialoog) return { ok: false, melding: 'dialoog ging niet open' };
    var res = await verwerkDialoog(dialoog, zoek);
    res.dialoog = dialoog;
    return res;
  }

  /** Klikt Save (bij een duidelijke keuze) of Cancel in de dialoog en wacht tot die dicht is. */
  async function sluitDialoog(dialoog, opslaan) {
    var knop = q(opslaan ? 'button[data-test="save"]' : 'button[data-test="cancel"], button[mat-dialog-close]', dialoog);
    if (!knop || knop.disabled) return false;
    knop.click();
    return !!(await wachtOp(function () { return !dialoog.isConnected; }, 4000));
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
    if (res.gekozen && opts && opts.dialogen !== false) {
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
    if (gnRes && gnRes.status !== 'ingevuld' && gnRes.status !== 'overgeslagen') { r.status = 'handmatig'; r.melding = 'eerst de GN-code kiezen'; return r; }
    var animoVeld = q('input[data-test="animo-code-selector"], #animoCodeSelector', kaart);
    var huidig = animoVeld ? String(animoVeld.value || '').trim() : '';
    if (huidig && !opts.overschrijven) {
      r.status = huidig.indexOf(item.animoCode) === 0 ? 'ingevuld' : 'handmatig';
      r.melding = huidig.indexOf(item.animoCode) === 0 ? 'al ingevuld door Portbase (' + huidig + ')' : 'Portbase vulde ' + huidig + ' in; voorstel was ' + item.animoCode + ' – controleer';
      return r;
    }
    var zoek = { animo: item.animoCode };
    var open = await wachtOp(function () { return dialogen().filter(function (d) { return q('app-animo-code-dialog, [data-test="animo-codes-list"]', d); })[0]; }, 1000);
    var res;
    if (open) {
      res = await verwerkDialoog(open, zoek);
      res.dialoog = open;
    } else {
      var knop = eerste(['button[data-test="animo-code-dialog"]', 'button[data-test*="animo"]'], kaart) || knopMetTekst(/animo/i, kaart);
      if (!knop) { r.status = 'handmatig'; r.melding = 'Animo-knop niet gevonden; kies ' + item.animoCode + ' zelf'; return r; }
      r.knop = knop;
      r.zoek = zoek;
      res = await zoekInDialoog(knop, zoek);
    }
    res = await afronden(res, opts);
    r.status = res.opgeslagen ? 'ingevuld' : 'handmatig';
    r.melding = res.melding || '';
    return r;
  }

  /** Is er een bewerkbaar declaratieformulier op de pagina? */
  function formulierAanwezig() {
    var f = q('app-declaration-form');
    if (!f) return false;
    if (q('[data-test="info-message-form-not-editable"]', f)) return false;
    return qa('input:not([disabled]):not([type="hidden"])', f).length > 0;
  }

  var exported = { vul: vul, vulVeld: vulVeld, zoekInDialoog: zoekInDialoog, afhandelen: afhandelen, rijScore: rijScore, gnScore: gnScore, typeOvereenkomst: typeOvereenkomst, orgZoek: orgZoek, lijstRijen: lijstRijen, formulierAanwezig: formulierAanwezig, besteOptie: besteOptie, ALGEMEEN: ALGEMEEN, DOCUMENT: DOCUMENT, GOED: GOED, CONTAINER: CONTAINER };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_FILL = exported;
})(typeof window !== 'undefined' ? window : this);
