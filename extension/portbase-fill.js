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

  function opties() {
    return qa('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]').filter(function (o) {
      return !o.classList.contains('mdc-list-item--disabled') && o.getAttribute('aria-disabled') !== 'true';
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
    var lijst = await wachtOp(function () { var o = opties(); return o.length ? o : null; }, 2000);
    if (!lijst) { sluitOverlay(); return { ok: false, melding: 'keuzelijst ging niet open' }; }
    var o = besteOptie(lijst, termen);
    if (!o) { sluitOverlay(); return { ok: false, melding: 'geen passende optie voor "' + termen[0] + '"' }; }
    o.click();
    await wacht(150);
    return { ok: true, gekozen: txt(o) };
  }

  async function kiesInAutocomplete(el, zoekterm, termen) {
    zetWaarde(el, zoekterm);
    var lijst = await wachtOp(function () { var o = opties(); return o.length ? o : null; }, 4000);
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
  async function vulVeld(def, waarde, ctx, opts) {
    var r = { naam: def.naam, waarde: waarde, status: 'ingevuld', melding: '' };
    if (!waarde) { r.status = 'overgeslagen'; return r; }
    var el = zoek(def, ctx);
    if (!el) { r.status = 'niet gevonden'; r.melding = 'veld niet gevonden op de pagina'; return r; }
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') { r.status = 'handmatig'; r.melding = 'veld is niet bewerkbaar'; return r; }
    if (def.soort === 'dialoog' || el.tagName === 'BUTTON') {
      // Portbase kiest dit via een zoekdialoog: niet automatisch kiezen, wel klaarzetten.
      r.status = 'handmatig';
      r.melding = 'kies via "' + txt(el) + '"';
      r.knop = el;
      r.zoekterm = def.zoekterm ? def.zoekterm(waarde) : waarde;
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

  /* ---------------- velddefinities ---------------- */

  function landTermen(code) { var naam = (root.GGB_LANDNAMEN || {})[code]; return [code, naam].filter(Boolean); }

  function zonderLand(v) { return String(v || '').replace(/\s*\([A-Z]{2}\)\s*$/, ''); }
  function zonderCode(v) { return String(v || '').replace(/\s*\([A-Z]{2}[A-Z0-9]{2,}\)\s*$/, ''); }
  function codeTussenHaakjes(v) { var m = String(v || '').match(/\(([A-Z]{2}[A-Z0-9]{2,})\)/); return m ? m[1] : v; }

  var VERVOER_TERMEN = {
    Vessel: ['Vessel', 'Ship', 'Sea', 'Maritime'], Airplane: ['Airplane', 'Aircraft', 'Air'],
    'Road vehicle': ['Road vehicle', 'Road', 'Truck'], Railway: ['Railway', 'Rail', 'Train']
  };

  // Selectors volgens de Portbase-pagina "New declaration" (Angular Material).
  // Let op: verborgen secties (Transit, Transhipment, Means of transport after
  // border) hergebruiken data-test-namen, daarom eerst op formulier/component scopen.
  var ALGEMEEN = [
    { naam: 'Bill of lading number (I.13)', key: 'bol', sel: ['app-form-general input[data-test="bill-of-lading-number"]', 'input[data-test="bill-of-lading-number"]'], label: /^bill of lading number/i },
    { naam: 'Destination (I.20-25)', key: 'bestemming', sel: ['mat-select[data-test="purpose-code"]', 'mat-select[formcontrolname="purposeCode"]'], label: /^destination/i },
    { naam: 'Exporter (I.1)', key: 'exporteur', sel: ['button[data-test="organisation-dialog-exporter"]'], label: /^exporter/i, soort: 'dialoog', zoekterm: zonderLand,
      dialoogZoek: function (r) { return { term: r.exporteur.naam, land: r.exporteur.land || r.landOorsprong.waarde, type: 'NAME' }; } },
    { naam: 'Importer (I.6)', key: 'importeur', sel: ['button[data-test="organisation-dialog-importer"]'], label: /^importer/i, soort: 'dialoog', zoekterm: zonderLand,
      dialoogZoek: function (r) { return { term: r.importeur.naam, land: r.importeur.land || 'NL', type: 'NAME' }; } },
    { naam: 'Border control post (I.4)', key: 'grenscontrolepost', sel: ['button[data-test="border-control-post-dialog"]'], label: /^border control post/i, soort: 'dialoog', zoekterm: codeTussenHaakjes,
      dialoogZoek: function (r) { var v = r.grenscontrolepost.waarde; return { term: zonderCode(v), code: codeTussenHaakjes(v), land: 'NL' }; } },
    { naam: 'Place of destination (I.7)', key: 'plaatsBestemming', sel: ['button[data-test="place-of-destination-dialog"]'], label: /^place of destination/i, soort: 'dialoog',
      dialoogZoek: function (r) { return { term: zonderLand(r.plaatsBestemming.waarde).split(',')[0], land: r.importeur.land || 'NL', type: 'NAME' }; } },
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
      termen: function (code) { var d = DOC_TYPES[code]; return [d && d.portbase, code === 'LAB' ? 'Lab report' : '', code === 'COMM' ? 'Commercial' : ''].filter(Boolean); } },
    { naam: 'Identification', key: 'identificatie', sel: ['input[data-test="document-number"]', 'input[formcontrolname="documentNumber"]'], label: /^identification$/i },
    { naam: 'Date of issue', key: 'datumAfgifte', sel: ['input[data-test="document-date-of-issue"]', 'input[formcontrolname="dateOfIssue"]'], label: /^date of issue/i, soort: 'tekst' },
    { naam: 'Establishment of origin', key: 'inrichtingOorsprong', sel: ['button[data-test="organisation-dialog"]'], label: /^establishment of origin/i, soort: 'dialoog',
      dialoogZoek: function (r, doc) {
        var erk = (r.goederen || []).map(function (g) { return g.erkenningsnummer; }).filter(Boolean)[0];
        var land = doc.landAfgifte || r.landOorsprong.waarde;
        return erk ? { term: erk, land: land, type: 'APPROVAL_NUMBER' } : { term: doc.inrichtingOorsprong, land: land, type: 'NAME' };
      } },
    { naam: 'Country of issue', key: 'landAfgifte', sel: ['input[data-test="document-country-un-code-of-issue"]', 'input[formcontrolname="countryUnCodeOfIssue"]'], label: /^country of issue/i, termen: landTermen }
  ];

  var GOED = [
    { naam: 'GN-code (I.31)', key: 'gnCode', sel: ['button[data-test="gn-code-dialog"]'], label: /^gn-code/i, soort: 'dialoog',
      dialoogZoek: function (r, g) { return { gn: g.gnCode, term: g.gnCode, wetenschappelijk: g.wetenschappelijkeNaam, aard: g.aardProduct }; } },
    { naam: 'Goods description (I.31)', key: 'omschrijving', sel: ['input[data-test="goods-description"]', 'input[formcontrolname="goodsDescription"]'], label: /^goods description/i },
    { naam: 'Gross weight (I.34)', key: 'brutoGewicht', sel: ['input[data-test="gross-weight"]', 'input[formcontrolname="grossWeight"]'], label: /^gross weight/i },
    { naam: 'Nett weight (I.34)', key: 'nettoGewicht', sel: ['input[data-test="nett-weight"]', 'input[formcontrolname="nettWeight"]'], label: /^nett? weight/i },
    { naam: 'Number of packages (I.32)', key: 'aantalColli', sel: ['input[data-test="packaging-number-of-packages"]', 'input[formcontrolname="numberOfPackages"]'], label: /^number of packages/i },
    { naam: 'Package type (I.32)', key: 'verpakkingstype', sel: ['mat-select[data-test="packaging-package-type"]', 'mat-select[formcontrolname="packageType"]'], label: /^package type/i,
      termen: function (v) { return [v, String(v).replace(/s$/i, ''), /carton/i.test(v) ? 'Box' : '']; } },
    { naam: 'Batch number (I.34)', key: 'batchnummer', sel: ['input[formcontrolname="batchNumber"]'], label: /^batch number/i },
    { naam: 'Additional units (I.33)', key: 'aanvullendeEenheden', sel: ['input[formcontrolname="additionalUnits"]'], label: /^additional units/i },
    { naam: 'Activity / approval number (I.15)', key: 'erkenningsnummer', sel: ['button[data-test="organisation-dialog"]'], label: /^activity \/ approval number/i, soort: 'dialoog',
      dialoogZoek: function (r, g) { return { term: g.erkenningsnummer, land: r.landOorsprong.waarde || r.exporteur.land, type: 'APPROVAL_NUMBER' }; } }
  ];

  /** Waarde van een algemeen veld uit het AI-resultaat. */
  function algemeneWaarde(r, key) {
    if (key === 'exporteur' || key === 'importeur') {
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
    function metZoek(def, res, item) {
      if (res.knop) res.zoek = def.dialoogZoek ? def.dialoogZoek(r, item) : { term: res.zoekterm };
      return res;
    }

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
        metZoek(def, await vulVeld(def, algemeneWaarde(r, def.key), form, opts)));
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
    for (var d = 0; d < (r.documenten || []).length; d++) {
      var doc = r.documenten[d];
      meld('Document ' + (d + 1) + '…');
      var dk = await legeKaart('app-form-documents', /^document\(s\)/i, ['button[data-test="add-document"]'], /add document/i, gebruikt);
      if (!dk) {
        push('Document(s)', { naam: 'Document ' + (d + 1), waarde: doc.type + ' ' + doc.identificatie, status: 'niet gevonden', melding: 'geen (lege) documentregel gevonden' });
        continue;
      }
      gebruikt.push(dk);
      for (var df = 0; df < DOCUMENT.length; df++) push('Document ' + (d + 1), metZoek(DOCUMENT[df], await vulVeld(DOCUMENT[df], doc[DOCUMENT[df].key], dk, opts), doc));
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
      for (var gf = 0; gf < GOED.length; gf++) push('Goods item ' + (g + 1), metZoek(GOED[gf], await vulVeld(GOED[gf], r.goederen[g][GOED[gf].key], gk, opts), r.goederen[g]));
    }

    meld('');
    return verslag;
  }

  /* ---------------- zoekdialogen ---------------- */

  function dialoogRijen(dialoog) {
    return qa('[data-test="organisations-list"] mat-row, [data-test="organisations-list"] tr.mat-mdc-row, [data-test="organisations-list"] [role="row"]', dialoog).filter(function (rij) {
      return !rij.classList.contains('mat-mdc-no-data-row') && !rij.classList.contains('cdk-no-data-row') && !rij.matches('mat-header-row, [role="row"].mat-mdc-header-row');
    });
  }
  function cel(rij, kolom) { return txt(q('.mat-column-' + kolom, rij)); }

  /** Score van een zoekresultaat t.o.v. de zoekopdracht (4 = exact). */
  function rijScore(rij, zoek) {
    var term = norm(zoek.term);
    if (!term) return 0;
    if (zoek.type === 'APPROVAL_NUMBER') {
      var erk = norm(cel(rij, 'approvalNumber'));
      return erk === term ? 4 : (erk.indexOf(term) >= 0 ? 2 : 0);
    }
    var naam = norm(cel(rij, 'name') || txt(rij));
    var kaal = function (s) { return s.replace(/\b(b ?v|n ?v|ltd|limited|pvt|private|llc|inc|co|company|gmbh|s ?a|sarl|spa|bv)\b/g, '').replace(/\s+/g, ' ').trim(); };
    if (naam === term || kaal(naam) === kaal(term)) return 4;
    if (naam.indexOf(term) === 0 || kaal(naam).indexOf(kaal(term)) === 0) return 2;
    return naam.indexOf(term) >= 0 ? 1 : 0;
  }

  function selecteerRij(rij) {
    // Native input eerst: in Angular Material reageert alleen die (of het label) op een klik.
    var keuze = eerste(['.mat-column-selection input[type="radio"]', '.mat-column-selection input[type="checkbox"]', '.mat-column-selection label', '.mat-column-selection button'], rij);
    (keuze || rij).click();
    rij.style.outline = '3px solid #0b5fa5';
    rij.scrollIntoView({ block: 'center' });
  }

  /**
   * Organisatiedialoog (exporteur, importeur, inrichting van oorsprong,
   * erkenningsnummer, ...): zoektype + land + zoekterm invullen, zoeken en de
   * best passende rij aanvinken. Op "Save" klikt de gebruiker zelf.
   */
  async function zoekOrganisatie(dialoog, zoek) {
    var termEl = q('input[data-test="search-term"]', dialoog);
    if (zoek.type) {
      var radio = q('[data-test="search-type"] input[value="' + zoek.type + '"]', dialoog);
      if (radio && !radio.checked) { radio.click(); await wacht(100); }
    }
    var landEl = q('input[data-test="search-country"]', dialoog);
    if (landEl && zoek.land && !String(landEl.value || '').trim()) {
      var l = await kiesInAutocomplete(landEl, zoek.land, landTermen(zoek.land));
      if (!l.ok) return { ok: true, melding: 'kies eerst het land (' + zoek.land + ') en klik Search' };
    }
    var term = String(zoek.term || '').trim();
    zetWaarde(termEl, term);
    blur(termEl);
    if (term.length < 3) return { ok: true, melding: 'zoekterm korter dan 3 tekens; vul zelf aan' };
    var knop = q('button[data-test="select-search"]', dialoog);
    if (!knop) return { ok: true, melding: 'klik zelf op Search' };
    knop.click();
    var rijen = await wachtOp(function () { var r = dialoogRijen(dialoog); return r.length ? r : null; }, 8000);
    if (!rijen) return { ok: true, melding: 'geen resultaten voor "' + term + '"; pas de zoekterm aan of voeg handmatig toe' };
    var scores = rijen.map(function (r) { return rijScore(r, zoek); });
    var max = Math.max.apply(null, scores);
    var besten = rijen.filter(function (r, i) { return scores[i] === max; });
    // Alleen bij een exacte match (naam op rechtsvorm na, of erkenningsnummer) automatisch aanvinken.
    if (max >= 4 && besten.length === 1) {
      selecteerRij(besten[0]);
      return { ok: true, gekozen: true, melding: 'aangevinkt: ' + (cel(besten[0], 'name') || txt(besten[0])) + (cel(besten[0], 'city') ? ', ' + cel(besten[0], 'city') : '') + ' – controleer en klik Save' };
    }
    besten.forEach(function (r) { if (max > 0) r.style.outline = '2px dashed #b26a00'; });
    return { ok: true, melding: rijen.length + ' resultaten' + (max > 0 ? ', ' + besten.length + ' even goed (gemarkeerd)' : '') + '; kies zelf en klik Save' };
  }

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

  /**
   * Lijstdialoog zonder zoekterm (Border control post):
   * land invullen als het leeg is, dan de rij met de juiste code of naam aanvinken.
   */
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
    var max = Math.max.apply(null, scores);
    var besten = rijen.filter(function (r, i) { return scores[i] === max; });
    if (max >= 3 && besten.length === 1) {
      selecteerRij(besten[0]);
      return { ok: true, gekozen: true, melding: 'aangevinkt: ' + txt(besten[0]) + ' – controleer en klik Save' };
    }
    besten.forEach(function (r) { if (max > 0) r.style.outline = '2px dashed #b26a00'; });
    return { ok: true, melding: max > 0 ? besten.length + ' mogelijke regels gemarkeerd; kies zelf en klik Save' : '"' + (zoek.term || zoek.code) + '" niet in de lijst; kies zelf' };
  }

  /* ---------------- GN-codedialoog ---------------- */

  function gnRijen(dialoog) {
    return qa('[data-test="gn-codes-list-row"], [data-test="gn-codes-list"] mat-row', dialoog);
  }

  /** Score van een GN-regel: GN (Portbase toont 4-8 cijfers) en soort. */
  function gnScore(rij, gn, soort) {
    var cel = txt(q('.mat-column-gnCode', rij)).replace(/\D/g, '');
    var g = 0;
    if (cel && cel === gn) g = 3;
    else if (cel && (gn.indexOf(cel) === 0 || cel.indexOf(gn) === 0)) g = 2;
    if (!g) return 0;
    var s = 0, wn = norm(txt(q('.mat-column-scientificName', rij))), zs = norm(soort);
    if (zs && wn === zs) s = 2;
    else if (zs && wn && wn.split(' ')[0] === zs.split(' ')[0]) s = 1;
    return g * 10 + s;
  }

  /**
   * GN-codedialoog: zoeken op GN-code (8 cijfers, dan 6, dan 4), regels
   * rangschikken op GN-code en wetenschappelijke naam en alleen aanvinken als
   * er precies één beste regel is. Bij meerdere producttypes kiest de
   * gebruiker; de aard van het product volgens het HC staat in de melding.
   */
  async function zoekGn(dialoog, zoek) {
    var gn = String(zoek.gn || zoek.term || '').replace(/\D/g, '');
    var termEl = eerste(['input[data-test="name"]', 'input[formcontrolname="name"]'], dialoog);
    var knop = q('button[data-test="select-search"]', dialoog);
    if (!termEl || !knop) return { ok: true, melding: 'zoekveld niet gevonden; zoek zelf op ' + gn };
    var pogingen = [gn, gn.slice(0, 6), gn.slice(0, 4)].filter(function (p, i, a) { return p.length >= 4 && a.indexOf(p) === i; });
    if (!pogingen.length) return { ok: true, melding: 'GN-code "' + gn + '" te kort om te zoeken' };
    // "Scientific name" kan door de browser automatisch gevuld zijn en filtert dan ongemerkt mee.
    var wnEl = q('input[data-test="scientific-name"]', dialoog);
    if (wnEl && String(wnEl.value || '').trim()) { zetWaarde(wnEl, ''); blur(wnEl); }
    var rijen = null, gebruikt = '';
    for (var i = 0; i < pogingen.length && !rijen; i++) {
      var oud = gnRijen(dialoog)[0];
      zetWaarde(termEl, pogingen[i]);
      blur(termEl);
      knop.click();
      gebruikt = pogingen[i];
      rijen = await wachtOp(function () { var r = gnRijen(dialoog); return r.length && r[0] !== oud ? r : null; }, 5000);
    }
    if (!rijen) return { ok: true, melding: 'geen GN-codes gevonden voor ' + gn + '; zoek zelf (bijv. op omschrijving)' };
    var scores = rijen.map(function (r) { return gnScore(r, gn, zoek.wetenschappelijk); });
    var max = Math.max.apply(null, scores);
    if (max <= 0) return { ok: true, melding: rijen.length + ' resultaten voor "' + gebruikt + '", maar geen passende GN-code; kies zelf' };
    var besten = rijen.filter(function (r, j) { return scores[j] === max; });
    var info = function (r) { return txt(q('.mat-column-gnCode', r)) + ' · ' + txt(q('.mat-column-scientificName', r)) + ' · ' + txt(q('.mat-column-productType', r)); };
    if (besten.length === 1) {
      selecteerRij(besten[0]);
      return { ok: true, gekozen: true, melding: 'aangevinkt: ' + info(besten[0]) + ' – controleer en klik Save' };
    }
    besten.forEach(function (r) { r.style.outline = '2px dashed #b26a00'; });
    var types = besten.map(function (r) { return txt(q('.mat-column-productType', r)); }).filter(function (x, j, a) { return x && a.indexOf(x) === j; });
    return { ok: true, melding: besten.length + ' regels gemarkeerd; kies het producttype: ' + types.join(' · ') + (zoek.aard ? ' (HC: ' + zoek.aard + ')' : '') + ', dan Save' };
  }

  /**
   * Opent een Portbase-zoekdialoog en vult de zoekopdracht in.
   * zoek: {term, land?, type?: 'NAME'|'APPROVAL_NUMBER'|'CITY'|'POSTAL_CODE'} of een string.
   * Er wordt nooit op Save geklikt.
   */
  async function zoekInDialoog(knop, zoek) {
    if (typeof zoek === 'string' || !zoek) zoek = { term: zoek || '' };
    // Bestaande (verborgen) dialogen niet meenemen: we zoeken de nieuw geopende.
    var voor = qa('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]').length;
    if (!knop || !knop.isConnected) return { ok: false, melding: 'knop niet meer op de pagina' };
    knop.scrollIntoView({ block: 'center' });
    knop.click();
    var dialoog = await wachtOp(function () { var d = qa('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]'); return d.length > voor ? d[d.length - 1] : null; }, 3000);
    if (!dialoog) return { ok: false, melding: 'dialoog ging niet open' };
    // Wachten tot de inhoud van de dialoog er staat, dan het type bepalen.
    await wachtOp(function () { return q('input, mat-table, table', dialoog); }, 2000);
    if (q('input[data-test="search-term"]', dialoog)) return zoekOrganisatie(dialoog, zoek);
    if (q('app-gn-code-dialog, [data-test="gn-codes-list"]', dialoog)) return zoekGn(dialoog, zoek);
    if (zoek.code || q('mat-table, table, [role="table"], input[aria-autocomplete="list"]', dialoog)) return kiesUitLijst(dialoog, zoek);
    // Onbekende dialoog (bijv. grenscontrolepost, GN-code): eerste zoekveld invullen.
    var veld = await wachtOp(function () {
      return qa('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled])', dialoog).filter(function (i) { return i.offsetParent !== null || i.getClientRects().length; })[0];
    }, 2000);
    if (!veld) return { ok: true, melding: 'dialoog geopend; geen zoekveld gevonden' };
    if (zoek.term) {
      zetWaarde(veld, zoek.term);
      veld.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }
    return { ok: true, melding: 'zoekterm ingevuld; kies het resultaat' };
  }

  /** Is er een bewerkbaar declaratieformulier op de pagina? */
  function formulierAanwezig() {
    var f = q('app-declaration-form');
    if (!f) return false;
    if (q('[data-test="info-message-form-not-editable"]', f)) return false;
    return qa('input:not([disabled]):not([type="hidden"])', f).length > 0;
  }

  var exported = { vul: vul, vulVeld: vulVeld, zoekInDialoog: zoekInDialoog, rijScore: rijScore, gnScore: gnScore, lijstRijen: lijstRijen, formulierAanwezig: formulierAanwezig, besteOptie: besteOptie, ALGEMEEN: ALGEMEEN, DOCUMENT: DOCUMENT, GOED: GOED, CONTAINER: CONTAINER };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_FILL = exported;
})(typeof window !== 'undefined' ? window : this);
