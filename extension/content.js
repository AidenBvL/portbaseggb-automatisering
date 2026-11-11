/*
 * Content script voor de Portbase-pagina. Zwevend paneel (Shadow DOM, zodat de
 * CSS van Portbase en van het paneel elkaar niet raken) met twee tabbladen:
 *
 *  - Documentcheck: leest de declaratie uit de DOM en toont welke documenten
 *    vereist zijn / ontbreken.
 *  - AI invullen: HC en andere documenten uploaden, laten uitlezen door Claude
 *    (via de service worker), het voorstel controleren/corrigeren, de
 *    documentcheck erop draaien en het formulier "New declaration" invullen.
 */
(function () {
  'use strict';
  if (window.__ggbPanelLoaded) return;
  window.__ggbPanelLoaded = true;

  var ENGINE = window.GGB_ENGINE, RULES = window.GGB_RULES, PORTBASE = window.GGB_PORTBASE, RENDER = window.GGB_RENDER;
  var AI = window.GGB_AI, FILL = window.GGB_FILL;
  var data = null, R = null, rules = RULES.DEFAULT_RULES;
  var host, shadow, body, statusEl, lastFp = '', collapsed = false, timer = null, lastDecl = null, tab = 'check';

  // AI-toestand
  var bestanden = [];       // File-objecten
  var aiResultaat = null;   // genormaliseerd voorstel (bewerkbaar)
  var aiBezig = false;

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.wrap{position:fixed;right:16px;bottom:16px;width:480px;max-height:min(85vh,920px);display:flex;flex-direction:column;background:#fff;color:#1c2430;border:1px solid #d9dee6;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);font:13px/1.45 "Segoe UI",system-ui,sans-serif;z-index:2147483000;overflow:hidden}',
    '.wrap.collapsed{width:auto;max-height:none}.wrap.collapsed .body,.wrap.collapsed .foot,.wrap.collapsed .tabs{display:none}',
    '.head{display:flex;align-items:center;gap:.5rem;padding:.55rem .75rem;background:#0b5fa5;color:#fff;cursor:pointer;user-select:none}',
    '.head .logo{background:#fff;color:#0b5fa5;font-weight:700;border-radius:5px;padding:.05rem .35rem;font-size:.75rem}',
    '.head .title{font-weight:600;flex:1}.head button{background:transparent;border:1px solid rgba(255,255,255,.6);color:#fff;border-radius:5px;padding:.15rem .5rem;font:inherit;cursor:pointer}.head button:hover{background:rgba(255,255,255,.15)}',
    '.tabs{display:flex;border-bottom:1px solid #d9dee6;background:#f6f8fb}.tabs button{flex:1;border:0;background:none;padding:.45rem;font:inherit;cursor:pointer;color:#5f6b7a;border-bottom:2px solid transparent}.tabs button.active{color:#0b5fa5;border-bottom-color:#0b5fa5;font-weight:600}',
    '.body{overflow:auto;padding:.75rem;flex:1}.body[hidden]{display:none}.foot{padding:.5rem .75rem;border-top:1px solid #d9dee6;display:flex;gap:.5rem;justify-content:space-between;align-items:center;font-size:.75rem;color:#5f6b7a}',
    'button.btn,.foot button{font:inherit;padding:.3rem .6rem;border-radius:5px;border:1px solid #d9dee6;background:#fff;cursor:pointer}button.primary,.foot button.primary{background:#0b5fa5;border-color:#0b5fa5;color:#fff}button:disabled{opacity:.5;cursor:default}',
    '.muted{color:#5f6b7a}.small{font-size:.8rem}p{margin:.25rem 0 .6rem}ul{margin:.3rem 0 0;padding-left:1.2rem}h3{font-size:.9rem;margin:.9rem 0 .4rem}',
    '.badge{display:inline-block;font-size:.68rem;font-weight:600;padding:.1rem .45rem;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;vertical-align:middle;white-space:nowrap}',
    '.badge.ok,.badge.ingevuld,.badge.hoog{background:#e6f4ec;color:#157347}.badge.aandacht,.badge.handmatig,.badge.middel{background:#fff4e0;color:#b26a00}.badge.ontbreekt,.badge.fout,.badge.verplicht,.badge.laag{background:#fde8e6;color:#b42318}.badge.info,.badge.overgeslagen{background:#e8f1fa;color:#0b5fa5}.badge.niet-gevonden{background:#eef1f5;color:#5f6b7a}',
    '.melding{padding:.4rem .6rem;border-radius:6px;font-size:.85rem;margin-bottom:.35rem}.melding.info{background:#e8f1fa;color:#0b5fa5}.melding.aandacht{background:#fff4e0;color:#b26a00}.melding.ontbreekt,.melding.fout{background:#fde8e6;color:#b42318}',
    '.card{border-left:5px solid #d9dee6;padding-left:.6rem}.card.ok{border-left-color:#157347}.card.aandacht{border-left-color:#b26a00}.card.ontbreekt,.card.fout{border-left-color:#b42318}',
    '.card .head{background:none;color:inherit;padding:0 0 .4rem;cursor:default;display:flex;justify-content:space-between;gap:.5rem}',
    '.item{border-top:1px solid #d9dee6;padding-top:.5rem;margin-top:.5rem}.item-title{font-weight:600;margin-bottom:.35rem}.item-title span{font-weight:400;color:#5f6b7a}',
    '.req{border:1px solid #d9dee6;border-left-width:4px;border-radius:6px;padding:.45rem .6rem;margin-bottom:.4rem;font-size:.85rem}.req.ok{border-left-color:#157347}.req.aandacht{border-left-color:#b26a00}.req.ontbreekt,.req.fout{border-left-color:#b42318}.req.verplicht-info{border-left-color:#0b5fa5}',
    '.req .title{font-weight:600}.req .title .code{font-weight:400;color:#5f6b7a;font-size:.78rem}.req ul{font-size:.82rem}.req .bron{font-size:.75rem;color:#5f6b7a;margin-top:.25rem}',
    '.src{display:inline-block;font-size:.65rem;padding:0 .35rem;border-radius:4px;border:1px solid #d9dee6;color:#5f6b7a;margin-left:.25rem;vertical-align:middle}.src.taric{border-color:#b7cde3;color:#0b5fa5;background:#f0f6fc}',
    '.chip{display:inline-block;background:#eef1f5;border-radius:4px;padding:0 .35em;margin:0 .15em .15em 0;font-family:ui-monospace,Consolas,monospace;font-size:.72rem}',
    'details{margin-top:.5rem}summary{cursor:pointer;font-weight:600;font-size:.85rem;color:#0b5fa5}',
    '.taric-m{border:1px solid #d9dee6;border-radius:6px;padding:.4rem .6rem;margin:.4rem 0;font-size:.82rem}.taric-m .t{font-weight:600}.taric-m .t .muted{font-weight:400}.cert{font-family:ui-monospace,Consolas,monospace;background:#eef1f5;padding:0 .3em;border-radius:3px}',
    '.gn-descr{font-size:.82rem;color:#5f6b7a;margin-bottom:.4rem}',
    '.empty{padding:.5rem 0;color:#5f6b7a}',
    '.drop{border:2px dashed #b7cde3;border-radius:8px;padding:.8rem;text-align:center;color:#5f6b7a;background:#f6f8fb}.drop.over{background:#e8f1fa;border-color:#0b5fa5}.drop label{color:#0b5fa5;cursor:pointer;text-decoration:underline}.drop input{display:none}',
    '.files{list-style:none;padding:0;margin:.5rem 0}.files li{display:flex;justify-content:space-between;gap:.5rem;padding:.2rem 0;border-bottom:1px solid #eef1f5;font-size:.82rem}.files button{border:0;background:none;color:#b42318;cursor:pointer;font:inherit}',
    'textarea{width:100%;min-height:3.2em;font:inherit;padding:.35rem;border:1px solid #d9dee6;border-radius:5px;resize:vertical}',
    '.row-actions{display:flex;gap:.5rem;align-items:center;margin:.5rem 0;flex-wrap:wrap}',
    'table.velden{width:100%;border-collapse:collapse;font-size:.82rem}table.velden td{padding:.18rem .25rem;border-bottom:1px solid #eef1f5;vertical-align:middle}table.velden td.l{color:#5f6b7a;width:42%}table.velden td.z{width:1%;text-align:right}',
    'table.velden input{width:100%;font:inherit;padding:.15rem .3rem;border:1px solid #d9dee6;border-radius:4px}table.velden input:focus{border-color:#0b5fa5;outline:none}',
    '.groep{border:1px solid #d9dee6;border-radius:6px;padding:.35rem .5rem;margin:.4rem 0}.groep .gt{font-weight:600;font-size:.82rem;margin-bottom:.2rem}',
    '.verslag li{font-size:.82rem;margin:.15rem 0;list-style:none}.verslag{padding:0}.verslag button{font:inherit;font-size:.72rem;padding:0 .35rem;margin-left:.3rem;border:1px solid #d9dee6;border-radius:4px;background:#fff;cursor:pointer}',
    '.spinner{display:inline-block;width:12px;height:12px;border:2px solid #b7cde3;border-top-color:#0b5fa5;border-radius:50%;animation:sp 0.8s linear infinite;vertical-align:middle}@keyframes sp{to{transform:rotate(360deg)}}'
  ].join('\n');

  function esc(s) { return RENDER.esc(s); }
  function $(id) { return shadow.getElementById(id); }

  function buildPanel() {
    host = document.createElement('div');
    host.id = 'ggb-documentcheck-host';
    shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<div class="head" id="head"><span class="logo">GGB</span><span class="title">GGB-assistent</span><span id="status"></span><button id="toggle" title="In-/uitklappen">–</button></div>' +
      '<div class="tabs"><button id="tab-check" class="active">Documentcheck</button><button id="tab-ai">AI invullen</button></div>' +
      '<div class="body" id="body"><div class="empty">Open een declaratie om de documentcheck te zien.</div></div>' +
      '<div class="body" id="ai-body" hidden>' + aiHtml() + '</div>' +
      '<div class="foot"><span id="foot-info"></span><span><button id="refresh">Vernieuwen</button> <button id="open" class="primary">Openen in tool</button></span></div>';
    shadow.appendChild(wrap);
    body = $('body');
    statusEl = $('status');
    $('toggle').addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(!collapsed); });
    $('head').addEventListener('click', function () { if (collapsed) setCollapsed(false); });
    $('refresh').addEventListener('click', function () { lastFp = ''; refresh(true); });
    $('open').addEventListener('click', function () {
      if (!lastDecl) return;
      chrome.runtime.sendMessage({ type: 'ggb:openTool', declaratie: lastDecl });
    });
    $('tab-check').addEventListener('click', function () { setTab('check'); });
    $('tab-ai').addEventListener('click', function () { setTab('ai'); });
    bindAi();
    (document.body || document.documentElement).appendChild(host);
    try {
      setCollapsed(localStorage.getItem('ggb.panel.collapsed') === '1');
      if (localStorage.getItem('ggb.panel.tab') === 'ai') setTab('ai');
    } catch (e) { /* negeren */ }
  }

  function setTab(t) {
    tab = t;
    $('tab-check').classList.toggle('active', t === 'check');
    $('tab-ai').classList.toggle('active', t === 'ai');
    $('body').hidden = t !== 'check';
    $('ai-body').hidden = t !== 'ai';
    $('refresh').hidden = t !== 'check';
    $('open').hidden = t !== 'check';
    if (t === 'ai') updateFillKnop();
    try { localStorage.setItem('ggb.panel.tab', t); } catch (e) { /* negeren */ }
  }

  function setCollapsed(v) {
    collapsed = v;
    shadow.querySelector('.wrap').classList.toggle('collapsed', v);
    $('toggle').textContent = v ? '+' : '–';
    try { localStorage.setItem('ggb.panel.collapsed', v ? '1' : '0'); } catch (e) { /* negeren */ }
  }

  /* ======================= Documentcheck ======================= */

  function render(decl) {
    lastDecl = decl;
    if (!decl) {
      body.innerHTML = '<div class="empty">Open een declaratie (Details) om de documentcheck te zien.</div>';
      statusEl.innerHTML = '';
      return;
    }
    var res = ENGINE.checkDeclaration(decl, rules);
    statusEl.innerHTML = R.badge(res.status);
    var html = R.renderDeclResult(res);
    if (data && data.taric) {
      decl.goederen.forEach(function (g) {
        var t = R.renderTaric({ gn: g.gn, land: decl.landOorsprong }, { zonderVoetnoot: true });
        if (t) html += '<details><summary>Douanetarief (TARIC) voor GN ' + esc(g.gn) + '</summary>' + t + '</details>';
      });
    }
    if (!decl.goederen.length) html += '<div class="melding aandacht">Geen goederenitems gevonden op de pagina. Is de declaratie volledig geladen?</div>';
    body.innerHTML = html;
  }

  function refresh(force) {
    if (tab === 'ai') updateFillKnop();
    var decl = PORTBASE.extractDeclaration(document);
    var fp = PORTBASE.fingerprint(decl);
    if (!force && fp === lastFp) return;
    lastFp = fp;
    render(decl);
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; refresh(false); }, 600);
  }

  /* ======================= AI invullen ======================= */

  function aiHtml() {
    return '' +
      '<p class="small muted">Upload het gezondheidscertificaat (HC) en eventueel labrapport, factuur, paklijst en B/L. Claude leest ze uit, bepaalt de GGB-gegevens en welke documenten nodig zijn. Controleer het voorstel altijd voordat je invult en verstuurt.</p>' +
      '<div class="drop" id="drop">Sleep bestanden hierheen of <label>kies bestanden<input type="file" id="file" multiple accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"></label><div class="small">PDF, JPG, PNG of WEBP</div></div>' +
      '<ul class="files" id="files"></ul>' +
      '<textarea id="ctx" placeholder="Extra info voor de AI (optioneel), bijv. ETA 26-09-2026 07:00, grenscontrolepost Rotterdam, B/L-nummer…"></textarea>' +
      '<div class="row-actions"><button class="btn primary" id="ai-run" disabled>Uitlezen met AI</button><span id="ai-status" class="small muted"></span></div>' +
      '<div id="ai-result"></div>';
  }

  function bindAi() {
    var drop = $('drop');
    $('file').addEventListener('change', function (e) { voegToe(e.target.files); e.target.value = ''; });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); voegToe(e.dataTransfer.files); });
    $('files').addEventListener('click', function (e) {
      var i = e.target.getAttribute && e.target.getAttribute('data-del');
      if (i != null) { bestanden.splice(+i, 1); renderBestanden(); }
    });
    $('ai-run').addEventListener('click', aiUitlezen);
    var res = $('ai-result');
    res.addEventListener('input', function (e) {
      var p = e.target.getAttribute && e.target.getAttribute('data-pad');
      if (p) zetPad(aiResultaat, p, e.target.value);
    });
    res.addEventListener('change', function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-pad')) renderAiCheck();
    });
    res.addEventListener('click', function (e) {
      var t = e.target;
      if (t.id === 'ai-fill') aiInvullen();
      var kopie = t.getAttribute && t.getAttribute('data-kopie');
      if (kopie != null) {
        navigator.clipboard.writeText(kopie).then(function () { t.textContent = 'Gekopieerd'; }, function () { t.textContent = 'Mislukt'; });
      }
    });
  }

  var TOEGESTAAN = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  function voegToe(lijst) {
    Array.prototype.forEach.call(lijst || [], function (f) {
      if (TOEGESTAAN.indexOf(f.type) < 0) { zetStatus('Bestandstype van ' + f.name + ' wordt niet ondersteund.'); return; }
      if (!bestanden.some(function (b) { return b.name === f.name && b.size === f.size; })) bestanden.push(f);
    });
    renderBestanden();
  }

  function mb(n) { return (n / 1048576).toFixed(n < 1048576 ? 2 : 1) + ' MB'; }

  function renderBestanden() {
    var totaal = bestanden.reduce(function (s, f) { return s + f.size; }, 0);
    $('files').innerHTML = bestanden.map(function (f, i) {
      return '<li><span>' + esc(f.name) + ' <span class="muted">(' + mb(f.size) + ')</span></span><button data-del="' + i + '" title="Verwijderen">✕</button></li>';
    }).join('') + (totaal > 24 * 1048576 ? '<li class="melding aandacht">Samen ' + mb(totaal) + ': te groot voor één verzoek (max. ±24 MB). Laat grote bijlagen weg of comprimeer ze.</li>' : '');
    $('ai-run').disabled = aiBezig || !bestanden.length || totaal > 24 * 1048576;
  }

  function zetStatus(html, bezig) {
    $('ai-status').innerHTML = (bezig ? '<span class="spinner"></span> ' : '') + html;
  }

  function leesBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(file);
    });
  }

  /** Stuurt de documenten via een lange verbinding naar de service worker (houdt die actief). */
  function vraagAi(payload) {
    return new Promise(function (resolve, reject) {
      var port = chrome.runtime.connect({ name: 'ggb-ai' });
      var ping = setInterval(function () { try { port.postMessage({ type: 'ping' }); } catch (e) { /* negeren */ } }, 20000);
      var klaar = false;
      port.onMessage.addListener(function (msg) {
        if (msg.type === 'resultaat') { klaar = true; clearInterval(ping); port.disconnect(); resolve(msg); }
        else if (msg.type === 'fout') { klaar = true; clearInterval(ping); port.disconnect(); reject(new Error(msg.melding)); }
      });
      port.onDisconnect.addListener(function () {
        clearInterval(ping);
        if (!klaar) reject(new Error('Verbinding met de extensie verbroken. Herlaad de pagina en probeer opnieuw.'));
      });
      port.postMessage(Object.assign({ type: 'extract' }, payload));
    });
  }

  async function aiUitlezen() {
    if (aiBezig || !bestanden.length) return;
    aiBezig = true;
    $('ai-run').disabled = true;
    var start = Date.now();
    zetStatus('Documenten lezen…', true);
    var tik = setInterval(function () { zetStatus('Claude leest de documenten… ' + Math.round((Date.now() - start) / 1000) + 's', true); }, 1000);
    try {
      var payload = [];
      for (var i = 0; i < bestanden.length; i++) {
        payload.push({ naam: bestanden[i].name, mediaType: bestanden[i].type, data: await leesBase64(bestanden[i]) });
      }
      var res = await vraagAi({ bestanden: payload, context: $('ctx').value });
      aiResultaat = res.resultaat;
      zetStatus('Klaar in ' + Math.round((Date.now() - start) / 1000) + 's · ' + esc(res.model) + ' · ' + res.gebruik.input + ' in / ' + res.gebruik.output + ' uit tokens');
      renderAiResultaat();
    } catch (e) {
      zetStatus('<span style="color:#b42318">' + esc(e.message) + '</span>');
    } finally {
      clearInterval(tik);
      aiBezig = false;
      renderBestanden();
    }
  }

  function zetPad(obj, pad, waarde) {
    var delen = pad.split('.');
    var o = obj;
    for (var i = 0; i < delen.length - 1; i++) o = o[delen[i]];
    o[delen[delen.length - 1]] = waarde;
  }

  function zekerheidBadge(z, bron) {
    return '<span class="badge ' + esc(z || 'laag') + '" title="' + esc(bron ? 'Bron: ' + bron : 'Geen bron') + '">' + esc(z || 'laag') + '</span>';
  }

  function invoer(pad, waarde) {
    return '<input data-pad="' + esc(pad) + '" value="' + esc(waarde) + '">';
  }

  var ALG_LABELS = [
    ['declaratieType', 'Declaration type (PRD = CHED-P, LNV = CHED-D)'],
    ['bol', 'Bill of lading number (I.13)'], ['bestemming', 'Destination (I.20-25)'],
    ['grenscontrolepost', 'Border control post (I.4)'], ['plaatsBestemming', 'Place of destination (I.7)'],
    ['landOorsprong', 'Country of origin (I.11)'], ['landLading', 'Country of loading (I.14)'],
    ['gecertificeerdVoor', 'Goods certified as or for (I.18)'], ['transportconditie', 'Transport conditions (I.16)'],
    ['vervoermiddel', 'Means of transport (I.13)'], ['vervoermiddelNaam', 'Name / identification (I.13)'],
    ['vervoermiddelNationaliteit', 'Nationality (I.13)'], ['aankomstDatum', 'Expected date of arrival (I.10)'], ['aankomstTijd', 'Expected time of arrival']
  ];

  function groep(titel, rijen) {
    return '<div class="groep"><div class="gt">' + titel + '</div><table class="velden">' + rijen + '</table></div>';
  }

  function renderAiResultaat() {
    var r = aiResultaat;
    var html = '';
    if (r.waarschuwingen.length) {
      html += '<h3>Aandachtspunten</h3>' + r.waarschuwingen.map(function (w) { return '<div class="melding aandacht">' + esc(w) + '</div>'; }).join('');
    }
    html += '<h3>Benodigde documenten voor deze GGB</h3><div id="ai-check"></div>';

    html += '<h3>Voorstel GGB-gegevens <span class="small muted">(pas aan waar nodig)</span></h3>';
    var alg = ALG_LABELS.map(function (l) {
      var v = r[l[0]];
      return '<tr><td class="l">' + esc(l[1]) + '</td><td>' + invoer(l[0] + '.waarde', v.waarde) + '</td><td class="z">' + zekerheidBadge(v.zekerheid, v.bron) + '</td></tr>';
    }).join('');
    ['exporteur', 'importeur'].forEach(function (k) {
      var p = r[k];
      alg += '<tr><td class="l">' + (k === 'exporteur' ? 'Exporter (I.1)' : 'Importer (I.6)') + '</td><td>' + invoer(k + '.naam', p.naam) +
        '<div class="small muted">' + esc([p.adres, p.land].filter(Boolean).join(', ')) + '</div></td><td class="z">' + zekerheidBadge(p.zekerheid, p.bron) + '</td></tr>';
    });
    html += groep('General / Goods / Transport', alg);

    r.containers.forEach(function (c, i) {
      html += groep('Transport equipment ' + (i + 1) + ' (I.17)', FILL.CONTAINER.map(function (d) {
        return '<tr><td class="l">' + esc(d.naam) + '</td><td>' + invoer('containers.' + i + '.' + d.key, c[d.key]) + '</td><td class="z"></td></tr>';
      }).join(''));
    });
    r.documenten.forEach(function (doc, i) {
      var rijen = FILL.DOCUMENT.map(function (d) {
        return '<tr><td class="l">' + esc(d.naam) + (d.key === 'type' ? ' <span class="muted">(code)</span>' : '') + '</td><td>' + invoer('documenten.' + i + '.' + d.key, doc[d.key]) + '</td><td class="z"></td></tr>';
      }).join('') +
        '<tr><td class="l">Verwijst naar</td><td>' + invoer('documenten.' + i + '.verwijstNaar', doc.verwijstNaar) + '</td><td class="z"></td></tr>' +
        '<tr><td class="l">Bestand</td><td class="small">' + esc(doc.bestand || '–') + '</td><td class="z">' + zekerheidBadge(doc.zekerheid) + '</td></tr>';
      html += groep('Document ' + (i + 1) + ' (I.9) – ' + esc((RULES.DOC_TYPES[doc.type] || {}).naam || doc.type), rijen);
    });
    r.goederen.forEach(function (g, i) {
      html += groep('Goods item ' + (i + 1) + ' (I.31-I.34)', FILL.GOED.map(function (d) {
        return '<tr><td class="l">' + esc(d.naam) + '</td><td>' + invoer('goederen.' + i + '.' + d.key, g[d.key]) + '</td><td class="z">' + (d.key === 'gnCode' ? zekerheidBadge(g.zekerheid, g.bron) : '') + '</td></tr>';
      }).join(''));
    });

    html += '<div class="row-actions"><button class="btn primary" id="ai-fill">Invullen in Portbase</button>' +
      '<label class="small"><input type="checkbox" id="ai-overschrijven"> bestaande waarden overschrijven</label></div>' +
      '<div id="ai-fill-hint" class="small muted"></div><div id="ai-verslag"></div>';
    $('ai-result').innerHTML = html;
    renderAiCheck();
    updateFillKnop();
  }

  /** Documentcheck op het AI-voorstel: welke documenten zijn vereist en zijn ze aangeleverd? */
  function renderAiCheck() {
    var el = $('ai-check');
    if (!el || !aiResultaat) return;
    var decl = AI.naarDeclaratie(aiResultaat);
    if (!decl.goederen.length) { el.innerHTML = '<div class="melding aandacht">Geen goederenitems herkend; de documentcheck kan niet draaien.</div>'; return; }
    el.innerHTML = R.renderDeclResult(ENGINE.checkDeclaration(decl, rules));
  }

  function updateFillKnop() {
    var knop = $('ai-fill');
    if (!knop) return;
    var ok = FILL.formulierAanwezig();
    knop.disabled = !ok;
    $('ai-fill-hint').textContent = ok ? 'Er wordt niets verstuurd of opgeslagen: controleer het formulier en klik zelf op Opslaan/Verzenden.' : 'Open in Portbase "New declaration" (of een bewerkbare declaratie) om in te vullen.';
  }

  async function aiInvullen() {
    if (!aiResultaat) return;
    var knop = $('ai-fill');
    knop.disabled = true;
    var verslagEl = $('ai-verslag');
    verslagEl.innerHTML = '<span class="spinner"></span> Invullen…';
    var perNaam = {};
    bestanden.forEach(function (f) { perNaam[f.name] = f; });
    try {
      var verslag = await FILL.vul(aiResultaat, {
        overschrijven: $('ai-overschrijven').checked,
        bestanden: perNaam,
        voortgang: function (t) { if (t) verslagEl.innerHTML = '<span class="spinner"></span> ' + esc(t); }
      });
      var tel = {};
      verslag.forEach(function (v) { tel[v.status] = (tel[v.status] || 0) + 1; });
      var zichtbaar = verslag.filter(function (v) { return v.status !== 'overgeslagen' || v.melding; });
      verslagEl.innerHTML = '<h3>Resultaat</h3><p class="small">' +
        Object.keys(tel).map(function (k) { return tel[k] + ' ' + k; }).join(' · ') + '</p>' +
        '<ul class="verslag">' + zichtbaar.map(function (v) {
          return '<li><span class="badge ' + esc(v.status.replace(' ', '-')) + '">' + esc(v.status) + '</span> <b>' + esc(v.sectie) + '</b> – ' + esc(v.naam) +
            ': ' + esc(v.waarde) + (v.melding ? ' <span class="muted">(' + esc(v.melding) + ')</span>' : '') +
            (v.status === 'handmatig' || v.status === 'niet gevonden' ? '<button data-kopie="' + esc(v.waarde) + '">Kopieer</button>' : '') + '</li>';
        }).join('') + '</ul>';
      verslagEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    } catch (e) {
      verslagEl.innerHTML = '<div class="melding fout">Invullen mislukt: ' + esc(e.message) + '</div>';
    } finally {
      knop.disabled = !FILL.formulierAanwezig();
    }
  }

  /* ======================= start ======================= */

  function start() {
    buildPanel();
    chrome.runtime.sendMessage({ type: 'ggb:getData' }, function (res) {
      if (chrome.runtime.lastError || !res) res = { taricRules: [], taric: null, landen: {}, nomenclatuur: {}, meta: null };
      data = res;
      rules = RULES.DEFAULT_RULES.concat(res.taricRules || []);
      window.GGB_LANDNAMEN = Object.assign({}, res.landen || {}, RULES.LANDEN);
      R = RENDER.create({ ENGINE: ENGINE, DOC_TYPES: RULES.DOC_TYPES, LANDEN: window.GGB_LANDNAMEN, NOMEN: res.nomenclatuur || {}, TARIC: res.taric });
      $('foot-info').textContent = res.taric ? 'TARIC ' + (res.taric.extractieDatum || '') + ' · ' + (res.taricRules || []).length + ' auto-regels' : 'Alleen handmatige regels (TARIC-data niet geladen)';
      refresh(true);
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value', 'class'] });
      document.addEventListener('input', schedule, true);
      document.addEventListener('change', schedule, true);
      window.addEventListener('hashchange', schedule);
      window.addEventListener('popstate', schedule);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
