/*
 * Content script voor de Portbase-pagina. Zwevend paneel (Shadow DOM, zodat de
 * CSS van Portbase en van het paneel elkaar niet raken) met twee tabbladen:
 *
 *  - Documentcheck: leest de declaratie uit de DOM en toont welke documenten
 *    vereist zijn / ontbreken.
 *  - AI invullen: in drie stappen (Documenten -> Controleren -> Invullen):
 *    HC en andere documenten uploaden, laten uitlezen door de gekozen AI (via de
 *    service worker) of handmatig via een chat, het voorstel controleren en
 *    corrigeren (met samenvatting, zekerheid per veld en filter "alleen te
 *    controleren"), de documentcheck erop draaien en het formulier
 *    "New declaration" invullen (met voortgang, Stop en een filterbaar verslag).
 *
 * Extra: paneel links/rechts docken, breed/smal, in-/uitklappen met Alt+G,
 * voorstel exporteren als JSON en het laatste voorstel herstellen na herladen.
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
  var aiTijd = null;        // moment van het voorstel
  var aiBezig = false;
  var vulBezig = false;
  var laatsteVerslag = [];  // verslag van de laatste invulronde (met knoppen voor zoekdialogen)
  var verslagFilter = 'alle';
  var alleenControleren = false;
  var LAATSTE = 'ggb.ai.laatste'; // laatste voorstel (chrome.storage.local), om na herladen te herstellen

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}[hidden]{display:none!important}',
    '.wrap{--pb:#0b5fa5;--pb-d:#084a82;--pb-zacht:#eaf2fb;--inkt:#16202c;--zacht:#5d6b7c;--lijn:#e3e8ef;--vlak:#f6f8fb;--ok:#16794c;--ok-z:#e7f5ee;--let:#a15c00;--let-z:#fff4e2;--fout:#b42318;--fout-z:#fdecea;',
    '  position:fixed;right:16px;bottom:16px;width:500px;max-width:calc(100vw - 32px);height:min(86vh,940px);display:flex;flex-direction:column;background:#fff;color:var(--inkt);border:1px solid var(--lijn);border-radius:14px;',
    '  box-shadow:0 18px 50px rgba(16,24,40,.22),0 2px 6px rgba(16,24,40,.08);font:13px/1.45 "Segoe UI",system-ui,-apple-system,sans-serif;z-index:2147483000;overflow:hidden;transition:width .18s ease}',
    '.wrap[data-dock="links"]{right:auto;left:16px}.wrap[data-breed="1"]{width:680px}',
    '.wrap.collapsed{width:auto;height:auto}.wrap.collapsed .body,.wrap.collapsed .foot,.wrap.collapsed .tabs,.wrap.collapsed .hk-knop:not(#toggle){display:none}',
    /* kop */
    '.head{display:flex;align-items:center;gap:.6rem;padding:.6rem .7rem .6rem .85rem;background:linear-gradient(135deg,#0b5fa5,#0a4f8c);color:#fff;cursor:pointer;user-select:none}',
    '.logo{display:grid;place-items:center;width:28px;height:28px;background:#fff;color:var(--pb);font-weight:800;border-radius:8px;font-size:.68rem;letter-spacing:.02em;flex:none}',
    '.head .titel{flex:1;min-width:0;line-height:1.2}.head .titel b{display:block;font-size:.92rem}.head .titel small{opacity:.8;font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}',
    '.hk-knop{display:grid;place-items:center;width:28px;height:28px;background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:8px;font:inherit;font-size:.95rem;cursor:pointer;flex:none}.hk-knop:hover{background:rgba(255,255,255,.25)}',
    '.head .badge{background:rgba(255,255,255,.95)}',
    /* tabbladen */
    '.tabs{display:flex;gap:.25rem;padding:.4rem .5rem 0;background:var(--vlak);border-bottom:1px solid var(--lijn)}',
    '.tabs button{flex:1;display:flex;align-items:center;justify-content:center;gap:.4rem;border:0;background:none;padding:.5rem .4rem .55rem;font:inherit;font-weight:600;cursor:pointer;color:var(--zacht);border-bottom:2px solid transparent;border-radius:8px 8px 0 0}',
    '.tabs button:hover{color:var(--inkt);background:#eef2f7}.tabs button.active{color:var(--pb);border-bottom-color:var(--pb);background:#fff}',
    '.tel{display:inline-block;min-width:1.4em;padding:0 .4em;border-radius:999px;font-size:.68rem;font-weight:700;line-height:1.5;background:#e6ebf1;color:var(--zacht);text-align:center}.tel:empty{display:none}',
    '.tel.ok{background:var(--ok-z);color:var(--ok)}.tel.let,.tel.aandacht{background:var(--let-z);color:var(--let)}.tel.fout,.tel.ontbreekt{background:var(--fout-z);color:var(--fout)}',
    /* lichaam */
    '.body{overflow:auto;padding:.8rem;flex:1;background:#fff;scroll-behavior:smooth}.body[hidden]{display:none}',
    '.body::-webkit-scrollbar{width:10px}.body::-webkit-scrollbar-thumb{background:#cfd7e2;border-radius:10px;border:3px solid #fff}',
    '.foot{border-top:1px solid var(--lijn);background:var(--vlak);font-size:.78rem;color:var(--zacht)}.foot[hidden]{display:none}',
    '.foot-rij{display:flex;gap:.5rem;justify-content:space-between;align-items:center;padding:.55rem .8rem}',
    /* knoppen en invoer */
    'button.btn{display:inline-flex;align-items:center;justify-content:center;gap:.35rem;font:inherit;font-weight:600;padding:.4rem .75rem;border-radius:8px;border:1px solid var(--lijn);background:#fff;color:var(--inkt);cursor:pointer;transition:background .12s,border-color .12s}',
    'button.btn:hover{border-color:#b9c6d6;background:#f8fafc}button.btn.primary{background:var(--pb);border-color:var(--pb);color:#fff}button.btn.primary:hover{background:var(--pb-d)}',
    'button.btn.groot{width:100%;padding:.6rem;font-size:.9rem}button.btn.klein{padding:.22rem .55rem;font-size:.75rem;font-weight:600}button.btn.gevaar{color:var(--fout);border-color:#f1b5ae}button.btn.gevaar:hover{background:var(--fout-z)}',
    'button:disabled{opacity:.5;cursor:default!important}button.btn[aria-pressed="true"]{background:var(--pb-zacht);border-color:var(--pb);color:var(--pb)}',
    'button.link{border:0;background:none;color:var(--pb);cursor:pointer;font:inherit;padding:0;text-decoration:underline;text-underline-offset:2px}',
    'a{color:var(--pb)}',
    'textarea,input,select{font:inherit;color:var(--inkt)}',
    'textarea{width:100%;min-height:3.4em;padding:.45rem .55rem;border:1px solid var(--lijn);border-radius:8px;resize:vertical;background:#fff}textarea:focus,input:focus,select:focus{outline:none;border-color:var(--pb);box-shadow:0 0 0 3px rgba(11,95,165,.14)}',
    '.muted{color:var(--zacht)}.small{font-size:.78rem}p{margin:.25rem 0 .6rem}ul{margin:.3rem 0 0;padding-left:1.2rem}h3{font-size:.86rem;margin:.2rem 0 .5rem}',
    /* badges en meldingen */
    '.badge{display:inline-block;font-size:.66rem;font-weight:700;padding:.12rem .5rem;border-radius:999px;text-transform:uppercase;letter-spacing:.03em;vertical-align:middle;white-space:nowrap}',
    '.badge.ok,.badge.ingevuld,.badge.hoog{background:var(--ok-z);color:var(--ok)}.badge.aandacht,.badge.handmatig,.badge.middel{background:var(--let-z);color:var(--let)}.badge.ontbreekt,.badge.fout,.badge.verplicht,.badge.laag{background:var(--fout-z);color:var(--fout)}.badge.info,.badge.overgeslagen{background:var(--pb-zacht);color:var(--pb)}.badge.niet-gevonden{background:#eef1f5;color:var(--zacht)}',
    '.melding{padding:.5rem .65rem;border-radius:8px;font-size:.82rem;margin-bottom:.4rem;border:1px solid transparent}.melding.info{background:var(--pb-zacht);color:#0a4f8c;border-color:#d3e3f5}.melding.aandacht{background:var(--let-z);color:#7a4600;border-color:#f6dfb5}.melding.ontbreekt,.melding.fout{background:var(--fout-z);color:var(--fout);border-color:#f6cdc8}.melding.ok{background:var(--ok-z);color:var(--ok);border-color:#c9e8d7}',
    /* documentcheck (gedeelde weergave uit render.js) */
    '.card{border:1px solid var(--lijn);border-radius:12px;padding:.7rem .75rem;border-left:5px solid var(--lijn)}.card.ok{border-left-color:var(--ok)}.card.aandacht{border-left-color:var(--let)}.card.ontbreekt,.card.fout{border-left-color:var(--fout)}',
    '.card .head{background:none;color:inherit;padding:0 0 .45rem;cursor:default;display:flex;justify-content:space-between;gap:.5rem;user-select:text}',
    '.item{border-top:1px solid var(--lijn);padding-top:.55rem;margin-top:.55rem}.item-title{font-weight:600;margin-bottom:.4rem}.item-title span{font-weight:400;color:var(--zacht)}',
    '.req{border:1px solid var(--lijn);border-left-width:4px;border-radius:8px;padding:.45rem .6rem;margin-bottom:.4rem;font-size:.82rem;background:#fff}.req.ok{border-left-color:var(--ok)}.req.aandacht{border-left-color:var(--let)}.req.ontbreekt,.req.fout{border-left-color:var(--fout)}.req.verplicht-info{border-left-color:var(--pb)}',
    '.req .title{font-weight:600}.req .title .code{font-weight:400;color:var(--zacht);font-size:.76rem}.req ul{font-size:.8rem}.req .bron{font-size:.74rem;color:var(--zacht);margin-top:.25rem}',
    '.src{display:inline-block;font-size:.64rem;padding:0 .35rem;border-radius:4px;border:1px solid var(--lijn);color:var(--zacht);margin-left:.25rem;vertical-align:middle}.src.taric{border-color:#b7cde3;color:var(--pb);background:#f0f6fc}',
    '.chip{display:inline-block;background:#eef1f5;border-radius:5px;padding:0 .35em;margin:0 .15em .15em 0;font-family:ui-monospace,Consolas,monospace;font-size:.72rem}',
    'details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}',
    '.taric{margin-top:.5rem}.taric>summary{font-weight:600;font-size:.82rem;color:var(--pb)}.taric>summary::before{content:"▸ "}.taric[open]>summary::before{content:"▾ "}',
    '.taric-m{border:1px solid var(--lijn);border-radius:8px;padding:.4rem .6rem;margin:.4rem 0;font-size:.8rem}.taric-m .t{font-weight:600}.taric-m .t .muted{font-weight:400}.cert{font-family:ui-monospace,Consolas,monospace;background:#eef1f5;padding:0 .3em;border-radius:3px}',
    '.gn-descr{font-size:.8rem;color:var(--zacht);margin-bottom:.4rem}',
    '.empty{display:flex;flex-direction:column;align-items:center;gap:.4rem;text-align:center;padding:2.2rem 1rem;color:var(--zacht)}.empty .groot-ico{font-size:1.8rem;opacity:.6}',
    /* stappen */
    '.stepper{display:flex;list-style:none;margin:0 0 .75rem;padding:0;gap:.3rem;counter-reset:s}',
    '.stepper li{flex:1;display:flex;align-items:center;gap:.4rem;padding:.4rem .5rem;border-radius:9px;background:var(--vlak);color:var(--zacht);font-weight:600;font-size:.76rem;cursor:pointer;border:1px solid transparent}',
    '.stepper li span{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#dfe5ec;color:var(--zacht);font-size:.7rem;flex:none}',
    '.stepper li.actief{background:var(--pb-zacht);color:var(--pb);border-color:#cfe0f3}.stepper li.actief span{background:var(--pb);color:#fff}',
    '.stepper li.klaar{color:var(--ok)}.stepper li.klaar span{background:var(--ok);color:#fff;font-size:0}.stepper li.klaar span::after{content:"✓";font-size:.72rem}',
    /* kaarten / blokken */
    '.kaart{border:1px solid var(--lijn);border-radius:12px;padding:.75rem;margin-bottom:.75rem;background:#fff}',
    '.kaart-kop{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.6rem}.kaart-kop h3{margin:0}',
    '.via{display:flex;gap:.5rem;align-items:center;font-size:.78rem;color:var(--zacht)}.via b{color:var(--inkt)}',
    '.modus{display:flex;padding:3px;background:var(--vlak);border:1px solid var(--lijn);border-radius:9px;margin-bottom:.65rem}.modus button{flex:1;border:0;background:none;padding:.35rem;font:inherit;font-weight:600;cursor:pointer;color:var(--zacht);border-radius:7px}.modus button[aria-pressed="true"]{background:#fff;color:var(--pb);box-shadow:0 1px 3px rgba(16,24,40,.12)}',
    '.drop{display:flex;flex-direction:column;align-items:center;gap:.25rem;border:2px dashed #c3d4e8;border-radius:12px;padding:1rem .8rem;text-align:center;color:var(--zacht);background:linear-gradient(#fbfcfe,#f4f8fc);transition:background .12s,border-color .12s}',
    '.drop.over{background:var(--pb-zacht);border-color:var(--pb)}.drop .drop-ico{font-size:1.4rem;color:var(--pb)}.drop b{color:var(--inkt)}.drop label{color:var(--pb);cursor:pointer;text-decoration:underline;font-weight:600}.drop input{display:none}',
    '.files{list-style:none;padding:0;margin:.55rem 0;display:flex;flex-direction:column;gap:.3rem}.files:empty{display:none}',
    '.files li{display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem;border:1px solid var(--lijn);border-radius:8px;font-size:.8rem;background:#fff}',
    '.files .ft{font-size:.62rem;font-weight:800;padding:.1rem .3rem;border-radius:4px;background:var(--fout-z);color:var(--fout)}.files .ft.img{background:var(--pb-zacht);color:var(--pb)}',
    '.files .fn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.files button{border:0;background:none;color:var(--zacht);cursor:pointer;font:inherit;border-radius:5px;padding:0 .3rem}.files button:hover{color:var(--fout);background:var(--fout-z)}',
    '.files li.melding{display:block}',
    '#ctx{margin:.2rem 0 .6rem}',
    '.status-regel{margin-top:.5rem;min-height:1.1em}.status-regel:empty{display:none}',
    '.stappen{padding-left:1.2rem;margin:.4rem 0 .6rem;font-size:.82rem}.stappen li{margin:.35rem 0}',
    'textarea.json{min-height:7em;font-family:ui-monospace,Consolas,monospace;font-size:.74rem}',
    '.row-actions{display:flex;gap:.5rem;align-items:center;margin:.5rem 0;flex-wrap:wrap}',
    /* voorstel */
    '.toolbar{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin:.1rem 0 .6rem;flex-wrap:wrap}.toolbar .knoppen{display:flex;gap:.3rem;flex-wrap:wrap}',
    '.feiten{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem;margin-bottom:.6rem}.wrap[data-breed="1"] .feiten{grid-template-columns:repeat(4,1fr)}',
    '.feit{background:var(--vlak);border:1px solid var(--lijn);border-radius:9px;padding:.4rem .5rem;min-width:0}.feit small{display:block;color:var(--zacht);font-size:.66rem;text-transform:uppercase;letter-spacing:.04em;font-weight:700}.feit b{display:block;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.zeker{display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem;font-size:.74rem;color:var(--zacht)}.zeker .balk{flex:1;display:flex;height:7px;border-radius:9px;overflow:hidden;background:#eef1f5}.zeker .balk i{display:block}.zeker .h{background:#3aa673}.zeker .m{background:#e0a03a}.zeker .l{background:#e0625a}',
    '.blok{border:1px solid var(--lijn);border-radius:12px;margin-bottom:.6rem;background:#fff;overflow:hidden}',
    '.blok>summary{display:flex;align-items:center;gap:.45rem;padding:.55rem .7rem;font-weight:700;font-size:.84rem;background:var(--vlak)}.blok>summary:hover{background:#eef2f7}',
    '.blok>summary::before{content:"▸";color:var(--zacht);font-size:.75rem;width:.8em}.blok[open]>summary::before{content:"▾"}.blok[open]>summary{border-bottom:1px solid var(--lijn)}',
    '.blok>summary .rechts{margin-left:auto;display:flex;gap:.3rem;align-items:center;font-weight:400}.blok .inhoud{padding:.55rem .7rem}',
    '.groep{border:1px solid var(--lijn);border-radius:9px;padding:.4rem .55rem;margin:.45rem 0}.groep:first-child{margin-top:0}.groep .gt{display:flex;align-items:center;gap:.4rem;font-weight:700;font-size:.8rem;margin-bottom:.3rem}',
    'table.velden{width:100%;border-collapse:collapse;font-size:.8rem}table.velden td{padding:.2rem .25rem;border-bottom:1px solid #f0f3f7;vertical-align:middle}table.velden tr:last-child td{border-bottom:0}table.velden td.l{color:var(--zacht);width:40%}table.velden td.z{width:1%;text-align:right;white-space:nowrap}',
    'table.velden select{width:100%;font-size:.78rem;padding:.25rem;border:1px solid var(--lijn);border-radius:6px;background:#fff}',
    'table.velden input:not([type="checkbox"]){width:100%;padding:.25rem .4rem;border:1px solid var(--lijn);border-left:3px solid var(--lijn);border-radius:6px;background:#fff}',
    'input.z-hoog{border-left-color:#3aa673!important}input.z-middel{border-left-color:#e0a03a!important;background:#fffcf6!important}input.z-laag{border-left-color:#e0625a!important;background:#fff8f7!important}',
    '.datum-hint{display:block;font-size:.7rem;color:var(--pb);margin-top:.1rem}.datum-hint:empty{display:none}',
    '.alleen-controle tr[data-z="hoog"],.alleen-controle .groep[data-z="hoog"]{display:none}',
    '.uit .groep{opacity:.55}.uit .groep .gt .dn{text-decoration:line-through}',
    '.herstel{display:flex;align-items:center;gap:.5rem;justify-content:space-between}',
    /* invulbalk (voet) */
    '.vul{padding:.6rem .8rem;display:flex;flex-direction:column;gap:.45rem}',
    '.vul-rij{display:flex;align-items:center;gap:.5rem;justify-content:space-between;flex-wrap:wrap}',
    '.vul-opties{display:flex;gap:.7rem;flex-wrap:wrap;font-size:.76rem;color:var(--inkt)}.vul-opties label{display:inline-flex;gap:.3rem;align-items:center;cursor:pointer}',
    '.vul-knoppen{display:flex;gap:.4rem;margin-left:auto}',
    '.pil{display:inline-flex;align-items:center;gap:.25rem;font-size:.7rem;font-weight:700;color:var(--pb);background:var(--pb-zacht);padding:.1rem .45rem;border-radius:999px}',
    '.voortgang{display:flex;flex-direction:column;gap:.25rem}.voortgang[hidden]{display:none}.voortgang .balk{height:6px;border-radius:9px;background:#e3e9f1;overflow:hidden}.voortgang .balk i{display:block;height:100%;width:0;background:linear-gradient(90deg,#0b5fa5,#2f86d1);transition:width .25s}',
    '.voortgang span{font-size:.76rem;color:var(--inkt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* verslag */
    '.filters{display:flex;gap:.3rem;flex-wrap:wrap;margin:.2rem 0 .5rem}.filters button{font:inherit;font-size:.74rem;font-weight:600;padding:.18rem .55rem;border-radius:999px;border:1px solid var(--lijn);background:#fff;cursor:pointer;color:var(--inkt)}.filters button[aria-pressed="true"]{background:var(--inkt);border-color:var(--inkt);color:#fff}',
    '.verslag{list-style:none;padding:0;margin:0;border:1px solid var(--lijn);border-radius:10px;overflow:hidden}',
    '.verslag li{display:flex;gap:.5rem;align-items:flex-start;padding:.4rem .55rem;border-bottom:1px solid #f0f3f7;font-size:.79rem}.verslag li:last-child{border-bottom:0}.verslag li[hidden]{display:none}',
    '.v-ico{flex:none;display:grid;place-items:center;width:18px;height:18px;border-radius:50%;font-size:.66rem;font-weight:800;margin-top:.05rem}',
    '.st-ingevuld .v-ico{background:var(--ok-z);color:var(--ok)}.st-handmatig .v-ico{background:var(--let-z);color:var(--let)}.st-fout .v-ico,.st-niet-gevonden .v-ico{background:var(--fout-z);color:var(--fout)}.st-overgeslagen .v-ico{background:var(--pb-zacht);color:var(--pb)}',
    '.v-tekst{flex:1;min-width:0;word-break:break-word}.v-tekst .sec{color:var(--zacht);font-weight:600}.v-acties{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:.2rem;max-width:45%}',
    '.v-acties button{font:inherit;font-size:.72rem;font-weight:600;padding:.12rem .45rem;border:1px solid var(--lijn);border-radius:6px;background:#fff;cursor:pointer;color:var(--pb);white-space:nowrap}.v-acties button:hover{border-color:var(--pb)}',
    '.dlg-melding{font-size:.72rem;text-align:right}',
    '.spinner{display:inline-block;width:12px;height:12px;border:2px solid #b7cde3;border-top-color:var(--pb);border-radius:50%;animation:sp .8s linear infinite;vertical-align:middle}@keyframes sp{to{transform:rotate(360deg)}}',
    '.kbd{font-family:ui-monospace,Consolas,monospace;font-size:.68rem;border:1px solid var(--lijn);border-bottom-width:2px;border-radius:4px;padding:0 .3rem;background:#fff;color:var(--zacht)}'
  ].join('\n');

  function esc(s) { return RENDER.esc(s); }
  function $(id) { return shadow.getElementById(id); }
  function bewaarLokaal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* negeren */ } }
  function leesLokaal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

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
      '<div class="head" id="head"><span class="logo">GGB</span><div class="titel"><b>GGB-assistent</b><small id="sub">Documentcheck en AI invullen</small></div><span id="status"></span>' +
        '<button class="hk-knop" id="dock" title="Paneel naar de andere kant">⇆</button><button class="hk-knop" id="breed" title="Breder / smaller">⤢</button><button class="hk-knop" id="toggle" title="In-/uitklappen (Alt+G)">–</button></div>' +
      '<div class="tabs"><button id="tab-check" class="active">Documentcheck <span class="tel" id="tel-check"></span></button><button id="tab-ai">AI invullen <span class="tel" id="tel-ai"></span></button></div>' +
      '<div class="body" id="body"><div class="empty"><div class="groot-ico">📄</div>Open een declaratie om de documentcheck te zien.</div></div>' +
      '<div class="body" id="ai-body" hidden>' + aiHtml() + '</div>' +
      '<div class="foot" id="foot-check"><div class="foot-rij"><span id="foot-info"></span><span><button class="btn klein" id="refresh">↻ Vernieuwen</button> <button class="btn klein primary" id="open">Openen in tool ↗</button></span></div></div>' +
      '<div class="foot" id="foot-ai" hidden></div>';
    shadow.appendChild(wrap);
    body = $('body');
    statusEl = $('status');
    $('toggle').addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(!collapsed); });
    $('dock').addEventListener('click', function (e) { e.stopPropagation(); zetDock(wrap.getAttribute('data-dock') === 'links' ? 'rechts' : 'links'); });
    $('breed').addEventListener('click', function (e) { e.stopPropagation(); zetBreed(wrap.getAttribute('data-breed') !== '1'); });
    $('head').addEventListener('click', function () { if (collapsed) setCollapsed(false); });
    $('refresh').addEventListener('click', function () { lastFp = ''; refresh(true); });
    $('open').addEventListener('click', function () {
      if (!lastDecl) return;
      chrome.runtime.sendMessage({ type: 'ggb:openTool', declaratie: lastDecl });
    });
    $('tab-check').addEventListener('click', function () { setTab('check'); });
    $('tab-ai').addEventListener('click', function () { setTab('ai'); });
    document.addEventListener('keydown', function (e) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'g' || e.key === 'G' || e.code === 'KeyG')) { e.preventDefault(); setCollapsed(!collapsed); }
    }, true);
    bindAi();
    (document.body || document.documentElement).appendChild(host);
    zetDock(leesLokaal('ggb.panel.dock') || 'rechts');
    zetBreed(leesLokaal('ggb.panel.breed') === '1');
    setCollapsed(leesLokaal('ggb.panel.collapsed') === '1');
    if (leesLokaal('ggb.panel.tab') === 'ai') setTab('ai');
  }

  function zetDock(kant) {
    shadow.querySelector('.wrap').setAttribute('data-dock', kant);
    bewaarLokaal('ggb.panel.dock', kant);
  }
  function zetBreed(aan) {
    shadow.querySelector('.wrap').setAttribute('data-breed', aan ? '1' : '0');
    $('breed').title = aan ? 'Smaller' : 'Breder';
    bewaarLokaal('ggb.panel.breed', aan ? '1' : '0');
  }

  function setTab(t) {
    tab = t;
    $('tab-check').classList.toggle('active', t === 'check');
    $('tab-ai').classList.toggle('active', t === 'ai');
    $('body').hidden = t !== 'check';
    $('ai-body').hidden = t !== 'ai';
    $('foot-check').hidden = t !== 'check';
    $('foot-ai').hidden = t !== 'ai' || !aiResultaat;
    if (t === 'ai') updateFillKnop();
    bewaarLokaal('ggb.panel.tab', t);
  }

  function setCollapsed(v) {
    collapsed = v;
    shadow.querySelector('.wrap').classList.toggle('collapsed', v);
    $('toggle').textContent = v ? '+' : '–';
    bewaarLokaal('ggb.panel.collapsed', v ? '1' : '0');
  }

  /* ======================= Documentcheck ======================= */

  function render(decl) {
    lastDecl = decl;
    $('open').disabled = !decl;
    if (!decl) {
      body.innerHTML = '<div class="empty"><div class="groot-ico">📄</div><b>Geen declaratie gevonden</b>Open een declaratie (Details) of "New declaration" om de documentcheck te zien.</div>';
      statusEl.innerHTML = '';
      $('tel-check').textContent = '';
      return;
    }
    var res = ENGINE.checkDeclaration(decl, rules);
    statusEl.innerHTML = R.badge(res.status);
    var problemen = 0;
    res.items.forEach(function (it) { it.vereisten.forEach(function (v) { if (v.status !== 'ok') problemen++; }); });
    $('tel-check').textContent = problemen ? String(problemen) : (res.items.length ? '✓' : '');
    $('tel-check').className = 'tel ' + (problemen ? res.status : 'ok');
    var html = R.renderDeclResult(res);
    if (data && data.taric) {
      decl.goederen.forEach(function (g) {
        var t = R.renderTaric({ gn: g.gn, land: decl.landOorsprong }, { zonderVoetnoot: true });
        if (t) html += '<details class="taric"><summary>Douanetarief (TARIC) voor GN ' + esc(g.gn) + '</summary>' + t + '</details>';
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
      '<ol class="stepper" id="stepper"><li data-stap="1" class="actief"><span>1</span>Documenten</li><li data-stap="2"><span>2</span>Controleren</li><li data-stap="3"><span>3</span>Invullen</li></ol>' +
      '<div id="herstel"></div>' +
      '<section class="kaart" id="sec-bron">' +
        '<div class="kaart-kop"><h3>Documenten</h3><div class="via"><span id="ai-via"></span><button class="link" id="ai-opties">Instellingen</button></div></div>' +
        '<div class="modus" role="tablist"><button id="modus-auto" aria-pressed="true">Automatisch (API)</button><button id="modus-hand" aria-pressed="false">Handmatig (chat)</button></div>' +
        '<div class="drop" id="drop"><div class="drop-ico">⇪</div><div><b>Sleep HC, labrapport, factuur, B/L hierheen</b></div><div>of <label>kies bestanden<input type="file" id="file" multiple accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"></label></div><div class="small">PDF, JPG, PNG of WEBP · Portbase accepteert alleen PDF als bijlage</div></div>' +
        '<ul class="files" id="files"></ul>' +
        '<textarea id="ctx" placeholder="Extra info voor de AI (optioneel), bijv. ETA 26-09-2026 07:00, grenscontrolepost Rotterdam, B/L-nummer…"></textarea>' +
        '<div id="blok-auto"><button class="btn primary groot" id="ai-run" disabled>Uitlezen met AI</button><div id="ai-probleem"></div></div>' +
        '<div id="blok-hand" hidden>' +
          '<ol class="stappen">' +
            '<li><button class="btn primary" id="prompt-kopie">Kopieer prompt</button> <span class="small muted">bevat je bestandsnamen en extra info</span></li>' +
            '<li>Plak de prompt in een chat en voeg <b>dezelfde documenten</b> toe: ' +
              '<a href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT</a> · <a href="https://gemini.google.com/app" target="_blank" rel="noopener">Gemini</a> · <a href="https://claude.ai/new" target="_blank" rel="noopener">Claude</a></li>' +
            '<li>Plak het JSON-antwoord hieronder:</li>' +
          '</ol>' +
          '<textarea id="json-in" class="json" placeholder="{ &quot;declaratieType&quot;: … }" spellcheck="false"></textarea>' +
          '<div class="row-actions"><button class="btn primary" id="json-verwerk">Verwerken</button></div>' +
        '</div>' +
        '<div id="ai-status" class="status-regel small muted"></div>' +
      '</section>' +
      '<div id="ai-result"></div>';
  }

  /* ---- stappen ---- */
  function updateStepper() {
    var stap = !aiResultaat ? 1 : (laatsteVerslag.length ? 3 : 2);
    Array.prototype.forEach.call(shadow.querySelectorAll('#stepper li'), function (li) {
      var n = +li.getAttribute('data-stap');
      li.classList.toggle('actief', n === stap);
      li.classList.toggle('klaar', n < stap || (n === 3 && laatsteVerslag.length && !vulBezig));
    });
    var tel = $('tel-ai');
    if (!aiResultaat) { tel.textContent = ''; return; }
    var hand = laatsteVerslag.filter(function (v) { return v.status === 'handmatig' || v.status === 'niet gevonden' || v.status === 'fout'; }).length;
    tel.textContent = laatsteVerslag.length ? (hand ? String(hand) : '✓') : String(aiResultaat.waarschuwingen.length || '');
    tel.className = 'tel ' + (laatsteVerslag.length ? (hand ? 'let' : 'ok') : 'let');
  }

  /* ---- AI-instellingen (gedeeld met de instellingenpagina) ---- */
  var aiInst = AI.instellingen({});
  var modus = 'auto';

  function laadInstellingen(klaar) {
    try {
      chrome.storage.local.get('ggb.ai', function (r) {
        var nieuw = !r || !r['ggb.ai'];
        aiInst = AI.instellingen(r && r['ggb.ai']);
        if (klaar) klaar(nieuw);
        renderVia();
        renderVulBalkInfo();
      });
    } catch (e) { renderVia(); }
  }

  function renderVia() {
    if (!$('ai-via')) return;
    var meta = AI.PROVIDERS[aiInst.provider];
    var p = aiInst[aiInst.provider];
    $('ai-via').innerHTML = 'Via <b>' + esc(meta.naam) + '</b>' + (p && p.model ? ' · <span class="muted">' + esc(p.model) + '</span>' : '');
    var probleem = AI.aanbiederProbleem(aiInst);
    $('ai-probleem').innerHTML = probleem && aiInst.provider !== 'handmatig'
      ? '<div class="melding aandacht" style="margin-top:.5rem">' + esc(probleem) + ' <button class="link" data-opties="1">Instellen</button> of gebruik <button class="link" data-modus="hand">Handmatig</button>.</div>'
      : (aiInst.provider === 'handmatig' ? '<div class="melding info" style="margin-top:.5rem">Handmatige modus gekozen in de instellingen. <button class="link" data-modus="hand">Naar handmatig</button></div>' : '');
    $('ai-run').textContent = 'Uitlezen met ' + (aiInst.provider === 'handmatig' ? 'AI' : meta.naam);
    renderBestanden();
  }

  function zetModus(m) {
    modus = m;
    $('modus-auto').setAttribute('aria-pressed', String(m === 'auto'));
    $('modus-hand').setAttribute('aria-pressed', String(m === 'hand'));
    $('blok-auto').hidden = m !== 'auto';
    $('blok-hand').hidden = m !== 'hand';
  }

  function verwerkJson() {
    try {
      zetResultaat(AI.normaliseer(AI.leesJsonAntwoord($('json-in').value)));
      zetStatus('✓ Antwoord verwerkt (handmatig). Controleer het voorstel.');
    } catch (e) {
      zetStatus('<span style="color:#b42318">' + esc(e.message) + '</span>');
    }
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
    $('modus-auto').addEventListener('click', function () { zetModus('auto'); });
    $('modus-hand').addEventListener('click', function () { zetModus('hand'); });
    $('ai-opties').addEventListener('click', openOpties);
    $('ai-probleem').addEventListener('click', function (e) {
      if (e.target.getAttribute('data-opties')) openOpties();
      if (e.target.getAttribute('data-modus')) zetModus('hand');
    });
    $('stepper').addEventListener('click', function (e) {
      var li = e.target.closest && e.target.closest('li');
      if (!li) return;
      var doel = { 1: 'sec-bron', 2: 'ai-result', 3: 'ai-verslag' }[li.getAttribute('data-stap')];
      if (doel && $(doel)) $(doel).scrollIntoView({ block: 'start' });
    });
    $('prompt-kopie').addEventListener('click', function () {
      var knop = this;
      var prompt = AI.handmatigePrompt(bestanden.map(function (f) { return f.name; }), $('ctx').value);
      navigator.clipboard.writeText(prompt).then(function () { knop.textContent = 'Gekopieerd ✓'; setTimeout(function () { knop.textContent = 'Kopieer prompt'; }, 2000); },
        function () { zetStatus('Kopiëren mislukt; sta het klembord toe voor deze pagina.'); });
    });
    $('json-verwerk').addEventListener('click', verwerkJson);
    $('herstel').addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-herstel');
      if (a === 'ja') herstelVorige();
      if (a === 'nee') { wisVorige(); $('herstel').innerHTML = ''; }
    });
    try {
      chrome.storage.onChanged.addListener(function (wijz, gebied) { if (gebied === 'local' && wijz['ggb.ai']) laadInstellingen(); });
    } catch (e) { /* negeren */ }
    laadInstellingen(function () { if (aiInst.provider === 'handmatig') zetModus('hand'); });
    toonHerstel();
    var res = $('ai-result');
    res.addEventListener('input', function (e) {
      var p = e.target.getAttribute && e.target.getAttribute('data-pad');
      if (p) {
        zetPad(aiResultaat, p, e.target.value);
        if (e.target.hasAttribute('data-datum')) toonDatumHint(e.target);
        bewaarVoorstel();
      }
    });
    res.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.getAttribute) return;
      if (t.getAttribute('data-pad')) { renderAiCheck(); renderFeiten(); }
      var an = t.getAttribute('data-animo');
      if (an != null) { aiResultaat.goederen[+an].animoCode = t.value; renderAiCheck(); }
      var dt = t.getAttribute('data-doctype');
      if (dt != null) { aiResultaat.documenten[+dt].portbaseType = t.value; aiResultaat.documenten[+dt].portbaseTypeHandmatig = true; }
      var o = t.getAttribute('data-opnemen');
      if (o != null) {
        aiResultaat.documenten[+o].opnemen = t.checked;
        $('docgroep-' + o).className = t.checked ? '' : 'uit';
        $('doc-samenvatting').innerHTML = docSamenvatting();
        renderAiCheck();
      }
      bewaarVoorstel();
    });
    res.addEventListener('click', function (e) {
      var t = e.target;
      if (!t.getAttribute) return;
      if (t.id === 'res-filter') {
        alleenControleren = !alleenControleren;
        t.setAttribute('aria-pressed', String(alleenControleren));
        $('voorstel').classList.toggle('alleen-controle', alleenControleren);
      }
      if (t.id === 'res-export') exporteer();
      if (t.id === 'res-nieuw') nieuweZending();
      var f = t.getAttribute('data-filter');
      if (f) { verslagFilter = f; pasFilterToe(); }
      var dlg = t.getAttribute('data-dialoog');
      if (dlg != null) zoekOpnieuw(t, +dlg);
      var kopie = t.getAttribute('data-kopie');
      if (kopie != null) {
        navigator.clipboard.writeText(kopie).then(function () { t.textContent = 'Gekopieerd ✓'; }, function () { t.textContent = 'Mislukt'; });
      }
    });
  }

  var TOEGESTAAN = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  function voegToe(lijst) {
    Array.prototype.forEach.call(lijst || [], function (f) {
      if (TOEGESTAAN.indexOf(f.type) < 0) { zetStatus('Bestandstype van ' + esc(f.name) + ' wordt niet ondersteund.'); return; }
      if (!bestanden.some(function (b) { return b.name === f.name && b.size === f.size; })) bestanden.push(f);
    });
    renderBestanden();
  }

  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' kB' : (n / 1048576).toFixed(1) + ' MB'; }

  function renderBestanden() {
    var totaal = bestanden.reduce(function (s, f) { return s + f.size; }, 0);
    $('files').innerHTML = bestanden.map(function (f, i) {
      var pdf = f.type === 'application/pdf';
      return '<li><span class="ft' + (pdf ? '' : ' img') + '">' + (pdf ? 'PDF' : 'IMG') + '</span><span class="fn" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="muted small">' + mb(f.size) + '</span><button data-del="' + i + '" title="Verwijderen">✕</button></li>';
    }).join('') + (totaal > 24 * 1048576 ? '<li class="melding aandacht">Samen ' + mb(totaal) + ': te groot voor één verzoek (max. ±24 MB). Laat grote bijlagen weg of comprimeer ze.</li>' : '');
    $('ai-run').disabled = aiBezig || !bestanden.length || totaal > 24 * 1048576 || !!AI.aanbiederProbleem(aiInst);
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
    var naam = AI.PROVIDERS[aiInst.provider].naam;
    var tik = setInterval(function () { zetStatus(esc(naam) + ' leest de documenten… ' + Math.round((Date.now() - start) / 1000) + 's', true); }, 1000);
    try {
      var payload = [];
      for (var i = 0; i < bestanden.length; i++) {
        payload.push({ naam: bestanden[i].name, mediaType: bestanden[i].type, data: await leesBase64(bestanden[i]) });
      }
      var res = await vraagAi({ bestanden: payload, context: $('ctx').value });
      zetStatus('✓ Klaar in ' + Math.round((Date.now() - start) / 1000) + 's · ' + esc(res.model) + ' · ' + res.gebruik.input + ' in / ' + res.gebruik.output + ' uit tokens');
      zetResultaat(res.resultaat);
    } catch (e) {
      zetStatus('<span style="color:#b42318">' + esc(e.message) + '</span>');
    } finally {
      clearInterval(tik);
      aiBezig = false;
      renderBestanden();
    }
  }

  function openOpties() {
    try { chrome.runtime.sendMessage({ type: 'ggb:openOpties' }); } catch (e) { /* negeren */ }
  }

  function zetPad(obj, pad, waarde) {
    var delen = pad.split('.');
    var o = obj;
    for (var i = 0; i < delen.length - 1; i++) o = o[delen[i]];
    o[delen[delen.length - 1]] = waarde;
  }

  /* ---- voorstel bewaren / herstellen / exporteren ---- */

  function zetResultaat(r, tijd) {
    aiResultaat = r;
    aiTijd = tijd || Date.now();
    laatsteVerslag = [];
    $('herstel').innerHTML = '';
    renderAiResultaat();
    bewaarVoorstel();
    $('ai-result').scrollIntoView({ block: 'start' });
  }

  var bewaarTimer = null;
  function bewaarVoorstel() {
    clearTimeout(bewaarTimer);
    bewaarTimer = setTimeout(function () {
      if (!aiResultaat) return;
      var o = {};
      o[LAATSTE] = { tijd: aiTijd, resultaat: aiResultaat };
      try { chrome.storage.local.set(o); } catch (e) { /* negeren */ }
    }, 500);
  }
  function wisVorige() { try { chrome.storage.local.remove(LAATSTE); } catch (e) { /* negeren */ } }

  function tijdTekst(t) {
    var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function toonHerstel() {
    try {
      chrome.storage.local.get(LAATSTE, function (x) {
        var v = x && x[LAATSTE];
        if (!v || !v.resultaat || aiResultaat || Date.now() - v.tijd > 3 * 86400000) return;
        var r = v.resultaat, bl = r.bol && r.bol.waarde, exp = r.exporteur && r.exporteur.naam;
        $('herstel').innerHTML = '<div class="melding info herstel"><span>Vorig voorstel van <b>' + esc(tijdTekst(v.tijd)) + '</b>' + (bl ? ' · B/L ' + esc(bl) : '') + (exp ? ' · ' + esc(exp) : '') + '</span>' +
          '<span><button class="btn klein primary" data-herstel="ja">Herstellen</button> <button class="btn klein" data-herstel="nee" title="Vorig voorstel wissen">✕</button></span></div>';
      });
    } catch (e) { /* negeren */ }
  }

  function herstelVorige() {
    chrome.storage.local.get(LAATSTE, function (x) {
      var v = x && x[LAATSTE];
      if (!v) return;
      zetResultaat(v.resultaat, v.tijd);
      zetStatus('Vorig voorstel hersteld. Voeg de documenten opnieuw toe als ze geüpload moeten worden.');
    });
  }

  function exporteer() {
    var r = aiResultaat;
    var naam = 'ggb-voorstel-' + String((r.bol && r.bol.waarde) || tijdTekst(aiTijd)).replace(/[^A-Za-z0-9-]+/g, '_') + '.json';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    a.download = naam;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function nieuweZending() {
    if (vulBezig) return;
    if (!confirm('Nieuwe zending beginnen? Het huidige voorstel en de documenten worden uit het paneel gehaald.')) return;
    aiResultaat = null;
    laatsteVerslag = [];
    bestanden = [];
    $('ctx').value = '';
    $('json-in').value = '';
    $('ai-result').innerHTML = '';
    $('foot-ai').hidden = true;
    $('foot-ai').innerHTML = '';
    zetStatus('');
    wisVorige();
    renderBestanden();
    updateStepper();
    $('sec-bron').scrollIntoView({ block: 'start' });
  }

  /* ---- weergave van het voorstel ---- */

  function zekerheidBadge(z, bron) {
    return '<span class="badge ' + esc(z || 'laag') + '" title="' + esc(bron ? 'Bron: ' + bron : 'Geen bron') + '">' + esc(z || 'laag') + '</span>';
  }

  function invoer(pad, waarde, z, extra) {
    var datum = extra && extra.datum;
    return '<input data-pad="' + esc(pad) + '" value="' + esc(waarde) + '"' + (z ? ' class="z-' + esc(z) + '"' : '') + (datum ? ' data-datum="1"' : '') + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + '>' +
      (datum ? '<span class="datum-hint">' + esc(datumHintTekst(waarde)) + '</span>' : '');
  }

  function datumFormaat() { return (aiInst.invullen || {}).datumFormaat || 'MM/DD/YYYY'; }
  function datumHintTekst(v) {
    if (!v) return '';
    var d = AI.normDatum(v);
    return d ? 'In Portbase: ' + AI.naarPortbaseDatum(d, datumFormaat()) : 'Datum niet herkend (dd-mm-jjjj)';
  }
  function toonDatumHint(input) {
    var h = input.nextElementSibling;
    if (h && h.classList.contains('datum-hint')) h.textContent = datumHintTekst(input.value);
  }

  var ALG_LABELS = [
    ['declaratieType', 'Declaration type (PRD = CHED-P, LNV = CHED-D)'],
    ['bol', 'Bill of lading number (I.13)'], ['bestemming', 'Destination (I.20-25)'],
    ['grenscontrolepost', 'Border control post (I.4)'],
    ['landOorsprong', 'Country of origin (I.11)'], ['landLading', 'Country of loading (I.14)'],
    ['gecertificeerdVoor', 'Goods certified as or for (I.18)'], ['transportconditie', 'Transport conditions (I.16)'],
    ['vervoermiddel', 'Means of transport (I.13)'], ['vervoermiddelNaam', 'Name / identification (I.13)'],
    ['vervoermiddelNationaliteit', 'Nationality (I.13)'], ['aankomstDatum', 'Expected date of arrival (I.10)'], ['aankomstTijd', 'Expected time of arrival'],
    ['totaalColli', 'Totaal colli (HC I.24)'], ['totaalNettoGewicht', 'Totaal netto kg (HC I.26)'], ['totaalBrutoGewicht', 'Totaal bruto kg (HC I.26)']
  ];

  var Z_RANG = { hoog: 0, middel: 1, laag: 2 };
  function slechtste(lijst) {
    return lijst.reduce(function (a, z) { return Z_RANG[z] > Z_RANG[a] ? z : a; }, 'hoog');
  }

  function groep(titel, rijen, z) {
    return '<div class="groep"' + (z ? ' data-z="' + esc(z) + '"' : '') + '><div class="gt">' + titel + '</div><table class="velden">' + rijen + '</table></div>';
  }
  function rij(label, inhoud, z, rechts) {
    return '<tr' + (z ? ' data-z="' + esc(z) + '"' : '') + '><td class="l">' + label + '</td><td>' + inhoud + '</td><td class="z">' + (rechts || '') + '</td></tr>';
  }
  function blok(id, titel, inhoud, rechts, open) {
    return '<details class="blok" id="' + id + '"' + (open === false ? '' : ' open') + '><summary>' + titel + '<span class="rechts">' + (rechts || '') + '</span></summary><div class="inhoud">' + inhoud + '</div></details>';
  }
  function telPil(n, soort) { return n ? '<span class="tel ' + (soort || '') + '">' + n + '</span>' : ''; }

  function alleZekerheden(r) {
    var z = ALG_LABELS.map(function (l) { return r[l[0]].zekerheid; });
    ['exporteur', 'importeur', 'plaatsBestemming', 'plaatsVerzending'].forEach(function (k) { z.push(r[k].zekerheid); });
    r.documenten.forEach(function (d) { z.push(d.zekerheid); });
    r.goederen.forEach(function (g) { z.push(g.zekerheid); });
    return z;
  }

  function landTekst(code) { var n = (window.GGB_LANDNAMEN || {})[code]; return code ? code + (n ? ' – ' + n : '') : '–'; }

  function renderFeiten() {
    var el = $('feiten');
    if (!el || !aiResultaat) return;
    var r = aiResultaat;
    var netto = r.goederen.reduce(function (a, g) { return a + (+g.nettoGewicht || 0); }, 0);
    var hc = r.documenten.filter(function (d) { return d.type === 'HC'; })[0];
    var feiten = [
      ['Type', r.declaratieType.waarde === 'LNV' ? 'CHED-D' : r.declaratieType.waarde === 'PRD' ? 'CHED-P' : '–'],
      ['Oorsprong', landTekst(r.landOorsprong.waarde)],
      ['Grenspost', r.grenscontrolepost.waarde || '–'],
      ['B/L', r.bol.waarde || '–'],
      ['HC (IMSOC)', hc ? hc.identificatie || '–' : '–'],
      ['Goederen', r.goederen.length + ' item' + (r.goederen.length === 1 ? '' : 's') + (netto ? ' · ' + netto.toLocaleString('nl-NL') + ' kg' : '')],
      ['Containers', r.containers.map(function (c) { return c.containernummer; }).join(', ') || '–'],
      ['ETA', r.aankomstDatum.waarde || '–']
    ];
    el.innerHTML = feiten.map(function (f) { return '<div class="feit" title="' + esc(f[1]) + '"><small>' + esc(f[0]) + '</small><b>' + esc(f[1]) + '</b></div>'; }).join('');
  }

  function renderAiResultaat() {
    var r = aiResultaat;
    var z = alleZekerheden(r);
    var n = { hoog: 0, middel: 0, laag: 0 };
    z.forEach(function (x) { n[x] = (n[x] || 0) + 1; });
    var pct = function (k) { return (100 * n[k] / Math.max(1, z.length)).toFixed(1) + '%'; };
    var html = '<div class="toolbar"><span class="small muted">Voorstel van ' + esc(tijdTekst(aiTijd)) + ' · pas aan waar nodig</span><span class="knoppen">' +
      '<button class="btn klein" id="res-filter" aria-pressed="' + alleenControleren + '" title="Verberg velden met zekerheid hoog">Alleen te controleren</button>' +
      '<button class="btn klein" id="res-export" title="Voorstel downloaden als JSON (kan in de handmatige modus weer worden ingelezen)">Exporteren</button>' +
      '<button class="btn klein" id="res-nieuw" title="Leeg paneel voor een nieuwe zending">Nieuw</button></span></div>';
    html += '<div class="feiten" id="feiten"></div>';
    html += '<div class="zeker" title="Zekerheid van de velden in het voorstel"><span>Zekerheid</span><span class="balk"><i class="h" style="width:' + pct('hoog') + '"></i><i class="m" style="width:' + pct('middel') + '"></i><i class="l" style="width:' + pct('laag') + '"></i></span>' +
      '<span>' + n.hoog + ' hoog · ' + n.middel + ' middel · ' + n.laag + ' laag</span></div>';

    if (r.waarschuwingen.length) {
      html += blok('blok-aandacht', 'Aandachtspunten', r.waarschuwingen.map(function (w) { return '<div class="melding aandacht">' + esc(w) + '</div>'; }).join(''), telPil(r.waarschuwingen.length, 'let'));
    }
    html += blok('blok-check', 'Benodigde documenten voor deze GGB', '<div id="ai-check"></div>');

    var v = '';
    v += blok('blok-alg', 'Algemeen, goederen en vervoer', '<table class="velden">' + ALG_LABELS.map(function (l) {
      var w = r[l[0]];
      return rij(esc(l[1]), invoer(l[0] + '.waarde', w.waarde, w.zekerheid, { datum: l[0] === 'aankomstDatum' }), w.zekerheid, zekerheidBadge(w.zekerheid, w.bron));
    }).join('') + '</table>', telPil(ALG_LABELS.filter(function (l) { return r[l[0]].zekerheid !== 'hoog'; }).length, 'let'));

    // Organisaties: naam, adres, plaats, land en erkenningsnummer bepalen samen welke regel in de Portbase-dialoog gekozen wordt.
    var orgs = [['exporteur', 'Exporter (I.1)'], ['importeur', 'Importer (I.6)'], ['plaatsBestemming', 'Place of destination (I.7)'], ['plaatsVerzending', 'Place of dispatch / establishment of origin (I.11)']];
    v += blok('blok-org', 'Organisaties', orgs.map(function (o) {
      var p = r[o[0]];
      return groep(esc(o[1]) + ' ' + zekerheidBadge(p.zekerheid, p.bron), [['naam', 'Naam'], ['adres', 'Adres'], ['plaats', 'Plaats'], ['land', 'Land (ISO)'], ['erkenningsnummer', 'Erkenningsnummer']].map(function (x) {
        return rij(x[1], invoer(o[0] + '.' + x[0], p[x[0]]));
      }).join(''), p.zekerheid);
    }).join(''), telPil(orgs.filter(function (o) { return r[o[0]].zekerheid !== 'hoog'; }).length, 'let'), true);

    if (r.containers.length) {
      v += blok('blok-cont', 'Containers (I.17)', r.containers.map(function (c, i) {
        return groep('Transport equipment ' + (i + 1), FILL.CONTAINER.map(function (d) {
          return rij(esc(d.naam), invoer('containers.' + i + '.' + d.key, c[d.key]));
        }).join(''));
      }).join(''), telPil(r.containers.length));
    }

    bepaalDocumenten();
    var docs = '<div class="melding info" id="doc-samenvatting">' + docSamenvatting() + '</div>';
    r.documenten.forEach(function (doc, i) {
      var hc = doc.type === 'HC';
      var rijen = rij('Opnemen in GGB', '<label class="small"><input type="checkbox" data-opnemen="' + i + '"' + (doc.opnemen ? ' checked' : '') + '> ' + esc(doc.reden) + '</label>') +
        rij('Type in Portbase', '<select data-doctype="' + i + '">' + AI.PORTBASE_DOCTYPES.map(function (t) {
          return '<option' + (t === doc.portbaseType ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>') +
        FILL.DOCUMENT.filter(function (d) { return d.key !== 'type'; }).map(function (d) {
          var label = d.key === 'identificatie' && hc ? 'Identification <b>(IMSOC, I.2.a)</b>' : esc(d.naam);
          var z = d.key === 'identificatie' ? doc.zekerheid : '';
          return rij(label, invoer('documenten.' + i + '.' + d.key, doc[d.key], z, { datum: d.key === 'datumAfgifte', ph: d.key === 'identificatie' && hc ? 'IMPORT.EU.XX.2026.0000000' : '' }));
        }).join('') +
        (hc ? rij('Certificate reference (I.2)', invoer('documenten.' + i + '.certificaatReferentie', doc.certificaatReferentie) + '<span class="datum-hint" style="color:#5d6b7c">Niet in de GGB; telt mee als verwijzing van het labrapport</span>') : '') +
        rij('Verwijst naar', invoer('documenten.' + i + '.verwijstNaar', doc.verwijstNaar)) +
        rij('Bestand', '<span class="small">' + esc(doc.bestand || '–') + '</span>', '', zekerheidBadge(doc.zekerheid));
      docs += '<div class="' + (doc.opnemen ? '' : 'uit') + '" id="docgroep-' + i + '">' + groep('<span class="dn">Document ' + (i + 1) + ' – ' + esc((RULES.DOC_TYPES[doc.type] || {}).naam || doc.type) + '</span>', rijen, doc.zekerheid) + '</div>';
    });
    v += blok('blok-docs', 'Documenten (I.9)', docs, telPil(r.documenten.filter(function (d) { return d.opnemen; }).length, 'ok'));

    v += blok('blok-goed', 'Goederenitems (I.31-I.34)', r.goederen.map(function (g, i) {
      return groep('Goods item ' + (i + 1) + ' ' + zekerheidBadge(g.zekerheid, g.bron) + (g.gnCode ? ' <span class="muted small">GN ' + esc(g.gnCode) + '</span>' : ''), FILL.GOED.map(function (d) {
        return rij(esc(d.naam), invoer('goederen.' + i + '.' + d.key, g[d.key], d.key === 'gnCode' ? g.zekerheid : ''));
      }).join('') +
        rij('Code op HC (zoekterm GN)', invoer('goederen.' + i + '.gnCodeHc', g.gnCodeHc)) +
        rij('Soort (wetensch. naam, I.28)', invoer('goederen.' + i + '.wetenschappelijkeNaam', g.wetenschappelijkeNaam)) +
        rij('Aard product (HC I.28)', invoer('goederen.' + i + '.aardProduct', g.aardProduct)) +
        rij('ANIMO code', '<select data-animo="' + i + '"><option value="">– kies –</option>' + AI.ANIMO_CODES.map(function (a) {
          return '<option value="' + esc(a.code) + '"' + (a.code === g.animoCode ? ' selected' : '') + '>' + esc(a.code + ' – ' + a.omschrijving) + '</option>'; }).join('') + '</select>'), g.zekerheid);
    }).join('') || '<div class="melding aandacht">Geen goederenitems herkend.</div>', telPil(r.goederen.length));

    html += '<div id="voorstel"' + (alleenControleren ? ' class="alleen-controle"' : '') + '>' + v + '</div>';
    html += '<div id="ai-verslag"></div>';
    $('ai-result').innerHTML = html;
    renderFeiten();
    renderAiCheck();
    renderVulBalk();
    updateStepper();
  }

  /* ---- invulbalk (voet van het tabblad AI invullen) ---- */

  function renderVulBalk() {
    var f = $('foot-ai');
    f.innerHTML = '<div class="vul">' +
      '<div class="voortgang" id="ai-voortgang" hidden><div class="balk"><i id="ai-balk"></i></div><span id="ai-fase"></span></div>' +
      '<div class="vul-rij"><div class="vul-opties">' +
        '<label title="Zoekvensters (exporteur, importeur, BCP, bestemming, inrichting, GN-code, Animo) zelf afhandelen: zoeken, juiste regel kiezen en Save in het venster"><input type="checkbox" id="ai-dialogen" checked> Zoekvensters automatisch</label>' +
        '<label title="Velden die al een waarde hebben toch overschrijven"><input type="checkbox" id="ai-overschrijven"> Overschrijven</label>' +
        '<span id="vul-info"></span>' +
      '</div><div class="vul-knoppen"><button class="btn gevaar" id="ai-stop" hidden>■ Stop</button><button class="btn primary" id="ai-fill">Invullen in Portbase</button></div></div>' +
      '<div id="ai-fill-hint" class="small muted"></div></div>';
    f.hidden = tab !== 'ai';
    $('ai-fill').addEventListener('click', aiInvullen);
    $('ai-stop').addEventListener('click', function () { FILL.stop(); this.disabled = true; this.textContent = 'Stoppen…'; });
    renderVulBalkInfo();
    updateFillKnop();
  }

  function renderVulBalkInfo() {
    var el = $('vul-info');
    if (!el) return;
    var inv = aiInst.invullen || {};
    el.innerHTML = '<span class="pil" title="Datumnotatie op het Portbase-formulier (instellingen)">📅 ' + esc(datumFormaat()) + '</span> <span class="pil" title="Maximale wachttijd op een zoekresultaat in Portbase (instellingen)">⏱ ' + esc(inv.maxWacht || 120) + 's</span>';
  }

  /** Welke documenten in de GGB horen volgens de regels (per goederenitem). */
  function bepaalDocumenten() {
    if (!aiResultaat) return;
    var decl = AI.naarDeclaratie(aiResultaat);
    var index = {};
    rules.forEach(function (x) { index[x.id] = x; });
    var eisen = decl.goederen.map(function (g) { return ENGINE.requirementsFor({ type: decl.type, gn: g.gn, animo: g.animo, land: decl.landOorsprong }, rules).vereisten; });
    AI.bepaalGgbDocumenten(aiResultaat, eisen, function (id) { return index[id]; });
  }

  function docSamenvatting() {
    var docs = aiResultaat.documenten, inGgb = docs.filter(function (d) { return d.opnemen; });
    var naam = function (d) { return (RULES.DOC_TYPES[d.type] || {}).naam || d.type; };
    var bron = docs.filter(function (d) { return !d.opnemen; });
    return '<b>In de GGB: ' + (inGgb.length ? esc(inGgb.map(naam).join(', ')) : 'geen documenten') + '</b> (' + inGgb.length + ' van ' + docs.length + ').' +
      (bron.length ? ' Alleen als bron gebruikt: ' + esc(bron.map(naam).join(', ')) + '.' : '');
  }

  /** Documentcheck op het AI-voorstel: welke documenten zijn vereist en zijn ze aangeleverd? */
  function renderAiCheck() {
    var el = $('ai-check');
    if (!el || !aiResultaat) return;
    bepaalDocumenten();
    var decl = AI.naarDeclaratie(aiResultaat);
    if (!decl.goederen.length) { el.innerHTML = '<div class="melding aandacht">Geen goederenitems herkend; de documentcheck kan niet draaien.</div>'; return; }
    el.innerHTML = R.renderDeclResult(ENGINE.checkDeclaration(decl, rules));
  }

  function updateFillKnop() {
    var knop = $('ai-fill');
    if (!knop) return;
    var ok = FILL.formulierAanwezig();
    knop.disabled = !ok || vulBezig;
    if (vulBezig) return;
    $('ai-fill-hint').textContent = ok ? 'De declaratie wordt niet opgeslagen of verstuurd: alleen in de zoekvensters klikt de extensie op Save. Controleer het formulier en klik zelf op Save/Send.' : 'Open in Portbase "New declaration" (of een bewerkbare declaratie) om in te vullen.';
  }

  function vulOpties() {
    var inv = aiInst.invullen || {};
    return { datumFormaat: datumFormaat(), maxWacht: inv.maxWacht || 120, trefwoorden: inv.trefwoorden !== false };
  }

  var ST_ICO = { ingevuld: '✓', handmatig: '!', 'niet gevonden': '?', fout: '✕', overgeslagen: '–' };
  var ST_VOLGORDE = ['ingevuld', 'handmatig', 'niet gevonden', 'fout', 'overgeslagen'];

  async function aiInvullen() {
    if (!aiResultaat || vulBezig) return;
    vulBezig = true;
    var knop = $('ai-fill'), stopKnop = $('ai-stop');
    knop.disabled = true;
    stopKnop.hidden = false; stopKnop.disabled = false; stopKnop.textContent = '■ Stop';
    $('ai-voortgang').hidden = false;
    $('ai-fill-hint').textContent = 'Bezig met invullen; laat de pagina open. Zoekvensters wachten tot Portbase resultaten toont.';
    var verslagEl = $('ai-verslag');
    verslagEl.innerHTML = '<div class="melding info"><span class="spinner"></span> Invullen…</div>';
    var perNaam = {};
    bestanden.forEach(function (f) { perNaam[f.name] = f; });
    try {
      var verslag = await FILL.vul(aiResultaat, Object.assign({
        overschrijven: $('ai-overschrijven').checked,
        dialogen: $('ai-dialogen').checked,
        bestanden: perNaam,
        voortgang: function (t, p) {
          if (!t) return;
          $('ai-fase').textContent = (p ? p.stap + '/' + p.totaal + ' · ' : '') + t;
          if (p) $('ai-balk').style.width = Math.round(100 * p.stap / Math.max(1, p.totaal)) + '%';
        }
      }, vulOpties()));
      laatsteVerslag = verslag;
      verslagFilter = 'alle';
      renderVerslag();
      verslagEl.scrollIntoView({ block: 'start' });
    } catch (e) {
      verslagEl.innerHTML = '<div class="melding fout">Invullen mislukt: ' + esc(e.message) + '</div>';
    } finally {
      vulBezig = false;
      stopKnop.hidden = true;
      $('ai-voortgang').hidden = true;
      $('ai-balk').style.width = '0';
      updateFillKnop();
      updateStepper();
    }
  }

  function renderVerslag() {
    var verslag = laatsteVerslag, verslagEl = $('ai-verslag');
    var tel = {};
    verslag.forEach(function (v) { tel[v.status] = (tel[v.status] || 0) + 1; });
    var zichtbaar = verslag.map(function (v, i) { v.index = i; return v; }).filter(function (v) { return v.status !== 'overgeslagen' || v.melding; });
    var aanwezig = ST_VOLGORDE.filter(function (k) { return tel[k]; });
    verslagEl.innerHTML = '<h3>Resultaat</h3>' +
      '<div class="filters" id="verslag-filters"><button data-filter="alle" aria-pressed="true">Alle ' + zichtbaar.length + '</button>' +
        aanwezig.map(function (k) { return '<button data-filter="' + esc(k) + '" aria-pressed="false">' + ST_ICO[k] + ' ' + tel[k] + ' ' + esc(k) + '</button>'; }).join('') + '</div>' +
      '<ul class="verslag">' + zichtbaar.map(function (v) {
        var st = v.status.replace(' ', '-');
        var actie = v.knop && v.status !== 'ingevuld' && v.status !== 'overgeslagen' ? '<button data-dialoog="' + v.index + '" title="Opent de Portbase-dialoog met de zoekterm (ook gekopieerd)">Zoek in Portbase</button>' :
          (v.status === 'handmatig' || v.status === 'niet gevonden' ? (v.waarde ? '<button data-kopie="' + esc(v.waarde) + '">Kopieer</button>' : '') : '');
        return '<li class="st-' + esc(st) + '" data-status="' + esc(v.status) + '"><span class="v-ico" title="' + esc(v.status) + '">' + (ST_ICO[v.status] || '•') + '</span>' +
          '<span class="v-tekst"><span class="sec">' + esc(v.sectie) + '</span> – ' + esc(v.naam) + ': ' + esc(v.waarde) + (v.melding ? ' <span class="muted">(' + esc(v.melding) + ')</span>' : '') + '</span>' +
          (actie ? '<span class="v-acties">' + actie + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    pasFilterToe();
  }

  function pasFilterToe() {
    Array.prototype.forEach.call(shadow.querySelectorAll('#verslag-filters button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === verslagFilter)); });
    Array.prototype.forEach.call(shadow.querySelectorAll('#ai-verslag .verslag li'), function (li) { li.hidden = verslagFilter !== 'alle' && li.getAttribute('data-status') !== verslagFilter; });
  }

  /** "Zoek in Portbase" in het verslag: opent het venster met de zoekterm (en trefwoorden) en markeert de kandidaten. */
  function zoekOpnieuw(t, index) {
    var r = laatsteVerslag[index];
    var zoek = r.zoek || { term: r.zoekterm };
    if (navigator.clipboard) navigator.clipboard.writeText(zoek.term || r.waarde).catch(function () {});
    t.disabled = true;
    t.textContent = 'Zoeken…';
    FILL.instellen(Object.assign(vulOpties(), { status: function (s) { t.textContent = s ? 'Zoeken… ' + (s.match(/\((\d+)s\)/) || ['', ''])[1] : 'Zoeken…'; } }));
    FILL.zoekInDialoog(r.knop, zoek).then(function (res) {
      t.disabled = false;
      t.textContent = 'Opnieuw zoeken';
      var m = t.parentElement.querySelector('.dlg-melding') || t.parentElement.appendChild(document.createElement('div'));
      m.className = 'dlg-melding ' + (res.gekozen ? '' : 'muted');
      m.style.color = res.gekozen ? '#16794c' : '';
      m.textContent = (res.gekozen ? '✓ ' : '') + (res.melding || '') + (res.gekozen ? ' – klik Save in het venster' : '');
    });
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
