/* GUI-logica voor de GGB Documentcheck. Vereist rules.default.js, engine.js en parser.js. */
(function () {
  'use strict';

  var RULES = window.GGB_RULES, ENGINE = window.GGB_ENGINE, PARSER = window.GGB_PARSER;
  var TARIC = window.GGB_TARIC || null;
  var TARIC_RULES = window.GGB_RULES_TARIC || [];
  var NOMEN = window.GGB_NOMENCLATUUR || {};
  var DOC_TYPES = RULES.DOC_TYPES;
  var LANDEN = Object.assign({}, window.GGB_LANDEN || {}, RULES.LANDEN);
  var LS_RULES = 'ggb.regels', LS_DECLS = 'ggb.declaraties', LS_SELECTED = 'ggb.geselecteerd', LS_TARIC = 'ggb.taricAan';

  var STATUS_LABEL = { ok: 'Compleet', aandacht: 'Controleren', ontbreekt: 'Ontbreekt', fout: 'Fout', info: 'Info' };
  var NIVEAU_LABEL = { verplicht: 'Verplicht', aandacht: 'Ter beoordeling' };

  var EXAMPLE_TEXT = [
    'Own reference', '1002002123 - 2026-468',
    'Exporter (I.1)', 'GHAN MARINE PRODUCTS (IN)',
    'Importer (I.6)', 'EUROFOODLINK B.V. (NL)',
    'Country of origin (I.11)', 'IN',
    'Country of loading (I.14)', 'IN',
    'Expected date of arrival (I.10)', '9/26/2026', '7:00 AM',
    'Document(s) (I.9)',
    '#', '1', 'Type', 'Health certificate', 'Identification', 'EIA/VSP/2026-27/02937', 'Date of issue', '07-08-2026',
    '#', '2', 'Type', 'Certified lab report', 'Identification', 'EIA/VZ/26-27/0003572', 'Date of issue', '07-08-2026',
    'Goods item(s)',
    'GN-code (I.31)', '03061792',
    'Animo code (I.31)', '206107 (Visproducten aquacult. en 2-kleppige weekdieren MC, tenzij hermetisch verpakt én ambient)',
    'Goods description (I.31)', 'Garnalen van het geslacht "Penaeus"'
  ].join('\n');

  // ---------- helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  var R = window.GGB_RENDER.create({ ENGINE: ENGINE, DOC_TYPES: DOC_TYPES, LANDEN: LANDEN, NOMEN: NOMEN, TARIC: TARIC });
  var esc = R.esc, docNaam = R.docNaam, landNaam = R.landNaam, badge = R.badge, gnDescr = R.gnDescr;
  var renderItemResult = R.renderItemResult, renderDeclResult = R.renderDeclResult;
  function renderRequirements(ctx) { return R.renderRequirements(ctx, rules); }
  function renderTaric(ctx) {
    var html = R.renderTaric(ctx);
    if (html === null) { $('#taric-result').innerHTML = '<div class="melding aandacht">Geen TARIC-gegevens geladen. Draai <code>python3 sync/run.py</code> om de kennisbank op te halen.</div>'; return; }
    $('#taric-card-sub').textContent = '· extractie ' + (TARIC.extractieDatum || TARIC.gegenereerd);
    $('#taric-result').innerHTML = html;
  }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function load(key, fallback) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* opslag niet beschikbaar */ } }

  // ---------- state ----------
  var manualRules = load(LS_RULES, null) || RULES.DEFAULT_RULES;
  var taricEnabled = load(LS_TARIC, true) !== false && TARIC_RULES.length > 0;
  var rules = [];
  function rebuildRules() { rules = manualRules.concat(taricEnabled ? TARIC_RULES : []); }
  rebuildRules();

  var decls = load(LS_DECLS, []);
  var selectedId = load(LS_SELECTED, null);
  var lastResults = {};

  // ---------- tabs ----------
  $$('.tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.tab').forEach(function (b) { b.classList.toggle('active', b === btn); });
      $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab); });
    });
  });

  // ---------- landenlijst ----------
  var dl = $('#landen-list');
  Object.keys(LANDEN).sort().forEach(function (c) { var o = document.createElement('option'); o.value = c; o.label = LANDEN[c]; dl.appendChild(o); });
  $('#rules-version').textContent = RULES.VERSIE;
  if (TARIC) $('#taric-version').textContent = 'TARIC-extractie ' + (TARIC.extractieDatum || TARIC.gegenereerd) + ' (' + TARIC_RULES.length + ' automatische regels)';

  $('#lookup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var ctx = { type: f.type.value, gn: f.gn.value, animo: f.animo.value, land: f.land.value };
    $('#lookup-result').innerHTML = renderRequirements(ctx);
    renderTaric(ctx);
  });
  $('#lookup-example').addEventListener('click', function () {
    var f = $('#lookup-form');
    f.type.value = 'PRD'; f.gn.value = '03061792'; f.animo.value = '206107'; f.land.value = 'IN';
    f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true }));
  });

  $('#bulk-run').addEventListener('click', function () {
    var lines = $('#bulk-input').value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) { $('#bulk-result').innerHTML = '<div class="melding aandacht">Geen regels ingevoerd.</div>'; return; }
    var html = '<table class="summary-table"><thead><tr><th>Type</th><th>GN</th><th>Animo</th><th>Land</th><th>Vereiste documenten</th></tr></thead><tbody>';
    lines.forEach(function (l) {
      var p = l.split(/[;,\t]/).map(function (s) { return s.trim(); });
      if (p.length === 3) p = [''].concat(p);
      var ctx = { type: p[0] || 'PRD', gn: p[1] || '', animo: p[2] || '', land: p[3] || '' };
      var r = ENGINE.requirementsFor(ctx, rules);
      var docs = r.vereisten.map(function (v) {
        return '<span class="badge ' + (v.niveau === 'verplicht' ? 'verplicht' : 'aandacht') + '">' + esc(NIVEAU_LABEL[v.niveau]) + '</span> ' + esc(docNaam(v.type)) + (v.verwijstNaar ? ' <span class="muted">(verwijst naar ' + esc(v.verwijstNaar) + ')</span>' : '');
      }).concat(r.meldingen.map(function (m) { return '<span class="badge ' + esc(m.niveau) + '">' + esc(STATUS_LABEL[m.niveau] || m.niveau) + '</span> ' + esc(m.tekst); })).join('<br>') || '<span class="muted">geen regels gevonden</span>';
      html += '<tr><td>' + esc(ctx.type) + '</td><td>' + esc(ctx.gn) + '</td><td>' + esc(ctx.animo) + '</td><td>' + esc(landNaam(ctx.land)) + '</td><td>' + docs + '</td></tr>';
    });
    $('#bulk-result').innerHTML = html + '</tbody></table>';
  });

  // ---------- declaraties ----------
  function persist() { save(LS_DECLS, decls); save(LS_SELECTED, selectedId); }
  function selected() { return decls.filter(function (d) { return d.id === selectedId; })[0] || null; }
  function newDecl(base) {
    var d = base || { type: 'PRD', eigenReferentie: '', landOorsprong: '', landLading: '', eta: '', documenten: [], goederen: [] };
    d.id = uid();
    if (!d.documenten.length) d.documenten.push({ type: 'HC', identificatie: '', datum: '', verwijstNaar: '' });
    if (!d.goederen.length) d.goederen.push({ gn: '', animo: '', omschrijving: '' });
    decls.push(d);
    return d;
  }

  function renderList() {
    var ul = $('#decl-list');
    ul.innerHTML = '';
    if (!decls.length) { ul.innerHTML = '<li class="muted" style="cursor:default">Nog geen declaraties.</li>'; return; }
    decls.forEach(function (d) {
      var li = document.createElement('li');
      li.className = d.id === selectedId ? 'selected' : '';
      var res = lastResults[d.id];
      li.innerHTML = '<div><div class="ref">' + esc(d.eigenReferentie || '(zonder referentie)') + '</div><div class="sub">' + esc(d.type === 'LNV' ? 'CHED-D' : 'CHED-P') + ' · ' + esc(d.landOorsprong || '?') + ' · ' + d.goederen.length + ' item(s)</div></div>' + (res ? badge(res.status) : '');
      li.addEventListener('click', function () { selectedId = d.id; persist(); renderList(); renderEditor(); renderResult(); });
      ul.appendChild(li);
    });
  }

  function renderEditor() {
    var d = selected();
    var form = $('#decl-form');
    $('#decl-empty').classList.toggle('hidden', !!d);
    form.classList.toggle('hidden', !d);
    if (!d) return;
    form.eigenReferentie.value = d.eigenReferentie || '';
    form.type.value = d.type || 'PRD';
    form.landOorsprong.value = d.landOorsprong || '';
    form.landLading.value = d.landLading || '';
    form.eta.value = d.eta || '';

    var tb = $('#doc-table tbody'); tb.innerHTML = '';
    d.documenten.forEach(function (doc, i) {
      var tr = document.createElement('tr');
      var opts = Object.keys(DOC_TYPES).map(function (k) { return '<option value="' + k + '"' + (doc.type === k ? ' selected' : '') + '>' + esc(DOC_TYPES[k].naam) + '</option>'; }).join('');
      tr.innerHTML = '<td class="num">' + (i + 1) + '</td><td><select data-f="type">' + opts + '</select></td>' +
        '<td><input data-f="identificatie" value="' + esc(doc.identificatie) + '" placeholder="nummer"></td>' +
        '<td><input data-f="datum" value="' + esc(doc.datum) + '" placeholder="dd-mm-jjjj"></td>' +
        '<td><input data-f="verwijstNaar" value="' + esc(doc.verwijstNaar || '') + '" placeholder="certificaatnr. (indien van toepassing)"></td>' +
        '<td class="del"><button type="button" title="Verwijderen">×</button></td>';
      $$('[data-f]', tr).forEach(function (el) { el.addEventListener('input', function () { doc[el.dataset.f] = el.value; persist(); }); });
      $('button', tr).addEventListener('click', function () { d.documenten.splice(i, 1); persist(); renderEditor(); });
      tb.appendChild(tr);
    });

    var gb = $('#goods-table tbody'); gb.innerHTML = '';
    d.goederen.forEach(function (g, i) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="num">' + (i + 1) + '</td><td><input data-f="gn" value="' + esc(g.gn) + '" placeholder="03061792"></td>' +
        '<td><input data-f="animo" value="' + esc(g.animo) + '" placeholder="206107"></td>' +
        '<td><input data-f="omschrijving" value="' + esc(g.omschrijving) + '" placeholder="omschrijving"></td>' +
        '<td class="del"><button type="button" title="Verwijderen">×</button></td>';
      $$('[data-f]', tr).forEach(function (el) { el.addEventListener('input', function () { g[el.dataset.f] = el.value; persist(); }); });
      $('button', tr).addEventListener('click', function () { d.goederen.splice(i, 1); persist(); renderEditor(); });
      gb.appendChild(tr);
    });
  }

  ['eigenReferentie', 'type', 'landOorsprong', 'landLading', 'eta'].forEach(function (f) {
    $('#decl-form').elements[f].addEventListener('input', function (e) {
      var d = selected(); if (!d) return;
      d[f] = e.target.value; persist(); renderList();
    });
  });
  $('#doc-add').addEventListener('click', function () { var d = selected(); if (!d) return; d.documenten.push({ type: 'LAB', identificatie: '', datum: '', verwijstNaar: '' }); persist(); renderEditor(); });
  $('#goods-add').addEventListener('click', function () { var d = selected(); if (!d) return; d.goederen.push({ gn: '', animo: '', omschrijving: '' }); persist(); renderEditor(); });
  $('#decl-new').addEventListener('click', function () { selectedId = newDecl().id; persist(); renderList(); renderEditor(); renderResult(); });
  $('#decl-delete').addEventListener('click', function () {
    var d = selected(); if (!d) return;
    if (!confirm('Declaratie "' + (d.eigenReferentie || 'zonder referentie') + '" verwijderen?')) return;
    decls = decls.filter(function (x) { return x.id !== d.id; });
    delete lastResults[d.id];
    selectedId = decls.length ? decls[0].id : null;
    persist(); renderList(); renderEditor(); renderResult();
  });
  $('#decl-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var d = selected(); if (!d) return;
    lastResults[d.id] = ENGINE.checkDeclaration(d, rules);
    renderList(); renderResult();
  });
  $('#decl-check-all').addEventListener('click', function () {
    decls.forEach(function (d) { lastResults[d.id] = ENGINE.checkDeclaration(d, rules); });
    renderList(); renderResult(true);
  });

  // plakken uit Portbase
  $('#decl-paste-toggle').addEventListener('click', function () { $('#paste-box').classList.toggle('hidden'); });
  $('#paste-example').addEventListener('click', function () { $('#paste-input').value = EXAMPLE_TEXT; $('#paste-box').classList.remove('hidden'); });
  $('#paste-import').addEventListener('click', function () {
    var text = $('#paste-input').value;
    var parts = text.split(/^\s*-{3,}\s*$/m).map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) { alert('Plak eerst de tekst van een Portbase-declaratie.'); return; }
    var laatste = null, aantal = 0;
    parts.forEach(function (p) {
      var parsed = PARSER.parsePortbase(p);
      if (!parsed.goederen.length && !parsed.documenten.length && !parsed.landOorsprong) return;
      laatste = newDecl(parsed);
      lastResults[laatste.id] = ENGINE.checkDeclaration(laatste, rules);
      aantal++;
    });
    if (!aantal) { alert('Geen declaratiegegevens herkend in de geplakte tekst. Kopieer het volledige declaratie-overzicht uit Portbase.'); return; }
    selectedId = laatste.id;
    $('#paste-input').value = '';
    persist(); renderList(); renderEditor(); renderResult(aantal > 1);
  });

  function renderResult(all) {
    var box = $('#decl-result');
    box.className = 'decl-result';
    var lijst = all ? decls : (selected() ? [selected()] : []);
    var html = '';
    if (all && decls.length) {
      html += '<div class="card"><h2>Overzicht</h2><table class="summary-table"><thead><tr><th>Referentie</th><th>Type</th><th>Oorsprong</th><th>Status</th><th>Ontbrekend / te controleren</th></tr></thead><tbody>';
      decls.forEach(function (d) {
        var r = lastResults[d.id]; if (!r) return;
        var open = [];
        r.items.forEach(function (it) { it.vereisten.forEach(function (v) { if (v.status !== 'ok') open.push(docNaam(v.type) + ' (' + STATUS_LABEL[v.status] + ')'); }); });
        html += '<tr><td>' + esc(d.eigenReferentie || '(zonder referentie)') + '</td><td>' + esc(d.type === 'LNV' ? 'CHED-D' : 'CHED-P') + '</td><td>' + esc(d.landOorsprong) + '</td><td>' + badge(r.status) + '</td><td>' + (open.length ? esc(open.join(', ')) : '<span class="muted">–</span>') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    lijst.forEach(function (d) { if (lastResults[d.id]) html += renderDeclResult(lastResults[d.id]); });
    box.innerHTML = html;
  }

  // ---------- regels ----------
  function renderRulesTable() {
    var html = '<table class="rules-table"><thead><tr><th>Regel</th><th>Type</th><th>GN-codes</th><th>Animo</th><th>Landen</th><th>Documenten</th><th>Basis</th></tr></thead><tbody>';
    var chips = function (v, excl) {
      var s = v === '*' || v === undefined ? '<span class="chip">*</span>' : (v || []).map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
      if (excl && excl.length) s += '<br><span class="muted">behalve</span> ' + excl.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
      return s;
    };
    manualRules.forEach(function (r) { html += ruleRow(r, chips); });
    $('#rules-table').innerHTML = html + '</tbody></table>';
    $('#rules-json').value = JSON.stringify(manualRules, null, 2);
    renderTaricRules(chips);
    renderBronnen();
  }

  function ruleRow(r, chips) {
    var gnCell = Array.isArray(r.gn) && r.gn.length > 12 ? chips(r.gn.slice(0, 12)) + '<span class="muted">… +' + (r.gn.length - 12) + '</span>' : chips(r.gn, r.gnExclude);
    var landCell = Array.isArray(r.landen) && r.landen.length > 12 ? '<span class="muted">' + r.landen.length + ' landen</span>' : chips(r.landen, r.landenExclude);
    return '<tr><td><strong>' + esc(r.naam) + '</strong><br><span class="muted">' + esc(r.id) + '</span></td><td>' + esc(r.type || '*') + '</td><td>' + gnCell + '</td><td>' + chips(r.animo, r.animoExclude) + '</td><td>' + landCell + '</td><td>' +
      (r.documenten || []).map(function (d) { return '<span class="badge ' + (d.niveau === 'verplicht' ? 'verplicht' : 'aandacht') + '">' + esc(NIVEAU_LABEL[d.niveau] || d.niveau) + '</span> ' + esc(docNaam(d.type)) + (d.alternatieven && d.alternatieven.length ? ' <span class="muted">of ' + esc(d.alternatieven.map(docNaam).join(' / ')) + '</span>' : '') + (d.verwijstNaar ? ' <span class="muted">→ verwijst naar ' + esc(d.verwijstNaar) + '</span>' : ''); })
        .concat((r.meldingen || []).map(function (m) { return '<span class="badge ' + esc(m.niveau) + '">' + esc(STATUS_LABEL[m.niveau] || m.niveau) + '</span> ' + esc(m.tekst); })).join('<br>') +
      '</td><td class="muted">' + esc(r.bron || '') + '</td></tr>';
  }

  var chipsFn = function (v, excl) {
    var s = v === '*' || v === undefined ? '<span class="chip">*</span>' : (v || []).map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
    if (excl && excl.length) s += '<br><span class="muted">behalve</span> ' + excl.map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
    return s;
  };

  function renderTaricRules() {
    var q = ($('#taric-rules-filter').value || '').trim().toUpperCase();
    var lijst = TARIC_RULES.filter(function (r) {
      if (!q) return true;
      var tekst = (r.naam + ' ' + r.id + ' ' + r.bron + ' ' + (r.documenten || []).map(function (d) { return d.type; }).join(' ')).toUpperCase();
      return tekst.indexOf(q) >= 0 || (Array.isArray(r.gn) && r.gn.some(function (g) { return g.indexOf(q) === 0 || q.indexOf(g) === 0; })) || (Array.isArray(r.landen) && r.landen.indexOf(q) >= 0);
    });
    $('#taric-rules-count').textContent = '· ' + lijst.length + (q ? ' van ' + TARIC_RULES.length : '') + ' regels';
    if (!TARIC_RULES.length) { $('#taric-rules-table').innerHTML = '<div class="melding aandacht">Geen TARIC-regels geladen (data/rules.taric.js ontbreekt). Draai <code>python3 sync/run.py</code>.</div>'; return; }
    var html = '<table class="rules-table"><thead><tr><th>Regel</th><th>Type</th><th>GN-codes</th><th>Animo</th><th>Landen</th><th>Documenten / meldingen</th><th>Basis</th></tr></thead><tbody>';
    lijst.slice(0, 200).forEach(function (r) { html += ruleRow(r, chipsFn); });
    if (lijst.length > 200) html += '<tr><td colspan="7" class="muted">… ' + (lijst.length - 200) + ' meer; gebruik het filter.</td></tr>';
    $('#taric-rules-table').innerHTML = html + '</tbody></table>';
  }

  function renderBronnen() {
    var rows = [
      ['Handmatige regels', RULES.DEFAULT_RULES.length + ' standaard (versie ' + RULES.VERSIE + ')' + (load(LS_RULES, null) ? ', aangepast in deze browser: ' + manualRules.length : '')],
      ['EU douanetarief (TARIC)', TARIC ? esc(TARIC.bron) + ' · extractie ' + esc(TARIC.extractieDatum || '?') + ' · gegenereerd ' + esc(TARIC.gegenereerd) + ' · ' + Object.keys(TARIC.goederen).length + ' goederencodes, ' + TARIC.profielen.length + ' maatregelprofielen, ' + TARIC_RULES.length + ' afgeleide regels' : '<span class="badge aandacht">niet geladen</span>'],
      ['Landnamen', window.GGB_LANDEN ? Object.keys(window.GGB_LANDEN).length + ' landen uit TARIC (NL)' : 'ingebouwde lijst'],
      ['Goederenomschrijvingen', Object.keys(NOMEN).length + ' codes (TARIC-nomenclatuur, EN)'],
      ['Bijwerken', 'Lokaal: <code>python3 sync/run.py</code>. Automatisch: GitHub-workflow <code>sync-kennisbank.yml</code> (maandelijks). Officiële bron: CIRCABC (DG TAXUD); mirror: GitHub rousseauxy/taric-opendata.'],
      ['Niet automatiseerbaar', 'NVWA-specifieke eisen (o.a. analyseverslagen per land, verwijzing naar certificaat) en IVO/TRACES-gegevens: geen publieke API. Deze blijven in de handmatige regels.']
    ];
    $('#bronnen').innerHTML = rows.map(function (r) { return '<div class="bron-row"><span class="k">' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('');
    $('#taric-enabled').checked = taricEnabled;
    $('#taric-enabled').disabled = !TARIC_RULES.length;
  }

  $('#taric-rules-filter').addEventListener('input', function () { renderTaricRules(); });
  $('#taric-enabled').addEventListener('change', function (e) { taricEnabled = e.target.checked; save(LS_TARIC, taricEnabled); rebuildRules(); renderBronnen(); });

  $('#rules-save').addEventListener('click', function () {
    var parsed;
    try { parsed = JSON.parse($('#rules-json').value); } catch (e) { $('#rules-errors').textContent = 'Ongeldige JSON: ' + e.message; return; }
    var errs = ENGINE.validateRules(parsed);
    if (errs.length) { $('#rules-errors').textContent = errs.join('\n'); return; }
    manualRules = parsed; save(LS_RULES, manualRules); rebuildRules();
    $('#rules-errors').textContent = '';
    renderRulesTable();
    alert('Regels opgeslagen (' + manualRules.length + ' handmatige regels).');
  });
  $('#rules-reset').addEventListener('click', function () {
    if (!confirm('Eigen aanpassingen weggooien en de standaardregels herstellen?')) return;
    manualRules = RULES.DEFAULT_RULES; rebuildRules(); try { localStorage.removeItem(LS_RULES); } catch (e) { /* negeren */ }
    $('#rules-errors').textContent = '';
    renderRulesTable();
  });
  $('#rules-export').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(manualRules, null, 2)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ggb-regels.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('#rules-import').addEventListener('change', function (e) {
    var file = e.target.files[0]; if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { $('#rules-json').value = reader.result; $('#rules-save').click(); };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---------- init ----------
  renderRulesTable();
  renderList();
  renderEditor();
  renderResult();

  // Vanuit de browserextensie: declaratie die op de Portbase-pagina is uitgelezen importeren.
  if (location.hash === '#import' && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get('ggb.import', function (res) {
      var d = res && res['ggb.import'];
      if (!d) return;
      chrome.storage.local.remove('ggb.import');
      var bestaand = decls.filter(function (x) { return x.bron === 'portbase' && x.portbaseId && x.portbaseId === d.portbaseId; })[0];
      if (bestaand) { decls = decls.filter(function (x) { return x !== bestaand; }); }
      var nieuw = newDecl(d);
      lastResults[nieuw.id] = ENGINE.checkDeclaration(nieuw, rules);
      selectedId = nieuw.id;
      persist(); renderList(); renderEditor(); renderResult();
      $$('.tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === 'declaraties'); });
      $$('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'tab-declaraties'); });
      history.replaceState(null, '', location.pathname);
    });
  }
})();
