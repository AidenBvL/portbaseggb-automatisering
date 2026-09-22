/*
 * Gedeelde weergave (HTML-strings) voor de webapp én de browserextensie.
 * Geen DOM-afhankelijkheden: alle functies geven HTML terug.
 */
(function (root) {
  'use strict';

  var STATUS_LABEL = { ok: 'Compleet', aandacht: 'Controleren', ontbreekt: 'Ontbreekt', fout: 'Fout', info: 'Info' };
  var NIVEAU_LABEL = { verplicht: 'Verplicht', aandacht: 'Ter beoordeling' };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function create(opts) {
    var ENGINE = opts.ENGINE, DOC_TYPES = opts.DOC_TYPES || {}, LANDEN = opts.LANDEN || {};
    var NOMEN = opts.NOMEN || {}, TARIC = opts.TARIC || null;

    function docNaam(code) { return DOC_TYPES[code] ? DOC_TYPES[code].naam : code; }
    function landNaam(code) { code = String(code || '').toUpperCase(); return LANDEN[code] ? code + ' – ' + LANDEN[code] : code; }
    function badge(status) { return '<span class="badge ' + esc(status) + '">' + esc(STATUS_LABEL[status] || status) + '</span>'; }
    function typeNaam(type) { return type === 'LNV' ? 'CHED-D' : 'CHED-P'; }
    function gnDescr(gn) {
      gn = ENGINE.normGn(gn);
      var pad = function (c) { return (c + '0000000000').slice(0, 10); };
      var d = NOMEN[pad(gn)] || NOMEN[pad(gn.slice(0, 8))] || NOMEN[pad(gn.slice(0, 6))] || NOMEN[pad(gn.slice(0, 4))];
      return d ? '<div class="gn-descr">' + esc(gn) + ' · ' + esc(d) + '</div>' : '';
    }

    function renderRequirements(ctx, rules) {
      var r = ENGINE.requirementsFor(ctx, rules);
      var html = '<p><strong>' + esc(typeNaam(ctx.type)) + '</strong> · GN ' + esc(ctx.gn) + (ctx.animo ? ' · Animo ' + esc(ctx.animo) : '') + ' · ' + esc(landNaam(ctx.land)) + '</p>' + gnDescr(ctx.gn);
      r.meldingen.forEach(function (m) { html += '<div class="melding ' + esc(m.niveau) + '">' + esc(m.tekst) + '</div>'; });
      if (!r.vereisten.length) {
        return html + '<div class="melding info">Geen documentvereisten gevonden in de regelbank voor deze combinatie. Dat betekent niet dat er niets nodig is: controleer de NVWA-eisen en voeg zo nodig een regel toe.</div>';
      }
      r.vereisten.forEach(function (v) {
        html += '<div class="req ' + (v.niveau === 'verplicht' ? 'verplicht-info' : 'aandacht') + '">';
        var bronnenChips = r.regels.filter(function (rr) { return v.regelIds.indexOf(rr.id) >= 0; }).map(function (rr) { return rr.bronType === 'taric' ? 'taric' : 'handmatig'; });
        var chips = (bronnenChips.indexOf('taric') >= 0 ? '<span class="src taric">TARIC</span>' : '') + (bronnenChips.indexOf('handmatig') >= 0 ? '<span class="src">handmatig</span>' : '');
        html += '<div class="title">' + esc(docNaam(v.type)) + ' <span class="code">(' + esc(v.type) + ' · Portbase: ' + esc(DOC_TYPES[v.type] ? DOC_TYPES[v.type].portbase : '') + ')</span> <span class="badge ' + (v.niveau === 'verplicht' ? 'verplicht' : 'aandacht') + '">' + esc(NIVEAU_LABEL[v.niveau]) + '</span>' + chips + '</div>';
        html += '<ul>';
        if (v.alternatieven.length) html += '<li>Alternatief: ' + esc(v.alternatieven.map(docNaam).join(' / ')) + '</li>';
        if (v.verwijstNaar) html += '<li>Moet verwijzen naar het ' + esc(docNaam(v.verwijstNaar).toLowerCase()) + '.</li>';
        v.opmerkingen.forEach(function (o) { html += '<li>' + esc(o) + '</li>'; });
        html += '</ul>';
        var bronnen = r.regels.filter(function (rr) { return v.regelIds.indexOf(rr.id) >= 0; }).map(function (rr) { return rr.bron; }).filter(Boolean);
        if (bronnen.length) html += '<div class="bron">Basis: ' + esc(bronnen.join(' · ')) + '</div>';
        html += '</div>';
      });
      html += '<p class="muted">Toegepaste regels: ' + r.regels.map(function (rr) { return '<span class="chip">' + esc(rr.id) + '</span>'; }).join('') + '</p>';
      return html;
    }

    // ---------- TARIC-maatregelen (ruwe douanetariefgegevens) ----------
    function taricMeasuresFor(gn, land) {
      if (!TARIC) return null;
      gn = ENGINE.normGn(gn); land = String(land || '').toUpperCase();
      var out = [];
      Object.keys(TARIC.goederen).forEach(function (key) {
        if (!(key.indexOf(gn) === 0 || gn.indexOf(key) === 0)) return;
        TARIC.goederen[key].forEach(function (idx) {
          var p = TARIC.profielen[idx];
          var groep = TARIC.landengroepen[p.oorsprong];
          var vanToepassing = groep ? (groep.leden.indexOf(land) >= 0 || p.oorsprong === '1011' || p.oorsprong === '1008') : p.oorsprong === land;
          if (!vanToepassing || p.uitgesloten.indexOf(land) >= 0) return;
          var bestaand = out.filter(function (o) { return o.profiel === p; })[0];
          if (bestaand) { if (bestaand.codes.indexOf(key) < 0) bestaand.codes.push(key); return; }
          out.push({ profiel: p, codes: [key], specifieker: key.length > gn.length });
        });
      });
      return out;
    }

    /** HTML met de TARIC-maatregelen voor een GN-code + land; null als TARIC niet geladen is. */
    function renderTaric(ctx, opties) {
      opties = opties || {};
      if (!TARIC) return null;
      var lijst = taricMeasuresFor(ctx.gn, ctx.land);
      var html = opties.zonderOmschrijving ? '' : gnDescr(ctx.gn);
      if (!lijst.length) return html + '<div class="melding info">Geen controlemaatregelen in TARIC gevonden voor GN ' + esc(ctx.gn) + ' uit ' + esc(landNaam(ctx.land)) + ' (binnen de meegenomen maatregeltypen).</div>';
      lijst.forEach(function (o) {
        var p = o.profiel;
        html += '<div class="taric-m"><div class="t">' + esc(p.typeNaam) + ' <span class="muted">(type ' + esc(p.type) + ') · ' + esc(p.oorsprongNaam) + ' · ' + esc(p.basis) + (p.start ? ' · vanaf ' + esc(p.start) : '') + (p.einde ? ' · tot ' + esc(p.einde) : '') + '</span></div>';
        if (o.specifieker) html += '<div class="muted small">Geldt voor onderverdeling(en) ' + esc(o.codes.join(', ')) + ' van de opgegeven code.</div>';
        var certs = [];
        p.voorwaarden.forEach(function (v) { if (v.cert && certs.indexOf(v.cert) < 0) certs.push(v.cert); });
        if (certs.length) {
          html += '<ul>';
          certs.forEach(function (c) {
            var d = TARIC.documentcodes[c] || {};
            html += '<li><span class="cert">' + esc(c) + '</span> ' + esc(d.nl || d.en || '') + '</li>';
          });
          html += '</ul>';
        } else if (p.recht) {
          html += '<div class="muted small">' + esc(p.recht) + '</div>';
        }
        if (p.uitgesloten.length) html += '<div class="muted small">Uitgezonderd: ' + esc(p.uitgesloten.join(', ')) + '</div>';
        html += '</div>';
      });
      if (!opties.zonderVoetnoot) html += '<p class="muted small">Documentcodes met een Y zijn vrijstellings- of "niet van toepassing"-codes; codes met C, N of L zijn aan te leveren certificaten/documenten.</p>';
      return html;
    }

    // ---------- declaratiecontrole ----------
    function renderItemResult(it) {
      var html = '<div class="item"><div class="item-title">GN ' + esc(it.goed.gn || '?') + (it.goed.animo ? ' · Animo ' + esc(it.goed.animo) : '') + ' ' + badge(it.status) + ' <span>' + esc(it.goed.omschrijving || '') + '</span></div>';
      it.meldingen.forEach(function (m) { html += '<div class="melding ' + esc(m.niveau) + '">' + esc(m.tekst) + '</div>'; });
      if (!it.vereisten.length && !it.meldingen.length) html += '<div class="melding info">Geen documentvereisten gevonden.</div>';
      it.vereisten.forEach(function (v) {
        html += '<div class="req ' + esc(v.status) + '"><div class="title">' + badge(v.status) + ' ' + esc(docNaam(v.type)) + ' <span class="code">' + esc(NIVEAU_LABEL[v.niveau]) + (v.documenten.length ? ' · ' + esc(v.documenten.map(function (d) { return d.identificatie || '(geen nummer)'; }).join(', ')) : '') + '</span></div>';
        if (v.tekst.length || v.opmerkingen.length) {
          html += '<ul>';
          v.tekst.forEach(function (t) { html += '<li>' + esc(t) + '</li>'; });
          if (v.status !== 'ok') v.opmerkingen.forEach(function (o) { html += '<li class="muted">' + esc(o) + '</li>'; });
          html += '</ul>';
        }
        html += '</div>';
      });
      return html + '</div>';
    }

    function renderDeclResult(res) {
      var d = res.declaratie;
      var html = '<div class="card ' + esc(res.status) + '"><div class="head"><div><strong>' + esc(d.eigenReferentie || '(zonder referentie)') + '</strong> <span class="muted">· ' + esc(typeNaam(d.type)) + ' · oorsprong ' + esc(landNaam(d.landOorsprong)) + (d.eta ? ' · ETA ' + esc(d.eta) : '') + '</span></div>' + badge(res.status) + '</div>';
      res.meldingen.forEach(function (m) { html += '<div class="melding ' + esc(m.niveau) + '">' + esc(m.tekst) + '</div>'; });
      res.items.forEach(function (it) { html += renderItemResult(it); });
      return html + '</div>';
    }

    return {
      esc: esc, docNaam: docNaam, landNaam: landNaam, badge: badge, typeNaam: typeNaam, gnDescr: gnDescr,
      renderRequirements: renderRequirements, taricMeasuresFor: taricMeasuresFor, renderTaric: renderTaric,
      renderItemResult: renderItemResult, renderDeclResult: renderDeclResult,
      STATUS_LABEL: STATUS_LABEL, NIVEAU_LABEL: NIVEAU_LABEL
    };
  }

  var exported = { create: create, esc: esc, STATUS_LABEL: STATUS_LABEL, NIVEAU_LABEL: NIVEAU_LABEL };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else {
    root.GGB_RENDER = exported;
  }
})(typeof window !== 'undefined' ? window : this);
