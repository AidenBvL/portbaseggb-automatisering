/*
 * Leest een declaratie uit de Angular-DOM van de Portbase-pagina
 * "Declaration Food and Consumer Products" (sidebar view-declaration /
 * create-declaration). Gebruikt de data-test-attributen en formcontrol-ids
 * van de pagina; leest waarden via de value-property (Angular zet die niet
 * als attribuut).
 *
 * Pure functie: extractDeclaration(root) -> declaratie-object of null.
 */
(function (root) {
  'use strict';

  function txt(el) { return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function val(el) { return el ? String(el.value || '').trim() : ''; }
  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function qa(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function landCode(v) {
    var m = String(v || '').trim().toUpperCase().match(/^([A-Z]{2})\b/);
    return m ? m[1] : '';
  }
  function eersteCode(v, re) {
    var m = String(v || '').match(re);
    return m ? m[0] : '';
  }

  /** Waarde van een read-only "kolom": <mat-label class="label">X</mat-label> gevolgd door tekst. */
  function labelWaarde(ctx, labelStart) {
    var labels = qa('mat-label.label', ctx);
    for (var i = 0; i < labels.length; i++) {
      if (txt(labels[i]).indexOf(labelStart) === 0) {
        var col = labels[i].parentElement;
        var t = txt(col).replace(txt(labels[i]), '').trim();
        return t;
      }
    }
    return '';
  }

  function DOC_MAP(naam) {
    if (root.GGB_PARSER && root.GGB_PARSER.mapDocType) return root.GGB_PARSER.mapDocType(naam);
    return 'OTHER';
  }

  function leesDocumenten(ctx) {
    var docs = [];
    var form = q('app-form-documents', ctx);
    if (!form) return docs;
    qa('mat-card', form).forEach(function (card) {
      // Opgeslagen (read-only) rij: kolommen met mat-label + div.
      if (card.getAttribute('data-test') === 'document-form-item-saved' || (!q('mat-select', card) && qa('mat-label', card).length)) {
        var d = { naam: '', type: 'OTHER', identificatie: '', datum: '', verwijstNaar: '', bestand: '' };
        qa('.col', card).forEach(function (col) {
          var label = txt(q('mat-label', col));
          var waarde = txt(col).replace(label, '').trim();
          if (/^type$/i.test(label)) { d.naam = waarde; d.type = DOC_MAP(waarde); }
          else if (/^identification$/i.test(label)) d.identificatie = waarde;
          else if (/^date of issue$/i.test(label)) d.datum = waarde;
        });
        if (d.naam || d.identificatie) docs.push(d);
        return;
      }
      // Bewerkbare rij: select + inputs.
      var sel = q('mat-select[data-test="document-type"] .mat-mdc-select-value-text', card) || q('mat-select[formcontrolname="documentType"] .mat-mdc-select-value-text', card);
      var naam = txt(sel).replace(/\s*\(\d+\)\s*$/, '');
      var nummer = val(q('input[data-test="document-number"]', card) || q('input[formcontrolname="documentNumber"]', card));
      var datum = val(q('input[data-test="document-date-of-issue"]', card) || q('input[formcontrolname="dateOfIssue"]', card));
      var bestand = txt(q('.file-name a', card));
      if (naam || nummer) docs.push({ naam: naam, type: DOC_MAP(naam), identificatie: nummer, datum: datum, verwijstNaar: '', bestand: bestand, landAfgifte: landCode(val(q('input[data-test="document-country-un-code-of-issue"]', card))) });
    });
    return docs;
  }

  function leesGoederen(ctx) {
    var items = [];
    var form = q('app-form-goods-items', ctx);
    if (!form) return items;
    qa('mat-card', form).forEach(function (card) {
      var gnRaw = val(q('input[data-test="gn-code-selector"]', card));
      var animoRaw = val(q('input[data-test="animo-code-selector"]', card));
      var omschrijving = val(q('input[data-test="goods-description"]', card));
      var gn = eersteCode(gnRaw, /\d{4,10}/);
      var animo = eersteCode(animoRaw, /\d{6}/);
      if (!gn && !omschrijving) return;
      items.push({
        gn: gn, gnRaw: gnRaw, animo: animo, animoNaam: animoRaw, omschrijving: omschrijving,
        brutoGewicht: val(q('input[data-test="gross-weight"]', card)),
        nettoGewicht: val(q('input[data-test="nett-weight"]', card)),
        equipment: txt(q('mat-select[formcontrolname="equipmentNumber"] .mat-mdc-select-value-text', card))
      });
    });
    return items;
  }

  function extractDeclaration(doc) {
    doc = doc || document;
    var page = q('app-declaration-form', doc);
    if (!page) return null;
    var checked = q('mat-radio-group[data-test="goods-classification-code"] input[type="radio"]:checked', page) || q('mat-radio-group[data-test="goods-classification-code"] .mat-mdc-radio-checked input', page);
    var decl = {
      bron: 'portbase',
      portbaseId: (String(location.href).match(/view-declaration\/(\d+)/) || [])[1] || '',
      referentieNvwa: labelWaarde(page, 'Reference NVWA'),
      chedReferentie: labelWaarde(page, 'CHED-reference'),
      type: checked ? checked.value : '',
      eigenReferentie: val(q('input[data-test="customer-reference"]', page)),
      bol: val(q('input[data-test="bill-of-lading-number"]', page)),
      exporteur: val(q('#exporterSelector', page)),
      importeur: val(q('#importerSelector', page)),
      grenscontrolepost: val(q('input[data-test="border-control-post-selector"]', page)),
      landOorsprong: landCode(val(q('input[data-test="country-of-origin-un-code"]', page))),
      landLading: landCode(val(q('input[data-test="country-of-loading-un-code"]', page))),
      eta: val(q('input[data-test="arrival-date-time-estimated"]', page)),
      bestemming: txt(q('mat-select[data-test="purpose-code"] .mat-mdc-select-value-text', page)),
      gebruik: txt(q('mat-select[data-test="goods-intended-use-code"] .mat-mdc-select-value-text', page)),
      transportconditie: txt(q('mat-select[data-test="transport-conditions-code"] .mat-mdc-select-value-text', page)),
      documenten: leesDocumenten(page),
      goederen: leesGoederen(page)
    };
    if (!decl.type) {
      var dierlijk = decl.goederen.some(function (g) { return /^(0[1-5]|1[56]|2[01]|3[05])/.test(g.gn); });
      decl.type = dierlijk ? 'PRD' : 'LNV';
    }
    if (!decl.eigenReferentie) decl.eigenReferentie = decl.referentieNvwa || decl.chedReferentie || decl.bol;
    return decl;
  }

  /** Stabiele sleutel om te zien of er iets veranderd is. */
  function fingerprint(decl) {
    return decl ? JSON.stringify([decl.type, decl.landOorsprong, decl.landLading, decl.eta, decl.documenten, decl.goederen.map(function (g) { return [g.gn, g.animo]; })]) : '';
  }

  var exported = { extractDeclaration: extractDeclaration, fingerprint: fingerprint, landCode: landCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.GGB_PORTBASE = exported;
})(typeof window !== 'undefined' ? window : this);
