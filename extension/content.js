/*
 * Content script voor de Portbase-pagina: leest de declaratie uit de DOM,
 * voert de documentcheck uit en toont het resultaat in een zwevend paneel
 * (Shadow DOM, zodat de CSS van Portbase en van het paneel elkaar niet raken).
 */
(function () {
  'use strict';
  if (window.__ggbPanelLoaded) return;
  window.__ggbPanelLoaded = true;

  var ENGINE = window.GGB_ENGINE, RULES = window.GGB_RULES, PORTBASE = window.GGB_PORTBASE, RENDER = window.GGB_RENDER;
  var data = null, R = null, rules = RULES.DEFAULT_RULES;
  var host, shadow, body, statusEl, lastFp = '', collapsed = false, timer = null, lastDecl = null;

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}',
    '.wrap{position:fixed;right:16px;bottom:16px;width:440px;max-height:min(80vh,900px);display:flex;flex-direction:column;background:#fff;color:#1c2430;border:1px solid #d9dee6;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.18);font:13px/1.45 "Segoe UI",system-ui,sans-serif;z-index:2147483000;overflow:hidden}',
    '.wrap.collapsed{width:auto;max-height:none}.wrap.collapsed .body,.wrap.collapsed .foot{display:none}',
    '.head{display:flex;align-items:center;gap:.5rem;padding:.55rem .75rem;background:#0b5fa5;color:#fff;cursor:pointer;user-select:none}',
    '.head .logo{background:#fff;color:#0b5fa5;font-weight:700;border-radius:5px;padding:.05rem .35rem;font-size:.75rem}',
    '.head .title{font-weight:600;flex:1}.head button{background:transparent;border:1px solid rgba(255,255,255,.6);color:#fff;border-radius:5px;padding:.15rem .5rem;font:inherit;cursor:pointer}.head button:hover{background:rgba(255,255,255,.15)}',
    '.body{overflow:auto;padding:.75rem}.foot{padding:.5rem .75rem;border-top:1px solid #d9dee6;display:flex;gap:.5rem;justify-content:space-between;align-items:center;font-size:.75rem;color:#5f6b7a}',
    '.foot button{font:inherit;padding:.3rem .6rem;border-radius:5px;border:1px solid #d9dee6;background:#fff;cursor:pointer}.foot button.primary{background:#0b5fa5;border-color:#0b5fa5;color:#fff}',
    '.muted{color:#5f6b7a}.small{font-size:.8rem}p{margin:.25rem 0 .6rem}ul{margin:.3rem 0 0;padding-left:1.2rem}',
    '.badge{display:inline-block;font-size:.68rem;font-weight:600;padding:.1rem .45rem;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;vertical-align:middle}',
    '.badge.ok{background:#e6f4ec;color:#157347}.badge.aandacht{background:#fff4e0;color:#b26a00}.badge.ontbreekt,.badge.fout,.badge.verplicht{background:#fde8e6;color:#b42318}.badge.info{background:#e8f1fa;color:#0b5fa5}',
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
    '.empty{padding:.5rem 0;color:#5f6b7a}'
  ].join('\n');

  function esc(s) { return RENDER.esc(s); }

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
      '<div class="head" id="head"><span class="logo">GGB</span><span class="title">Documentcheck</span><span id="status"></span><button id="toggle" title="In-/uitklappen">–</button></div>' +
      '<div class="body" id="body"><div class="empty">Open een declaratie om de documentcheck te zien.</div></div>' +
      '<div class="foot"><span id="foot-info"></span><span><button id="refresh">Vernieuwen</button> <button id="open" class="primary">Openen in tool</button></span></div>';
    shadow.appendChild(wrap);
    body = shadow.getElementById('body');
    statusEl = shadow.getElementById('status');
    shadow.getElementById('toggle').addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(!collapsed); });
    shadow.getElementById('head').addEventListener('click', function () { if (collapsed) setCollapsed(false); });
    shadow.getElementById('refresh').addEventListener('click', function () { lastFp = ''; refresh(true); });
    shadow.getElementById('open').addEventListener('click', function () {
      if (!lastDecl) return;
      chrome.runtime.sendMessage({ type: 'ggb:openTool', declaratie: lastDecl });
    });
    (document.body || document.documentElement).appendChild(host);
    try { setCollapsed(localStorage.getItem('ggb.panel.collapsed') === '1'); } catch (e) { /* negeren */ }
  }

  function setCollapsed(v) {
    collapsed = v;
    shadow.querySelector('.wrap').classList.toggle('collapsed', v);
    shadow.getElementById('toggle').textContent = v ? '+' : '–';
    try { localStorage.setItem('ggb.panel.collapsed', v ? '1' : '0'); } catch (e) { /* negeren */ }
  }

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

  function start() {
    buildPanel();
    chrome.runtime.sendMessage({ type: 'ggb:getData' }, function (res) {
      if (chrome.runtime.lastError || !res) res = { taricRules: [], taric: null, landen: {}, nomenclatuur: {}, meta: null };
      data = res;
      rules = RULES.DEFAULT_RULES.concat(res.taricRules || []);
      R = RENDER.create({ ENGINE: ENGINE, DOC_TYPES: RULES.DOC_TYPES, LANDEN: Object.assign({}, res.landen || {}, RULES.LANDEN), NOMEN: res.nomenclatuur || {}, TARIC: res.taric });
      shadow.getElementById('foot-info').textContent = res.taric ? 'TARIC ' + (res.taric.extractieDatum || '') + ' · ' + (res.taricRules || []).length + ' auto-regels' : 'Alleen handmatige regels (TARIC-data niet geladen)';
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
