/*
 * Parser voor de platte tekst van een Portbase-declaratie (kopiëren/plakken
 * van het declaratie-overzicht). Haalt land van oorsprong, land van lading,
 * ETA, documenten en goederenitems eruit.
 */
(function (root) {
  'use strict';

  var DOC_MAP = [
    [/^health certificate/i, 'HC'],
    [/^gezondheidscertificaat/i, 'HC'],
    [/lab report/i, 'LAB'],
    [/analyse|laborator/i, 'LAB'],
    [/catch certificate|vangstcertificaat/i, 'CATCH'],
    [/official certificate|officieel certificaat/i, 'OFFCERT'],
    [/private attestation/i, 'PRIVATT'],
    [/cites/i, 'CITES'],
    [/commercial document|handelsdocument/i, 'COMM']
  ];

  function mapDocType(naam) {
    for (var i = 0; i < DOC_MAP.length; i++) {
      if (DOC_MAP[i][0].test(naam)) return DOC_MAP[i][1];
    }
    return 'OTHER';
  }

  var LABELS = {
    ownRef: /^own reference$/i,
    bol: /^bill of lading number/i,
    landOorsprong: /^country of origin/i,
    landLading: /^country of loading/i,
    eta: /^expected date of arrival/i,
    docType: /^type$/i,
    docId: /^identification$/i,
    docDate: /^date of issue$/i,
    gn: /^gn-code/i,
    animo: /^animo code/i,
    omschrijving: /^goods description/i,
    exporter: /^exporter \(/i,
    importer: /^importer \(/i
  };

  function parsePortbase(text) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var decl = { type: 'PRD', eigenReferentie: '', bol: '', landOorsprong: '', landLading: '', eta: '', exporteur: '', importeur: '', documenten: [], goederen: [] };
    var docs = [], gns = [], animos = [], omschr = [];
    var curDoc = null;

    function next(i) { return i + 1 < lines.length ? lines[i + 1] : ''; }

    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (LABELS.ownRef.test(l)) decl.eigenReferentie = next(i);
      else if (LABELS.bol.test(l)) decl.bol = next(i);
      else if (LABELS.landOorsprong.test(l)) decl.landOorsprong = next(i).toUpperCase();
      else if (LABELS.landLading.test(l)) decl.landLading = next(i).toUpperCase();
      else if (LABELS.exporter.test(l)) decl.exporteur = next(i);
      else if (LABELS.importer.test(l)) decl.importeur = next(i);
      else if (LABELS.eta.test(l)) decl.eta = next(i);
      else if (LABELS.docType.test(l)) { curDoc = { naam: next(i), type: mapDocType(next(i)), identificatie: '', datum: '', verwijstNaar: '' }; docs.push(curDoc); }
      else if (LABELS.docId.test(l) && curDoc) curDoc.identificatie = next(i);
      else if (LABELS.docDate.test(l) && curDoc) curDoc.datum = next(i);
      else if (LABELS.gn.test(l)) gns.push(next(i));
      else if (LABELS.animo.test(l)) animos.push(next(i));
      else if (LABELS.omschrijving.test(l)) omschr.push(next(i));
    }

    // De ETA in Portbase kan gevolgd worden door een losse tijdregel; die negeren we.
    if (decl.eta && /^[0-9]{1,2}:[0-9]{2}/.test(decl.eta)) decl.eta = '';

    decl.documenten = docs.filter(function (d) { return d.naam; });
    for (var g = 0; g < gns.length; g++) {
      decl.goederen.push({
        gn: gns[g].replace(/[^0-9]/g, ''),
        animo: (animos[g] || '').split(' ')[0],
        animoNaam: animos[g] || '',
        omschrijving: omschr[g] || ''
      });
    }

    // Heuristiek voor het declaratietype: dierlijke hoofdstukken => CHED-P.
    if (decl.goederen.length) {
      var dierlijk = decl.goederen.some(function (g) { return /^(0[1-5]|1[56]|2[01]|3[05])/.test(g.gn); });
      if (/CHED-D/i.test(text) && !/CHED-P/i.test(text)) decl.type = 'LNV';
      else decl.type = dierlijk ? 'PRD' : 'LNV';
    }
    return decl;
  }

  var exported = { parsePortbase: parsePortbase, mapDocType: mapDocType };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else {
    root.GGB_PARSER = exported;
  }
})(typeof window !== 'undefined' ? window : this);
