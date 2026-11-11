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

  function sluitOverlay() {
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
    if (!o) { sluitOverlay(); return { ok: false, melding: 'geen passende suggestie voor "' + zoekterm + '"' }; }
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
        sluitOverlay();
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
    { naam: 'Exporter (I.1)', key: 'exporteur', sel: ['button[data-test="organisation-dialog-exporter"]'], label: /^exporter/i, soort: 'dialoog', zoekterm: zonderLand },
    { naam: 'Importer (I.6)', key: 'importeur', sel: ['button[data-test="organisation-dialog-importer"]'], label: /^importer/i, soort: 'dialoog', zoekterm: zonderLand },
    { naam: 'Border control post (I.4)', key: 'grenscontrolepost', sel: ['button[data-test="border-control-post-dialog"]'], label: /^border control post/i, soort: 'dialoog', zoekterm: codeTussenHaakjes },
    { naam: 'Place of destination (I.7)', key: 'plaatsBestemming', sel: ['button[data-test="place-of-destination-dialog"]'], label: /^place of destination/i, soort: 'dialoog' },
    { naam: 'Country of origin (I.11)', key: 'landOorsprong', sel: ['app-form-general input[formcontrolname="countryOfOriginUnCode"]', 'input[data-test="country-of-origin-un-code"]'], label: /^country of origin/i, termen: landTermen },
    { naam: 'Country of loading (I.14)', key: 'landLading', sel: ['app-form-general input[formcontrolname="countryOfLoadingUnCode"]', 'input[formcontrolname="countryOfLoadingUnCode"]'], label: /^country of loading/i, termen: landTermen },
    { naam: 'Goods certified as or for (I.18)', key: 'gecertificeerdVoor', sel: ['mat-select[data-test="goods-intended-use-code"]', 'mat-select[formcontrolname="goodsIntendedUseCode"]'], label: /^goods certified/i },
    { naam: 'Transport conditions (I.16)', key: 'transportconditie', sel: ['mat-select[data-test="transport-conditions-code"]', 'mat-select[formcontrolname="transportConditionsCode"]'], label: /^transport conditions/i },
    { naam: 'Means of transport (I.13)', key: 'vervoermiddel', sel: ['mat-select[data-test="arrival-means-of-transport-mode"]', 'app-form-means-of-transport-before-border mat-select[formcontrolname="mode"]'],
      termen: function (v) { return VERVOER_TERMEN[v] || [v]; } },
    { naam: 'Name / identification (I.13)', key: 'vervoermiddelNaam', sel: ['input[data-test="arrival-means-of-transport-identification"]', 'app-form-means-of-transport-before-border input[formcontrolname="identification"]'] },
    { naam: 'Nationality (I.13)', key: 'vervoermiddelNationaliteit', sel: ['input[data-test="arrival-means-of-transport-nationality-un-code"]', 'app-form-means-of-transport-before-border input[formcontrolname="nationalityUnCode"]'], termen: landTermen },
    { naam: 'Expected date of arrival (I.10)', key: 'aankomstDatum', sel: ['app-form-means-of-transport-before-border input[data-test="arrival-date-time-estimated"]', 'input[data-test="arrival-date-time-estimated"]'], soort: 'tekst' },
    { naam: 'Expected time of arrival', key: 'aankomstTijd', sel: ['app-form-means-of-transport-before-border input[data-test="start-time"]', 'app-form-means-of-transport-before-border input.mat-timepicker-input'], soort: 'tekst' }
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
    { naam: 'Establishment of origin', key: 'inrichtingOorsprong', sel: ['button[data-test="organisation-dialog"]'], label: /^establishment of origin/i, soort: 'dialoog' },
    { naam: 'Country of issue', key: 'landAfgifte', sel: ['input[data-test="document-country-un-code-of-issue"]', 'input[formcontrolname="countryUnCodeOfIssue"]'], label: /^country of issue/i, termen: landTermen }
  ];

  var GOED = [
    { naam: 'GN-code (I.31)', key: 'gnCode', sel: ['button[data-test="gn-code-dialog"]'], label: /^gn-code/i, soort: 'dialoog' },
    { naam: 'Goods description (I.31)', key: 'omschrijving', sel: ['input[data-test="goods-description"]', 'input[formcontrolname="goodsDescription"]'], label: /^goods description/i },
    { naam: 'Gross weight (I.34)', key: 'brutoGewicht', sel: ['input[data-test="gross-weight"]', 'input[formcontrolname="grossWeight"]'], label: /^gross weight/i },
    { naam: 'Nett weight (I.34)', key: 'nettoGewicht', sel: ['input[data-test="nett-weight"]', 'input[formcontrolname="nettWeight"]'], label: /^nett? weight/i },
    { naam: 'Number of packages (I.32)', key: 'aantalColli', sel: ['input[data-test="packaging-number-of-packages"]', 'input[formcontrolname="numberOfPackages"]'], label: /^number of packages/i },
    { naam: 'Package type (I.32)', key: 'verpakkingstype', sel: ['mat-select[data-test="packaging-package-type"]', 'mat-select[formcontrolname="packageType"]'], label: /^package type/i,
      termen: function (v) { return [v, String(v).replace(/s$/i, ''), /carton/i.test(v) ? 'Box' : '']; } },
    { naam: 'Batch number (I.34)', key: 'batchnummer', sel: ['input[formcontrolname="batchNumber"]'], label: /^batch number/i },
    { naam: 'Additional units (I.33)', key: 'aanvullendeEenheden', sel: ['input[formcontrolname="additionalUnits"]'], label: /^additional units/i },
    { naam: 'Activity / approval number (I.15)', key: 'erkenningsnummer', sel: ['button[data-test="organisation-dialog"]'], label: /^activity \/ approval number/i, soort: 'dialoog' }
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
      push(def.key === 'gecertificeerdVoor' || def.key === 'transportconditie' ? 'Goods' : (i >= 10 ? 'Means of transport' : 'General'),
        await vulVeld(def, algemeneWaarde(r, def.key), form, opts));
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
      for (var df = 0; df < DOCUMENT.length; df++) push('Document ' + (d + 1), await vulVeld(DOCUMENT[df], doc[DOCUMENT[df].key], dk, opts));
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
      for (var gf = 0; gf < GOED.length; gf++) push('Goods item ' + (g + 1), await vulVeld(GOED[gf], r.goederen[g][GOED[gf].key], gk, opts));
    }

    meld('');
    return verslag;
  }

  /**
   * Opent een Portbase-zoekdialoog (exporteur, grenscontrolepost, GN-code …) en
   * zet de zoekterm in het eerste zoekveld. De gebruiker kiest zelf het juiste
   * resultaat; er wordt niets automatisch geselecteerd.
   */
  async function zoekInDialoog(knop, term) {
    if (!knop || !knop.isConnected) return { ok: false, melding: 'knop niet meer op de pagina' };
    knop.scrollIntoView({ block: 'center' });
    knop.click();
    var dialoog = await wachtOp(function () { return q('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]'); }, 3000);
    if (!dialoog) return { ok: false, melding: 'dialoog ging niet open' };
    var veld = await wachtOp(function () {
      return qa('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled])', dialoog).filter(function (i) { return i.offsetParent !== null || i.getClientRects().length; })[0];
    }, 2000);
    if (!veld) return { ok: true, melding: 'dialoog geopend; geen zoekveld gevonden' };
    if (term) {
      zetWaarde(veld, term);
      veld.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }
    return { ok: true };
  }

  /** Is er een bewerkbaar declaratieformulier op de pagina? */
  function formulierAanwezig() {
    var f = q('app-declaration-form');
    if (!f) return false;
    if (q('[data-test="info-message-form-not-editable"]', f)) return false;
    return qa('input:not([disabled]):not([type="hidden"])', f).length > 0;
  }

  var exported = { vul: vul, vulVeld: vulVeld, zoekInDialoog: zoekInDialoog, formulierAanwezig: formulierAanwezig, besteOptie: besteOptie, ALGEMEEN: ALGEMEEN, DOCUMENT: DOCUMENT, GOED: GOED, CONTAINER: CONTAINER };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_FILL = exported;
})(typeof window !== 'undefined' ? window : this);
