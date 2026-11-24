/*
 * Content script voor de Portbase-pagina. Zwevend paneel (Shadow DOM, zodat de
 * CSS van Portbase en van het paneel elkaar niet raken) met twee tabbladen:
 *
 *  - Documentcheck: leest de declaratie uit de DOM en toont welke documenten
 *    vereist zijn / ontbreken.
 *  - AI invullen: Documenten -> Controleren -> Invullen. Twee weergaven:
 *      compact      één kolom naast het Portbase-formulier;
 *      werkruimte   drie kolommen: bronbestanden + documentviewer | GGB-velden |
 *                   aandachtspunten + documentcheck. Klik op een veld of bron en
 *                   de viewer toont het document op de juiste bladzijde.
 *    Aandachtspunten worden één voor één afgevinkt ("Gecontroleerd & akkoord").
 *    De zekerheidsbalk filtert op velden die echt gecontroleerd moeten worden.
 *    Smart Memory (js/geheugen.js) herkent vaste routes (exporteur -> ontvanger),
 *    past eerder vaker gemaakte correcties toe en biedt recente patronen als
 *    sjabloon aan. Alles blijft lokaal (chrome.storage.local).
 *
 * Extra: paneel links/rechts docken, in-/uitklappen met Alt+G, voorstel
 * exporteren als JSON en het laatste voorstel herstellen na herladen.
 */
(function () {
  'use strict';
  if (window.__ggbPanelLoaded) return;
  window.__ggbPanelLoaded = true;

  var ENGINE = window.GGB_ENGINE, RULES = window.GGB_RULES, PORTBASE = window.GGB_PORTBASE, RENDER = window.GGB_RENDER;
  var AI = window.GGB_AI, FILL = window.GGB_FILL, G = window.GGB_GEHEUGEN;
  var data = null, R = null, rules = RULES.DEFAULT_RULES;
  var host, shadow, body, statusEl, lastFp = '', collapsed = false, timer = null, lastDecl = null, tab = 'check', layout = 'compact';

  // AI-toestand
  var bestanden = [];       // File-objecten
  var aiResultaat = null;   // genormaliseerd voorstel (bewerkbaar)
  var aiOrigineel = null;   // het voorstel zoals de AI het gaf (vóór Smart Memory en correcties), om van te leren
  var aiTijd = null;        // moment van het voorstel
  var aiBezig = false;
  var vulBezig = false;
  var laatsteVerslag = [];  // verslag van de laatste invulronde (met knoppen voor zoekdialogen)
  var verslagFilter = 'alle';
  var zFilter = 'alle';     // zekerheidsfilter: alle | controle | laag
  var LAATSTE = 'ggb.ai.laatste'; // laatste voorstel (chrome.storage.local), om na herladen te herstellen
  var GEHEUGEN = 'ggb.geheugen';  // Smart Memory (chrome.storage.local)
  var geheugen = G.leeg();

  /* ======================= design system ======================= */

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box}[hidden]{display:none!important}',
    '.wrap{',
    '  --navy:#0a1f44;--navy-2:#123066;--pb:#1f4fd1;--pb-d:#1a42b0;--pb-z:#eef3ff;--pb-r:#cddafc;',
    '  --inkt:#0f172a;--inkt-2:#334155;--zacht:#64748b;--lijn:#e2e8f0;--lijn-2:#cbd5e1;--vlak:#f8fafc;--vlak-2:#f1f5f9;--wit:#fff;',
    '  --ok:#0f7b4f;--ok-z:#e8f6ef;--ok-r:#bfe6d2;--let:#a35a00;--let-z:#fff6e6;--let-r:#f5dcb0;--fout:#c0262d;--fout-z:#fdeeee;--fout-r:#f5c9cb;--mem:#6d3fd6;--mem-z:#f3eefe;--mem-r:#dccdfb;',
    '  --r1:6px;--r2:8px;--r3:12px;--sh1:0 1px 2px rgba(15,23,42,.06);--sh2:0 1px 3px rgba(15,23,42,.07),0 6px 16px rgba(15,23,42,.06);',
    '  --sh-paneel:0 24px 64px rgba(15,23,42,.26),0 2px 8px rgba(15,23,42,.08);--ease:cubic-bezier(.2,.8,.2,1);',
    '  position:fixed;right:16px;bottom:16px;width:520px;max-width:calc(100vw - 32px);height:min(88vh,960px);display:flex;flex-direction:column;background:var(--vlak);color:var(--inkt);',
    '  border:1px solid rgba(15,23,42,.12);border-radius:14px;box-shadow:var(--sh-paneel);font:13px/1.45 Inter,"Segoe UI Variable","Segoe UI",system-ui,-apple-system,sans-serif;',
    '  font-feature-settings:"tnum" 1,"cv11" 1;z-index:2147483000;overflow:hidden;interpolate-size:allow-keywords;transition:width .28s var(--ease),height .28s var(--ease)}',
    '.wrap[data-dock="links"]{right:auto;left:16px}',
    '.wrap[data-layout="werkruimte"]{width:min(1480px,calc(100vw - 32px));height:calc(100vh - 32px)}',
    '.wrap.collapsed{width:auto;height:auto}.wrap.collapsed .body,.wrap.collapsed .foot,.wrap.collapsed .tabs,.wrap.collapsed .hk-knop:not(#toggle),.wrap.collapsed #profiel-chip{display:none}',
    'svg.i{width:16px;height:16px;flex:none;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}svg.i.s{width:14px;height:14px}',
    /* app-balk */
    '.head{display:flex;align-items:center;gap:.65rem;padding:.55rem .6rem .55rem .75rem;background:linear-gradient(180deg,var(--navy-2),var(--navy));color:#fff;cursor:pointer;user-select:none;border-bottom:1px solid rgba(255,255,255,.06)}',
    '.logo{display:grid;place-items:center;width:28px;height:28px;background:linear-gradient(135deg,#3b6cf0,#1f4fd1);color:#fff;font-weight:800;border-radius:8px;font-size:.62rem;letter-spacing:.04em;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18)}',
    '.head .titel{flex:1 1 auto;min-width:118px;line-height:1.2}.head .titel b{display:block;font-size:.88rem;font-weight:650;letter-spacing:-.005em;white-space:nowrap}',
    '.head .titel small{display:block;color:rgba(255,255,255,.66);font-size:.72rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chip-profiel{display:inline-flex;align-items:center;gap:.35rem;flex:0 1 auto;min-width:0;max-width:340px;padding:.22rem .55rem .22rem .45rem;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:#fff;font:inherit;font-size:.72rem;font-weight:600;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chip-profiel>span:not(.n){min-width:0;overflow:hidden;text-overflow:ellipsis}.chip-profiel .n,.chip-profiel svg{flex:none}.chip-profiel:hover{background:rgba(255,255,255,.18)}.chip-profiel .n{background:#fff;color:var(--mem);border-radius:999px;padding:0 .4em;font-size:.66rem}',
    '.hk-knop{display:grid;place-items:center;width:28px;height:28px;background:transparent;border:1px solid transparent;color:rgba(255,255,255,.82);border-radius:7px;cursor:pointer;flex:none;transition:background .15s,color .15s}',
    '.hk-knop:hover{background:rgba(255,255,255,.12);color:#fff}.hk-knop[aria-pressed="true"]{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.2);color:#fff}',
    '.head .badge{background:rgba(255,255,255,.95)}',
    /* tabbladen */
    '.tabs{display:flex;gap:2px;margin:.5rem .6rem 0;padding:3px;background:var(--vlak-2);border:1px solid var(--lijn);border-radius:10px}',
    '.tabs button{flex:1;display:flex;align-items:center;justify-content:center;gap:.4rem;border:0;background:none;padding:.38rem .5rem;font:inherit;font-weight:600;font-size:.8rem;cursor:pointer;color:var(--zacht);border-radius:7px;transition:background .15s,color .15s,box-shadow .15s}',
    '.tabs button:hover{color:var(--inkt)}.tabs button.active{background:var(--wit);color:var(--inkt);box-shadow:var(--sh1),0 0 0 1px var(--lijn)}',
    '.tel{display:inline-block;min-width:1.5em;padding:0 .42em;border-radius:999px;font-size:.66rem;font-weight:700;line-height:1.6;background:var(--vlak-2);color:var(--zacht);text-align:center;border:1px solid var(--lijn)}.tel:empty{display:none}',
    '.tel.ok{background:var(--ok-z);color:var(--ok);border-color:var(--ok-r)}.tel.let,.tel.aandacht{background:var(--let-z);color:var(--let);border-color:var(--let-r)}.tel.fout,.tel.ontbreekt{background:var(--fout-z);color:var(--fout);border-color:var(--fout-r)}',
    '.tel.pop,.teller.pop{animation:pop .32s var(--ease)}@keyframes pop{40%{transform:scale(1.25)}}',
    /* lichaam */
    '.body{overflow:auto;padding:.7rem;flex:1;min-height:0;scroll-behavior:smooth}',
    '.wrap[data-layout="werkruimte"] #body>*{max-width:920px;margin-left:auto;margin-right:auto}',
    '.body::-webkit-scrollbar,.kol::-webkit-scrollbar{width:10px}.body::-webkit-scrollbar-thumb,.kol::-webkit-scrollbar-thumb{background:var(--lijn-2);border-radius:10px;border:3px solid var(--vlak)}',
    '.foot{border-top:1px solid var(--lijn);background:var(--wit);font-size:.78rem;color:var(--zacht)}',
    '.foot-rij{display:flex;gap:.5rem;justify-content:space-between;align-items:center;padding:.55rem .8rem}',
    /* knoppen en invoer */
    'button.btn{display:inline-flex;align-items:center;justify-content:center;gap:.38rem;font:inherit;font-weight:600;padding:.4rem .72rem;border-radius:var(--r2);border:1px solid var(--lijn);background:var(--wit);color:var(--inkt);cursor:pointer;box-shadow:var(--sh1);transition:background .15s,border-color .15s,transform .08s,box-shadow .15s}',
    'button.btn:hover{border-color:var(--lijn-2);background:var(--vlak)}button.btn:active{transform:translateY(1px)}',
    'button.btn.primary{background:var(--pb);border-color:var(--pb-d);color:#fff;box-shadow:0 1px 2px rgba(31,79,209,.3),inset 0 1px 0 rgba(255,255,255,.14)}button.btn.primary:hover{background:var(--pb-d)}',
    'button.btn.groot{width:100%;padding:.6rem;font-size:.88rem}button.btn.klein{padding:.22rem .55rem;font-size:.74rem}button.btn.kaal{border-color:transparent;background:transparent;box-shadow:none;color:var(--zacht)}button.btn.kaal:hover{background:var(--vlak-2);color:var(--inkt)}',
    'button.btn.gevaar{color:var(--fout);border-color:var(--fout-r)}button.btn.gevaar:hover{background:var(--fout-z)}',
    'button.btn.ok{color:var(--ok);border-color:var(--ok-r);background:var(--ok-z)}button.btn.ok:hover{background:#dcf1e6}',
    'button:disabled{opacity:.5;cursor:default!important;transform:none!important}button.btn[aria-pressed="true"]{background:var(--pb-z);border-color:var(--pb-r);color:var(--pb)}',
    'button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--pb);outline-offset:2px}',
    'button.link{border:0;background:none;color:var(--pb);cursor:pointer;font:inherit;padding:0;font-weight:600}button.link:hover{text-decoration:underline;text-underline-offset:2px}',
    'a{color:var(--pb)}textarea,input,select{font:inherit;color:var(--inkt)}',
    'textarea{width:100%;min-height:3.4em;padding:.45rem .55rem;border:1px solid var(--lijn);border-radius:var(--r2);resize:vertical;background:var(--wit);box-shadow:var(--sh1)}',
    'textarea:focus,input:focus,select:focus{outline:none;border-color:var(--pb)!important;box-shadow:0 0 0 3px rgba(31,79,209,.14)}',
    '.muted{color:var(--zacht)}.small{font-size:.76rem}p{margin:.25rem 0 .6rem}ul{margin:.3rem 0 0;padding-left:1.2rem}h3{font-size:.82rem;font-weight:650;margin:.2rem 0 .5rem;letter-spacing:-.005em}',
    /* badges en meldingen */
    '.badge{display:inline-flex;align-items:center;gap:.25rem;font:inherit;font-size:.64rem;font-weight:700;padding:.1rem .45rem;border-radius:999px;text-transform:uppercase;letter-spacing:.04em;vertical-align:middle;white-space:nowrap;border:1px solid transparent}',
    '.badge.ok,.badge.ingevuld,.badge.hoog{background:var(--ok-z);color:var(--ok);border-color:var(--ok-r)}.badge.aandacht,.badge.handmatig,.badge.middel{background:var(--let-z);color:var(--let);border-color:var(--let-r)}',
    '.badge.ontbreekt,.badge.fout,.badge.verplicht,.badge.laag{background:var(--fout-z);color:var(--fout);border-color:var(--fout-r)}.badge.info,.badge.overgeslagen{background:var(--pb-z);color:var(--pb);border-color:var(--pb-r)}.badge.niet-gevonden{background:var(--vlak-2);color:var(--zacht)}',
    '.badge.mem{background:var(--mem-z);color:var(--mem);border-color:var(--mem-r)}',
    'button.badge{cursor:pointer}button.badge:hover{filter:brightness(.96);box-shadow:0 0 0 2px rgba(31,79,209,.12)}',
    '.melding{padding:.5rem .65rem;border-radius:var(--r2);font-size:.8rem;margin-bottom:.4rem;border:1px solid transparent}.melding.info{background:var(--pb-z);color:#183c9e;border-color:var(--pb-r)}',
    '.melding.aandacht{background:var(--let-z);color:#7a4300;border-color:var(--let-r)}.melding.ontbreekt,.melding.fout{background:var(--fout-z);color:var(--fout);border-color:var(--fout-r)}.melding.ok{background:var(--ok-z);color:var(--ok);border-color:var(--ok-r)}',
    /* documentcheck (gedeelde weergave uit render.js) */
    '.card{background:var(--wit);border:1px solid var(--lijn);border-radius:var(--r3);padding:.7rem .75rem;border-left:4px solid var(--lijn);box-shadow:var(--sh1)}.card.ok{border-left-color:var(--ok)}.card.aandacht{border-left-color:var(--let)}.card.ontbreekt,.card.fout{border-left-color:var(--fout)}',
    '.card .head{background:none;color:inherit;padding:0 0 .45rem;cursor:default;display:flex;justify-content:space-between;gap:.5rem;user-select:text;border:0}',
    '.item{border-top:1px solid var(--lijn);padding-top:.55rem;margin-top:.55rem}.item-title{font-weight:600;margin-bottom:.4rem}.item-title span{font-weight:400;color:var(--zacht)}',
    '.req{border:1px solid var(--lijn);border-left-width:3px;border-radius:var(--r2);padding:.45rem .6rem;margin-bottom:.4rem;font-size:.8rem;background:var(--wit)}.req.ok{border-left-color:var(--ok)}.req.aandacht{border-left-color:var(--let)}.req.ontbreekt,.req.fout{border-left-color:var(--fout)}.req.verplicht-info{border-left-color:var(--pb)}',
    '.req .title{font-weight:600}.req .title .code{font-weight:400;color:var(--zacht);font-size:.74rem}.req ul{font-size:.78rem}.req .bron{font-size:.72rem;color:var(--zacht);margin-top:.25rem}',
    '.src{display:inline-block;font-size:.62rem;padding:0 .35rem;border-radius:4px;border:1px solid var(--lijn);color:var(--zacht);margin-left:.25rem;vertical-align:middle}.src.taric{border-color:var(--pb-r);color:var(--pb);background:var(--pb-z)}',
    '.chip{display:inline-block;background:var(--vlak-2);border-radius:5px;padding:0 .35em;margin:0 .15em .15em 0;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:.72rem}',
    'details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}',
    '.taric{margin-top:.5rem}.taric>summary{font-weight:600;font-size:.8rem;color:var(--pb)}.taric>summary::before{content:"▸ "}.taric[open]>summary::before{content:"▾ "}',
    '.taric-m{border:1px solid var(--lijn);border-radius:var(--r2);padding:.4rem .6rem;margin:.4rem 0;font-size:.78rem;background:var(--wit)}.taric-m .t{font-weight:600}.taric-m .t .muted{font-weight:400}.cert{font-family:ui-monospace,Consolas,monospace;background:var(--vlak-2);padding:0 .3em;border-radius:3px}',
    '.gn-descr{font-size:.78rem;color:var(--zacht);margin-bottom:.4rem}',
    '.empty{display:flex;flex-direction:column;align-items:center;gap:.35rem;text-align:center;padding:2rem 1rem;color:var(--zacht)}.empty b{color:var(--inkt)}.empty svg.i{width:26px;height:26px;color:var(--lijn-2);margin-bottom:.2rem}',
    /* AI-tabblad: kop met stappen + dossierbalk, daaronder de werkruimte */
    '.ai{display:flex;flex-direction:column;padding:0;overflow:hidden}',
    '.ai-top{padding:.6rem .7rem .5rem;display:flex;flex-direction:column;gap:.5rem;border-bottom:1px solid var(--lijn);background:var(--wit)}',
    '.stepper{display:flex;list-style:none;margin:0;padding:0;gap:.25rem}',
    '.stepper li{flex:1;display:flex;align-items:center;gap:.4rem;padding:.32rem .5rem;border-radius:var(--r2);color:var(--zacht);font-weight:600;font-size:.74rem;cursor:pointer;transition:background .15s,color .15s}',
    '.stepper li:hover{background:var(--vlak-2)}.stepper li span{display:grid;place-items:center;width:18px;height:18px;border-radius:50%;border:1.5px solid var(--lijn-2);color:var(--zacht);font-size:.64rem;flex:none}',
    '.stepper li:not(:last-child)::after{content:"";flex:1;height:1px;background:var(--lijn);margin-left:.3rem}',
    '.stepper li.actief{color:var(--pb)}.stepper li.actief span{background:var(--pb);border-color:var(--pb);color:#fff;box-shadow:0 0 0 3px var(--pb-z)}',
    '.stepper li.klaar{color:var(--ok)}.stepper li.klaar span{background:var(--ok);border-color:var(--ok);color:#fff;font-size:0}.stepper li.klaar span::after{content:"✓";font-size:.66rem}',
    '.ws{flex:1;min-height:0;display:flex;flex-direction:column;gap:.65rem;padding:.65rem;overflow:auto}',
    '.kol{display:flex;flex-direction:column;gap:.65rem;min-width:0}.kol-bron{order:1}.kol-aandacht{order:2}.kol-velden{order:3}',
    '.ws[data-leeg="1"] .kol-aandacht{display:none}.viewer-kaart{display:none}',
    '.wrap[data-layout="werkruimte"] .ws{display:grid;grid-template-columns:minmax(320px,36%) minmax(0,1fr) minmax(280px,320px);overflow:hidden;padding:0;gap:0}',
    '.wrap[data-layout="werkruimte"] .kol{overflow:auto;padding:.65rem;min-height:0}',
    '.wrap[data-layout="werkruimte"] .kol-bron{background:var(--vlak-2);border-right:1px solid var(--lijn)}.wrap[data-layout="werkruimte"] .kol-aandacht{border-left:1px solid var(--lijn);background:var(--wit)}',
    '.wrap[data-layout="werkruimte"] .ws[data-leeg="1"] .kol-aandacht{display:flex}.wrap[data-layout="werkruimte"] .viewer-kaart{display:flex}',
    '.wrap[data-layout="werkruimte"] .kol-bron,.wrap[data-layout="werkruimte"] .kol-velden,.wrap[data-layout="werkruimte"] .kol-aandacht{order:0}',
    /* kaarten */
    '.kaart{border:1px solid var(--lijn);border-radius:var(--r3);padding:.75rem;background:var(--wit);box-shadow:var(--sh1)}',
    '.kaart-kop{display:flex;justify-content:space-between;align-items:center;gap:.5rem;margin-bottom:.6rem}.kaart-kop h3{margin:0;display:flex;align-items:center;gap:.4rem}',
    'details.kaart>summary{display:flex;align-items:center;gap:.45rem;font-weight:650;font-size:.82rem;margin:-.1rem 0}details.kaart>summary .rechts{margin-left:auto;display:flex;gap:.35rem;align-items:center;font-weight:400}',
    'details.kaart>summary::after{content:"";width:7px;height:7px;border:solid var(--zacht);border-width:0 1.5px 1.5px 0;transform:rotate(45deg);margin:0 .2rem 0 .1rem;transition:transform .2s var(--ease)}details.kaart[open]>summary::after{transform:rotate(-135deg)}',
    'details.kaart[open]>summary{margin-bottom:.6rem}',
    '.via{display:flex;gap:.5rem;align-items:center;font-size:.76rem;color:var(--zacht)}.via b{color:var(--inkt)}',
    '.modus{display:flex;padding:3px;background:var(--vlak-2);border:1px solid var(--lijn);border-radius:9px;margin-bottom:.6rem}.modus button{flex:1;border:0;background:none;padding:.32rem;font:inherit;font-size:.78rem;font-weight:600;cursor:pointer;color:var(--zacht);border-radius:6px;transition:background .15s,color .15s}',
    '.modus button[aria-pressed="true"]{background:var(--wit);color:var(--inkt);box-shadow:var(--sh1),0 0 0 1px var(--lijn)}',
    '.drop{display:flex;flex-direction:column;align-items:center;gap:.2rem;border:1.5px dashed var(--lijn-2);border-radius:var(--r3);padding:.95rem .8rem;text-align:center;color:var(--zacht);background:var(--vlak);transition:background .15s,border-color .15s}',
    '.drop.over{background:var(--pb-z);border-color:var(--pb)}.drop svg.i{width:22px;height:22px;color:var(--pb)}.drop b{color:var(--inkt)}.drop label{color:var(--pb);cursor:pointer;font-weight:600}.drop label:hover{text-decoration:underline}.drop input{display:none}',
    '.files{list-style:none;padding:0;margin:.55rem 0;display:flex;flex-direction:column;gap:.3rem}.files:empty{display:none}',
    '.files li{display:flex;align-items:center;gap:.5rem;padding:.32rem .45rem;border:1px solid var(--lijn);border-radius:var(--r2);font-size:.78rem;background:var(--wit);animation:in .22s var(--ease)}',
    '@keyframes in{from{opacity:0;transform:translateY(-3px)}}',
    '.files .ft{font-size:.6rem;font-weight:800;padding:.08rem .3rem;border-radius:4px;background:var(--fout-z);color:var(--fout)}.files .ft.img{background:var(--pb-z);color:var(--pb)}',
    '.files .fn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.files button{display:grid;place-items:center;border:0;background:none;color:var(--zacht);cursor:pointer;border-radius:5px;padding:2px}.files button:hover{color:var(--fout);background:var(--fout-z)}',
    '.files li.melding{display:block}',
    '#ctx{margin:.2rem 0 .6rem}.status-regel{margin-top:.5rem;min-height:1.1em}.status-regel:empty{display:none}',
    '.stappen{padding-left:1.2rem;margin:.4rem 0 .6rem;font-size:.8rem}.stappen li{margin:.35rem 0}',
    'textarea.json{min-height:7em;font-family:ui-monospace,Consolas,monospace;font-size:.74rem}.row-actions{display:flex;gap:.5rem;align-items:center;margin:.5rem 0;flex-wrap:wrap}',
    /* documentviewer */
    '.viewer-kaart{flex:1;min-height:420px;flex-direction:column;padding:0;overflow:hidden}',
    '.viewer-kop{display:flex;align-items:center;gap:.4rem;padding:.45rem .55rem;border-bottom:1px solid var(--lijn);background:var(--wit);min-width:0}',
    '.viewer-tabs{display:flex;gap:.25rem;overflow-x:auto;flex:1;min-width:0;scrollbar-width:none}',
    '.viewer-tabs button{display:inline-flex;align-items:center;gap:.3rem;flex:none;max-width:180px;padding:.2rem .5rem;border:1px solid var(--lijn);border-radius:999px;background:var(--wit);font:inherit;font-size:.72rem;font-weight:600;color:var(--zacht);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:all .15s}',
    '.viewer-tabs button[aria-pressed="true"]{background:var(--pb-z);border-color:var(--pb-r);color:var(--pb)}',
    '.viewer-pagina{font-size:.7rem;color:var(--zacht);white-space:nowrap}',
    '.viewer-frame{flex:1;min-height:0;background:#e9edf3}.viewer-frame iframe{display:block;width:100%;height:100%;border:0}',
    '.viewer-kaart.flits{animation:flits .6s var(--ease)}@keyframes flits{30%{box-shadow:0 0 0 3px rgba(31,79,209,.35)}}',
    /* dossierbalk */
    '.feiten{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.35rem}',
    '.wrap[data-layout="werkruimte"] .feiten{grid-template-columns:repeat(8,minmax(0,1fr))}',
    '.feit{background:var(--vlak);border:1px solid var(--lijn);border-radius:var(--r2);padding:.32rem .5rem;min-width:0}',
    '.feit small{display:block;color:var(--zacht);font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;font-weight:700}.feit b{display:block;font-size:.78rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dossier-rij{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}.dossier-rij .knoppen{display:flex;gap:.3rem;align-items:center;margin-left:auto}',
    '.dnr{display:inline-flex;align-items:center;gap:.3rem;font-size:.72rem;color:var(--zacht);font-weight:600}.dnr input{width:92px;padding:.2rem .4rem;border:1px solid var(--lijn);border-radius:var(--r1);font-size:.76rem}',
    /* zekerheidsfilter */
    '.zeker{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}',
    '.zbalk{display:flex;width:64px;height:6px;border-radius:9px;overflow:hidden;background:var(--vlak-2)}.zbalk i{display:block}.zbalk .h{background:#2fa36b}.zbalk .m{background:#e0a03a}.zbalk .l{background:#e0625a}',
    '.seg{display:inline-flex;padding:2px;background:var(--vlak-2);border:1px solid var(--lijn);border-radius:8px}',
    '.seg button{display:inline-flex;align-items:center;gap:.3rem;border:0;background:none;padding:.18rem .5rem;font:inherit;font-size:.72rem;font-weight:600;color:var(--zacht);border-radius:6px;cursor:pointer;transition:background .15s,color .15s}',
    '.seg button b{font-weight:700;color:var(--inkt-2)}.seg button[aria-pressed="true"]{background:var(--wit);color:var(--inkt);box-shadow:var(--sh1),0 0 0 1px var(--lijn)}',
    '.seg button .dot{width:6px;height:6px;border-radius:50%}',
    /* blokken (accordion met animatie) */
    '.blok{border:1px solid var(--lijn);border-radius:var(--r3);background:var(--wit);overflow:hidden;box-shadow:var(--sh1)}',
    '.blok::details-content{block-size:0;overflow:hidden;transition:block-size .26s var(--ease),content-visibility .26s allow-discrete}.blok[open]::details-content{block-size:auto}',
    '.blok>summary{display:flex;align-items:center;gap:.45rem;padding:.55rem .7rem;font-weight:650;font-size:.82rem;transition:background .15s}.blok>summary:hover{background:var(--vlak)}',
    '.blok>summary::before{content:"";width:6px;height:6px;border:solid var(--zacht);border-width:0 1.5px 1.5px 0;transform:rotate(-45deg);margin:0 .25rem 0 .1rem;transition:transform .2s var(--ease)}.blok[open]>summary::before{transform:rotate(45deg)}',
    '.blok[open]>summary{border-bottom:1px solid var(--lijn)}.blok>summary .rechts{margin-left:auto;display:flex;gap:.3rem;align-items:center;font-weight:400}.blok .inhoud{padding:.55rem .7rem}',
    '#voorstel{display:flex;flex-direction:column;gap:.6rem}',
    '.groep{border:1px solid var(--lijn);border-radius:var(--r2);padding:.4rem .55rem;margin:.45rem 0;background:var(--wit)}.groep:first-child{margin-top:0}.groep .gt{display:flex;align-items:center;gap:.4rem;font-weight:650;font-size:.78rem;margin-bottom:.3rem}',
    'table.velden{width:100%;border-collapse:collapse;font-size:.78rem}table.velden td{padding:.2rem .25rem;border-bottom:1px solid var(--vlak-2);vertical-align:middle}table.velden tr:last-child td{border-bottom:0}',
    'table.velden td.l{color:var(--zacht);width:40%}table.velden td.z{width:1%;text-align:right;white-space:nowrap}',
    'table.velden select{width:100%;font-size:.76rem;padding:.24rem;border:1px solid var(--lijn);border-radius:var(--r1);background:var(--wit)}',
    'table.velden input:not([type="checkbox"]){width:100%;padding:.26rem .42rem;border:1px solid var(--lijn);border-left:3px solid var(--lijn);border-radius:var(--r1);background:var(--wit);transition:border-color .15s,box-shadow .15s,background .15s}',
    'input.z-hoog{border-left-color:#2fa36b!important}input.z-middel{border-left-color:#e0a03a!important;background:#fffcf5!important}input.z-laag{border-left-color:#e0625a!important;background:#fff8f8!important}',
    'input.z-mem{border-left-color:var(--mem)!important;background:#fbf9ff!important}',
    'tr.doel td{background:var(--pb-z)}tr.doel input{box-shadow:0 0 0 3px rgba(31,79,209,.18)}',
    '.datum-hint{display:block;font-size:.68rem;color:var(--pb);margin-top:.1rem}.datum-hint:empty{display:none}',
    '#voorstel.f-controle tr[data-z="hoog"],#voorstel.f-controle .groep[data-z="hoog"],#voorstel.f-laag tr[data-z="hoog"],#voorstel.f-laag tr[data-z="middel"],#voorstel.f-laag .groep[data-z="hoog"],#voorstel.f-laag .groep[data-z="middel"]{display:none}',
    '.badge.samen{background:#fff1d6;color:#8a4b00;border:1px solid #f3cf8a;text-transform:none;letter-spacing:0}',
    '.geleerd{padding:.3rem .25rem .1rem;font-size:.76rem;line-height:1.5}.geleerd:empty{display:none}.geleerd .badge{margin-right:.2rem}',
    '.uit .groep{opacity:.55}.uit .groep .gt .dn{text-decoration:line-through}',
    '.herstel{display:flex;align-items:center;gap:.5rem;justify-content:space-between}',
    /* Smart Memory: profiel + patronen */
    '.profiel{border-color:var(--mem-r);background:linear-gradient(180deg,#fcfaff,#fff)}',
    '.profiel .kaart-kop h3{color:var(--mem)}.profiel .route{font-weight:650;font-size:.82rem}.profiel .meta{font-size:.74rem;color:var(--zacht);margin-top:.1rem}',
    '.regels{list-style:none;padding:0;margin:.55rem 0 0;display:flex;flex-direction:column;gap:.3rem}',
    '.regels li{display:flex;align-items:center;gap:.5rem;padding:.35rem .5rem;border:1px solid var(--mem-r);border-radius:var(--r2);background:var(--wit);font-size:.76rem}',
    '.regels li .w{flex:1;min-width:0}.regels li .w b{font-weight:600}.regels li .w code{font-family:ui-monospace,Consolas,monospace;font-size:.72rem;background:var(--vlak-2);padding:0 .25em;border-radius:3px}',
    '.regels li.terug{opacity:.6}.regels li.terug .w{text-decoration:line-through}',
    '.patronen{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.4rem}',
    '.patroon{display:flex;align-items:center;gap:.6rem;padding:.55rem .6rem;border:1px solid var(--lijn);border-radius:var(--r2);background:var(--wit);transition:border-color .15s,box-shadow .15s}',
    '.patroon:hover{border-color:var(--pb-r);box-shadow:var(--sh2)}.patroon .av{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--mem-z);color:var(--mem);font-weight:750;font-size:.7rem;flex:none}',
    '.patroon .w{flex:1;min-width:0}.patroon .w b{display:block;font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.patroon .w span{display:block;font-size:.72rem;color:var(--zacht);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.beheer{display:flex;gap:.4rem;align-items:center;margin-top:.6rem;font-size:.72rem;color:var(--zacht)}.beheer input{display:none}',
    /* aandachtspunten-triage */
    '.triage .teller{display:inline-block;font-size:.72rem;font-weight:700;color:var(--zacht)}.triage .teller b{color:var(--inkt)}',
    '.tvoortgang{height:4px;border-radius:9px;background:var(--vlak-2);overflow:hidden;margin:-.2rem 0 .6rem}.tvoortgang i{display:block;height:100%;background:linear-gradient(90deg,#2fa36b,#0f7b4f);transition:width .4s var(--ease)}',
    '.tp-lijst{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:.35rem}',
    '.tp{display:grid;grid-template-rows:1fr;transition:grid-template-rows .26s var(--ease),opacity .2s,transform .26s var(--ease);animation:in .22s var(--ease)}',
    '.tp>div{overflow:hidden;min-height:0}.tp.weg{grid-template-rows:0fr;opacity:0;transform:translateX(12px)}',
    '.tp-kaart{display:flex;gap:.5rem;align-items:flex-start;padding:.5rem .55rem;border:1px solid var(--lijn);border-left:3px solid var(--let);border-radius:var(--r2);background:var(--wit)}',
    '.tp.kritiek .tp-kaart{border-left-color:var(--fout)}.tp.info .tp-kaart{border-left-color:var(--pb)}',
    '.tp-ico{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;flex:none;background:var(--let-z);color:var(--let)}.tp.kritiek .tp-ico{background:var(--fout-z);color:var(--fout)}.tp.info .tp-ico{background:var(--pb-z);color:var(--pb)}',
    '.tp-tekst{flex:1;min-width:0;font-size:.77rem;line-height:1.4}.tp-meta{display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.3rem}',
    '.tp-acties{display:flex;flex-direction:column;gap:.25rem;align-items:flex-end;flex:none}',
    '.tp-klaar{margin-top:.6rem;border-top:1px solid var(--lijn);padding-top:.5rem}.tp-klaar>summary{font-size:.74rem;font-weight:650;color:var(--zacht);display:flex;align-items:center;gap:.35rem}',
    '.tp-klaar ul{list-style:none;padding:0;margin:.4rem 0 0;display:flex;flex-direction:column;gap:.25rem}',
    '.tp-klaar li{display:flex;gap:.45rem;align-items:flex-start;font-size:.74rem;color:var(--zacht);padding:.3rem .4rem;border-radius:var(--r1);background:var(--vlak);animation:in .22s var(--ease)}',
    '.tp-klaar li .v{color:var(--ok);flex:none;margin-top:.05rem}.tp-klaar li .t{flex:1;min-width:0}.tp-klaar li .acties{display:flex;flex-direction:column;align-items:flex-end;gap:.15rem;flex:none}',
    '.schoon{display:flex;align-items:center;gap:.6rem;padding:.6rem .65rem;border:1px solid var(--ok-r);background:var(--ok-z);color:var(--ok);border-radius:var(--r2);font-size:.8rem;font-weight:600;animation:in .3s var(--ease)}',
    '.schoon .rond{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--ok);color:#fff;flex:none}',
    /* skeleton tijdens uitlezen */
    '.skelet{display:flex;flex-direction:column;gap:.5rem}.skelet i{display:block;height:34px;border-radius:var(--r2);background:linear-gradient(90deg,var(--vlak-2),#fff,var(--vlak-2));background-size:200% 100%;animation:shim 1.2s linear infinite}',
    '@keyframes shim{to{background-position:-200% 0}}',
    /* invulbalk (voet) */
    '.vul{padding:.6rem .8rem;display:flex;flex-direction:column;gap:.45rem}',
    '.vul-rij{display:flex;align-items:center;gap:.5rem;justify-content:space-between;flex-wrap:wrap}',
    '.vul-opties{display:flex;gap:.7rem;flex-wrap:wrap;font-size:.74rem;color:var(--inkt)}.vul-opties label{display:inline-flex;gap:.3rem;align-items:center;cursor:pointer}',
    '.vul-knoppen{display:flex;gap:.4rem;margin-left:auto}',
    '.pil{display:inline-flex;align-items:center;gap:.25rem;font-size:.68rem;font-weight:700;color:var(--pb);background:var(--pb-z);padding:.08rem .45rem;border-radius:999px}',
    '.voortgang{display:flex;flex-direction:column;gap:.25rem}.voortgang .balk{height:5px;border-radius:9px;background:var(--vlak-2);overflow:hidden}.voortgang .balk i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--pb),#4f7cf0);transition:width .3s var(--ease)}',
    '.voortgang span{font-size:.74rem;color:var(--inkt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    /* verslag */
    '.filters{display:flex;gap:.3rem;flex-wrap:wrap;margin:.2rem 0 .5rem}.filters button{font:inherit;font-size:.72rem;font-weight:600;padding:.16rem .55rem;border-radius:999px;border:1px solid var(--lijn);background:var(--wit);cursor:pointer;color:var(--inkt)}.filters button[aria-pressed="true"]{background:var(--inkt);border-color:var(--inkt);color:#fff}',
    '.verslag{list-style:none;padding:0;margin:0;border:1px solid var(--lijn);border-radius:var(--r3);overflow:hidden;background:var(--wit)}',
    '.verslag li{display:flex;gap:.5rem;align-items:flex-start;padding:.4rem .55rem;border-bottom:1px solid var(--vlak-2);font-size:.77rem}.verslag li:last-child{border-bottom:0}',
    '.v-ico{flex:none;display:grid;place-items:center;width:18px;height:18px;border-radius:50%;font-size:.64rem;font-weight:800;margin-top:.05rem}',
    '.st-ingevuld .v-ico{background:var(--ok-z);color:var(--ok)}.st-handmatig .v-ico{background:var(--let-z);color:var(--let)}.st-fout .v-ico,.st-niet-gevonden .v-ico{background:var(--fout-z);color:var(--fout)}.st-overgeslagen .v-ico{background:var(--pb-z);color:var(--pb)}',
    '.v-tekst{flex:1;min-width:0;word-break:break-word}.v-tekst .sec{color:var(--zacht);font-weight:600}.v-acties{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:.2rem;max-width:45%}',
    '.v-acties button{font:inherit;font-size:.7rem;font-weight:600;padding:.12rem .45rem;border:1px solid var(--lijn);border-radius:var(--r1);background:var(--wit);cursor:pointer;color:var(--pb);white-space:nowrap}.v-acties button:hover{border-color:var(--pb)}',
    '.dlg-melding{font-size:.7rem;text-align:right}',
    '.spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--pb-r);border-top-color:var(--pb);border-radius:50%;animation:sp .8s linear infinite;vertical-align:middle}@keyframes sp{to{transform:rotate(360deg)}}',
    '.kbd{font-family:ui-monospace,Consolas,monospace;font-size:.66rem;border:1px solid var(--lijn);border-bottom-width:2px;border-radius:4px;padding:0 .3rem;background:var(--wit);color:var(--zacht)}',
    /* toasts */
    '.toasts{position:absolute;left:50%;bottom:76px;transform:translateX(-50%);display:flex;flex-direction:column;gap:.35rem;align-items:center;pointer-events:none;z-index:5;width:max-content;max-width:calc(100% - 32px)}',
    '.toast{display:flex;align-items:center;gap:.45rem;padding:.45rem .75rem;border-radius:var(--r2);background:var(--navy);color:#fff;font-size:.78rem;font-weight:600;box-shadow:0 10px 30px rgba(15,23,42,.3);animation:toast-in .26s var(--ease)}',
    '.toast.ok svg{color:#5ee0a0}.toast.mem svg{color:#c4b0ff}.toast.weg{opacity:0;transform:translateY(6px);transition:opacity .25s,transform .25s}',
    '@keyframes toast-in{from{opacity:0;transform:translateY(8px) scale(.98)}}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}'
  ].join('\n');

  /* Iconen (lijn, 24x24, currentColor) */
  var ICO = {
    kolommen: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
    dock: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
    min: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="M5 12.5l4.2 4.2L19 7"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    mem: '<path d="M12 3l1.8 4.6L18.5 9l-4.7 1.5L12 15l-1.8-4.5L5.5 9l4.7-1.4z"/><path d="M19 15l.8 2.1L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.9z"/>',
    let: '<path d="M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    kritiek: '<path d="M7.9 2.5h8.2l5.4 5.4v8.2l-5.4 5.4H7.9l-5.4-5.4V7.9z"/><path d="M12 8v4M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    kopie: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    terug: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    oog: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    omlaag: '<path d="M12 5v14M6 13l6 6 6-6"/>', nieuw: '<path d="M12 5v14M5 12h14"/>',
    ververs: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', extern: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'
  };
  function ico(n, klein) { return '<svg class="i' + (klein ? ' s' : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICO[n] || '') + '</svg>'; }

  function esc(s) { return RENDER.esc(s); }
  function $(id) { return shadow.getElementById(id); }
  function alle(sel, ctx) { return Array.prototype.slice.call((ctx || shadow).querySelectorAll(sel)); }
  function bewaarLokaal(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* negeren */ } }
  function leesLokaal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /** Korte melding onderin het paneel (kopiëren, exporteren, Smart Memory). */
  function toast(tekst, soort) {
    var box = $('toasts');
    if (!box || alle('.toast:not(.weg) span', box).some(function (s) { return s.textContent === tekst; })) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (soort || 'ok');
    t.innerHTML = ico(soort === 'mem' ? 'mem' : soort === 'info' ? 'info' : 'check', true) + '<span>' + esc(tekst) + '</span>';
    box.appendChild(t);
    setTimeout(function () { t.classList.add('weg'); setTimeout(function () { t.remove(); }, 300); }, 2400);
  }
  function kopieer(tekst, melding) {
    return navigator.clipboard.writeText(tekst).then(function () { toast(melding || 'Gekopieerd naar het klembord'); return true; },
      function () { toast('Kopiëren mislukt; sta het klembord toe voor deze pagina.', 'info'); return false; });
  }

  /* ======================= paneel ======================= */

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
      '<header class="head" id="head"><span class="logo">GGB</span><div class="titel"><b>GGB-assistent</b><small id="sub">Documentcheck en AI invullen</small></div>' +
        '<button class="chip-profiel" id="profiel-chip" hidden></button><span id="status"></span>' +
        '<button class="hk-knop" id="layout" title="Werkruimte: document, velden en aandachtspunten naast elkaar" aria-pressed="false">' + ico('kolommen') + '</button>' +
        '<button class="hk-knop" id="dock" title="Paneel naar de andere kant">' + ico('dock') + '</button>' +
        '<button class="hk-knop" id="toggle" title="In-/uitklappen (Alt+G)">' + ico('min') + '</button></header>' +
      '<nav class="tabs"><button id="tab-check" class="active">Documentcheck <span class="tel" id="tel-check"></span></button><button id="tab-ai">AI invullen <span class="tel" id="tel-ai"></span></button></nav>' +
      '<div class="body" id="body"><div class="empty">' + ico('doc') + 'Open een declaratie om de documentcheck te zien.</div></div>' +
      '<div class="body ai" id="ai-body" hidden>' + aiHtml() + '</div>' +
      '<div class="foot" id="foot-check"><div class="foot-rij"><span id="foot-info"></span><span><button class="btn klein" id="refresh">' + ico('ververs', true) + ' Vernieuwen</button> <button class="btn klein primary" id="open">Openen in tool ' + ico('extern', true) + '</button></span></div></div>' +
      '<div class="foot" id="foot-ai" hidden></div>' +
      '<div class="toasts" id="toasts" role="status" aria-live="polite"></div>';
    shadow.appendChild(wrap);
    body = $('body');
    statusEl = $('status');
    $('toggle').addEventListener('click', function (e) { e.stopPropagation(); setCollapsed(!collapsed); });
    $('dock').addEventListener('click', function (e) { e.stopPropagation(); zetDock(wrap.getAttribute('data-dock') === 'links' ? 'rechts' : 'links'); });
    $('layout').addEventListener('click', function (e) { e.stopPropagation(); zetLayout(layout === 'werkruimte' ? 'compact' : 'werkruimte'); });
    $('profiel-chip').addEventListener('click', function (e) { e.stopPropagation(); setTab('ai'); var p = $('profiel'); if (p) p.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
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
    zetLayout(leesLokaal('ggb.panel.layout') === 'werkruimte' ? 'werkruimte' : 'compact');
    setCollapsed(leesLokaal('ggb.panel.collapsed') === '1');
    if (leesLokaal('ggb.panel.tab') === 'ai') setTab('ai');
  }

  function zetDock(kant) {
    shadow.querySelector('.wrap').setAttribute('data-dock', kant);
    bewaarLokaal('ggb.panel.dock', kant);
  }
  function zetLayout(l) {
    layout = l;
    shadow.querySelector('.wrap').setAttribute('data-layout', l);
    $('layout').setAttribute('aria-pressed', String(l === 'werkruimte'));
    $('layout').title = l === 'werkruimte' ? 'Compact: één kolom naast het formulier' : 'Werkruimte: document, velden en aandachtspunten naast elkaar';
    bewaarLokaal('ggb.panel.layout', l);
    if (l === 'werkruimte') maakViewer();

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
    $('toggle').innerHTML = ico(v ? 'plus' : 'min');
    bewaarLokaal('ggb.panel.collapsed', v ? '1' : '0');
  }

  /* ======================= Documentcheck ======================= */

  function render(decl) {
    lastDecl = decl;
    $('open').disabled = !decl;
    if (!decl) {
      body.innerHTML = '<div class="empty">' + ico('doc') + '<b>Geen declaratie gevonden</b>Open een declaratie (Details) of "New declaration" om de documentcheck te zien.</div>';
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
      '<div class="ai-top"><ol class="stepper" id="stepper"><li data-stap="1" class="actief"><span>1</span>Documenten</li><li data-stap="2"><span>2</span>Controleren</li><li data-stap="3"><span>3</span>Invullen</li></ol>' +
        '<div id="dossier" hidden></div></div>' +
      '<div class="ws" id="ws" data-leeg="1">' +
        '<aside class="kol kol-bron" id="kol-bron">' +
          '<div id="herstel"></div>' +
          '<details class="kaart" id="sec-bron" open><summary>' + ico('doc', true) + 'Bronbestanden <span class="tel" id="tel-bron"></span><span class="rechts"><span class="via" id="ai-via"></span></span></summary>' +
            '<div class="modus" role="tablist"><button id="modus-auto" aria-pressed="true">Automatisch (API)</button><button id="modus-hand" aria-pressed="false">Handmatig (chat)</button></div>' +
            '<div class="drop" id="drop">' + ico('upload') + '<div><b>Sleep HC, labrapport, factuur, B/L hierheen</b></div><div>of <label>kies bestanden<input type="file" id="file" multiple accept=".pdf,application/pdf,image/jpeg,image/png,image/webp"></label></div><div class="small">PDF, JPG, PNG of WEBP · Portbase accepteert alleen PDF als bijlage</div></div>' +
            '<ul class="files" id="files"></ul>' +
            '<textarea id="ctx" placeholder="Extra info voor de AI (optioneel), bijv. ETA 26-09-2026 07:00, grenscontrolepost Rotterdam, B/L-nummer…"></textarea>' +
            '<div id="blok-auto"><button class="btn primary groot" id="ai-run" disabled>Uitlezen met AI</button><div id="ai-probleem"></div></div>' +
            '<div id="blok-hand" hidden>' +
              '<ol class="stappen">' +
                '<li><button class="btn primary" id="prompt-kopie">' + ico('kopie', true) + ' Kopieer prompt</button> <span class="small muted">bevat je bestandsnamen en extra info</span></li>' +
                '<li>Plak de prompt in een chat en voeg <b>dezelfde documenten</b> toe: ' +
                  '<a href="https://chatgpt.com/" target="_blank" rel="noopener">ChatGPT</a> · <a href="https://gemini.google.com/app" target="_blank" rel="noopener">Gemini</a> · <a href="https://claude.ai/new" target="_blank" rel="noopener">Claude</a></li>' +
                '<li>Plak het JSON-antwoord hieronder:</li>' +
              '</ol>' +
              '<textarea id="json-in" class="json" placeholder="{ &quot;declaratieType&quot;: … }" spellcheck="false"></textarea>' +
              '<div class="row-actions"><button class="btn primary" id="json-verwerk">Verwerken</button></div>' +
            '</div>' +
            '<div class="small" style="margin-top:.4rem"><button class="link" id="ai-opties">AI-instellingen</button></div>' +
            '<div id="ai-status" class="status-regel small muted"></div>' +
          '</details>' +
          '<section class="kaart viewer-kaart" id="viewer-kaart"><div class="viewer-kop">' + ico('oog', true) + '<div class="viewer-tabs" id="viewer-tabs"></div><span class="viewer-pagina" id="viewer-pagina"></span></div><div class="viewer-frame" id="viewer-frame"></div></section>' +
        '</aside>' +
        '<main class="kol kol-velden" id="kol-velden"><div id="start"></div><div id="ai-result"></div></main>' +
        '<aside class="kol kol-aandacht" id="kol-aandacht"><div id="triage"></div><div id="check-kaart"></div></aside>' +
      '</div>';
  }

  /* ---- stappen ---- */
  function openPunten() { return aiResultaat ? aiResultaat.waarschuwingen.filter(function (w) { return !(aiResultaat.triage || {})[w]; }).length : 0; }
  function updateStepper() {
    var stap = !aiResultaat ? 1 : (laatsteVerslag.length ? 3 : 2);
    alle('#stepper li').forEach(function (li) {
      var n = +li.getAttribute('data-stap');
      li.classList.toggle('actief', n === stap);
      li.classList.toggle('klaar', n < stap || (n === 3 && laatsteVerslag.length && !vulBezig));
    });
    var tel = $('tel-ai');
    if (!aiResultaat) { tel.textContent = ''; return; }
    var hand = laatsteVerslag.filter(function (v) { return v.status === 'handmatig' || v.status === 'niet gevonden' || v.status === 'fout'; }).length;
    var open = openPunten();
    tel.textContent = laatsteVerslag.length ? (hand ? String(hand) : '✓') : (open ? String(open) : '✓');
    tel.className = 'tel ' + ((laatsteVerslag.length ? hand : open) ? 'let' : 'ok');
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
      neemVoorstel(AI.normaliseer(AI.leesJsonAntwoord($('json-in').value)));
      zetStatus('✓ Antwoord verwerkt (handmatig). Controleer het voorstel.');
    } catch (e) {
      zetStatus('<span style="color:#c0262d">' + esc(e.message) + '</span>');
    }
  }

  function bindAi() {
    var drop = $('drop');
    $('file').addEventListener('change', function (e) { voegToe(e.target.files); e.target.value = ''; });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); voegToe(e.dataTransfer.files); });
    $('files').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-del]');
      if (b) { bestanden.splice(+b.getAttribute('data-del'), 1); renderBestanden(); renderViewerTabs(); }
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
      var doel = { 1: 'sec-bron', 2: 'kol-velden', 3: 'ai-verslag' }[li.getAttribute('data-stap')];
      if (doel === 'sec-bron') $('sec-bron').open = true;
      if (doel && $(doel)) $(doel).scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    $('prompt-kopie').addEventListener('click', function () {
      kopieer(AI.handmatigePrompt(bestanden.map(function (f) { return f.name; }), $('ctx').value), 'Prompt gekopieerd – plak hem in de chat');
    });
    $('json-verwerk').addEventListener('click', verwerkJson);
    $('herstel').addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-herstel');
      if (a === 'ja') herstelVorige();
      if (a === 'nee') { wisVorige(); $('herstel').innerHTML = ''; }
    });
    $('viewer-tabs').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-viewer]');
      if (b) toonBestand(+b.getAttribute('data-viewer'), 1);
    });
    try {
      chrome.storage.onChanged.addListener(function (wijz, gebied) {
        if (gebied !== 'local') return;
        if (wijz['ggb.ai']) laadInstellingen();
        // Geheugen aangepast op de instellingenpagina (geleerde organisaties): opnieuw inlezen.
        if (wijz[GEHEUGEN] && !bewaarBezig) laadGeheugen();
      });
    } catch (e) { /* negeren */ }
    laadInstellingen(function () { if (aiInst.provider === 'handmatig') zetModus('hand'); });
    toonHerstel();

    // Alle knoppen en velden van voorstel, dossierbalk, triage en profiel via één set luisteraars.
    var ai = $('ai-body');
    ai.addEventListener('input', function (e) {
      var p = e.target.getAttribute && e.target.getAttribute('data-pad');
      if (p && aiResultaat) {
        zetPad(aiResultaat, p, e.target.value);
        if (e.target.hasAttribute('data-datum')) toonDatumHint(e.target);
        var bm = p.match(/^goederen\.(\d+)\.brutoGewicht$/);
        if (bm) {
          aiResultaat.goederen[+bm[1]].brutoBron = 'handmatig';
          if ($('bruto-bron-' + bm[1])) $('bruto-bron-' + bm[1]).innerHTML = brutoBadge(aiResultaat.goederen[+bm[1]]);
        }
        if (bm || p === 'totaalBrutoGewicht.waarde') renderBrutoCheck();
        bewaarVoorstel();
      }
    });
    ai.addEventListener('change', function (e) {
      var t = e.target;
      if (!t.getAttribute || !aiResultaat) return;
      if (t.getAttribute('data-pad')) { renderAiCheck(); renderFeiten(); renderKop(); }
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
    ai.addEventListener('focusin', function (e) {
      var p = e.target.getAttribute && e.target.getAttribute('data-pad');
      if (p && layout === 'werkruimte' && aiResultaat) { var b = bronVoorPad(p); if (b) toonBron(b.bron, b.bestand, true); }
    });
    ai.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('button,[data-bron]') : null;
      if (!t || !t.getAttribute) return;
      if (t.id === 'res-filter') zetZFilter(zFilter === 'controle' ? 'alle' : 'controle');
      var zf = t.getAttribute('data-zfilter');
      if (zf && t.id !== 'res-filter') zetZFilter(zf);
      if (t.id === 'volgende') volgendeTeControleren();
      if (t.id === 'res-export') exporteer();
      if (t.id === 'res-nieuw') nieuweZending();
      var f = t.getAttribute('data-filter');
      if (f) { verslagFilter = f; pasFilterToe(); }
      var dlg = t.getAttribute('data-dialoog');
      if (dlg != null) zoekOpnieuw(t, +dlg);
      var kopie = t.getAttribute('data-kopie');
      if (kopie != null) kopieer(kopie).then(function (ok) { if (ok) t.textContent = 'Gekopieerd ✓'; });
      var bron = t.getAttribute('data-bron');
      if (bron != null) toonBron(bron, t.getAttribute('data-bestand'));
      // Aandachtspunten
      var ak = t.getAttribute('data-akkoord');
      if (ak != null) akkoord(+ak);
      var on = t.getAttribute('data-ongedaan');
      if (on != null) ongedaan(+on);
      var alt = t.getAttribute('data-altijd');
      if (alt != null) altijdAkkoord(+alt);
      if (t.id === 'alles-akkoord') allesAkkoord();
      // Smart Memory
      var tr = t.getAttribute('data-terug');
      if (tr != null) terugdraaien(+tr, false);
      var nm = t.getAttribute('data-nooit');
      if (nm != null) terugdraaien(+nm, true);
      var sj = t.getAttribute('data-sjabloon');
      if (sj != null) laadSjabloon(sj);
      if (t.id === 'mem-export') exporteerGeheugen();
      if (t.id === 'mem-vergeet') vergeetHuidigProfiel();
      var ov = t.getAttribute('data-org-vergeet');
      if (ov != null) vergeetGeleerdeOrganisatie(ov);
      if (t.hasAttribute('data-org-beheer')) openOpties('organisaties');
    });
    ai.addEventListener('change', function (e) { if (e.target.id === 'mem-import') importeerGeheugen(e.target.files[0], e.target); });
  }

  var TOEGESTAAN = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  function voegToe(lijst) {
    var eerder = bestanden.length;
    Array.prototype.forEach.call(lijst || [], function (f) {
      if (TOEGESTAAN.indexOf(f.type) < 0) { zetStatus('Bestandstype van ' + esc(f.name) + ' wordt niet ondersteund.'); return; }
      if (!bestanden.some(function (b) { return b.name === f.name && b.size === f.size; })) bestanden.push(f);
    });
    renderBestanden();
    renderViewerTabs();
    if (!eerder && bestanden.length && layout === 'werkruimte') toonBestand(0, 1);
  }

  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' kB' : (n / 1048576).toFixed(1) + ' MB'; }

  function renderBestanden() {
    var totaal = bestanden.reduce(function (s, f) { return s + f.size; }, 0);
    $('files').innerHTML = bestanden.map(function (f, i) {
      var pdf = f.type === 'application/pdf';
      return '<li><span class="ft' + (pdf ? '' : ' img') + '">' + (pdf ? 'PDF' : 'IMG') + '</span><span class="fn" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="muted small">' + mb(f.size) + '</span><button data-del="' + i + '" title="Verwijderen">' + ico('x', true) + '</button></li>';
    }).join('') + (totaal > 24 * 1048576 ? '<li class="melding aandacht">Samen ' + mb(totaal) + ': te groot voor één verzoek (max. ±24 MB). Laat grote bijlagen weg of comprimeer ze.</li>' : '');
    $('tel-bron').textContent = bestanden.length ? String(bestanden.length) : '';
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
    if (!aiResultaat) $('start').innerHTML = '<div class="kaart"><div class="kaart-kop"><h3><span class="spinner"></span> Voorstel wordt opgebouwd…</h3></div><div class="skelet"><i></i><i></i><i style="width:70%"></i><i></i><i style="width:55%"></i></div></div>';
    var naam = AI.PROVIDERS[aiInst.provider].naam;
    var tik = setInterval(function () { zetStatus(esc(naam) + ' leest de documenten… ' + Math.round((Date.now() - start) / 1000) + 's', true); }, 1000);
    try {
      var payload = [];
      for (var i = 0; i < bestanden.length; i++) {
        payload.push({ naam: bestanden[i].name, mediaType: bestanden[i].type, data: await leesBase64(bestanden[i]) });
      }
      var res = await vraagAi({ bestanden: payload, context: $('ctx').value });
      zetStatus('✓ Klaar in ' + Math.round((Date.now() - start) / 1000) + 's · ' + esc(res.model) + ' · ' + res.gebruik.input + ' in / ' + res.gebruik.output + ' uit tokens');
      neemVoorstel(res.resultaat);
    } catch (e) {
      zetStatus('<span style="color:#c0262d">' + esc(e.message) + '</span>');
      if (!aiResultaat) renderStart();
    } finally {
      clearInterval(tik);
      aiBezig = false;
      renderBestanden();
    }
  }

  function openOpties(pagina) {
    try { chrome.runtime.sendMessage({ type: 'ggb:openOpties', pagina: typeof pagina === 'string' ? pagina : '' }); } catch (e) { /* negeren */ }
  }

  function zetPad(obj, pad, waarde) {
    var delen = pad.split('.');
    var o = obj;
    for (var i = 0; i < delen.length - 1; i++) o = o[delen[i]];
    o[delen[delen.length - 1]] = waarde;
  }
  function leesPad(obj, pad) {
    return pad.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  /* ======================= Smart Memory ======================= */

  function laadGeheugen() {
    try {
      chrome.storage.local.get(GEHEUGEN, function (x) {
        geheugen = G.laad(x && x[GEHEUGEN]);
        if (!aiResultaat) renderStart();
        else { renderProfiel(); renderKop(); renderGeleerd(); }
      });
    } catch (e) { renderStart(); }
  }
  var bewaarBezig = false;
  function bewaarGeheugen() {
    var o = {};
    o[GEHEUGEN] = geheugen;
    bewaarBezig = true;
    try { chrome.storage.local.set(o, function () { setTimeout(function () { bewaarBezig = false; }, 50); }); } catch (e) { bewaarBezig = false; }
  }

  /**
   * Nieuw voorstel van de AI (of handmatig/JSON): documenten bepalen, het origineel
   * bewaren om van te leren, en Smart Memory toepassen (correcties + eerder akkoord).
   */
  function neemVoorstel(r) {
    bepaalDocumentenVoor(r);
    aiOrigineel = G.kopie(r);
    var advies = G.pasToe(geheugen, r);
    r.triage = {};
    Object.keys(advies.triage).forEach(function (t) { if (advies.triage[t].auto) r.triage[t] = 'auto'; });
    r.geheugen = { toegepast: advies.toegepast };
    zetResultaat(r);
    if (advies.toegepast.length) toast('Smart Memory: ' + advies.toegepast.length + ' eerdere correctie' + (advies.toegepast.length === 1 ? '' : 's') + ' toegepast', 'mem');
  }

  /** Bij het invullen: dit dossier onthouden (zelfde voorstel opnieuw invullen vervangt het vorige). */
  function leerNu() {
    if (!aiResultaat || !aiOrigineel) return;
    var triage = {};
    Object.keys(aiResultaat.triage || {}).forEach(function (t) { triage[t] = 'akkoord'; });
    var d = G.leer(geheugen, { id: aiResultaat.id, tijd: aiTijd, origineel: aiOrigineel, definitief: aiResultaat, triage: triage, dossierNr: aiResultaat.dossierNr });
    if (!d) return;
    bewaarGeheugen();
    var info = G.herken(geheugen, aiOrigineel);
    toast('Smart Memory: zending onthouden (' + (info ? info.aantal : 1) + '× deze route)', 'mem');
    renderKop();
  }

  function profielInfo() { return aiResultaat ? G.herken(geheugen, aiOrigineel || aiResultaat) : null; }
  function kortNaam(n) { return String(n || '').replace(/\b(co\.?,?\s*ltd\.?|b\.?v\.?|gmbh|ltd\.?|limited|company|corporation|n\.?v\.?)\b/ig, '').replace(/[\s,.]+$/, '').trim(); }
  function datumKort(t) { var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear(); }
  function initialen(n) { return kortNaam(n).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase() || '?'; }

  /** Startscherm: recente patronen (routes) uit Smart Memory, met sjabloon laden. */
  function renderStart() {
    var el = $('start');
    if (!el) return;
    if (aiResultaat) { el.innerHTML = ''; return; }
    var p = G.recentePatronen(geheugen, 6);
    el.innerHTML = '<section class="kaart"><div class="kaart-kop"><h3>' + ico('mem', true) + 'Recente patronen</h3><span class="badge mem">Smart Memory</span></div>' +
      (p.length ? '<ul class="patronen">' + p.map(function (x) {
        var nrs = x.dossierNrs.length ? ' · dossier ' + x.dossierNrs.join(', ') : '';
        return '<li class="patroon"><span class="av">' + esc(initialen(x.exporteur)) + '</span><div class="w"><b title="' + esc(x.exporteur + ' → ' + x.ontvanger) + '">' + esc(kortNaam(x.exporteur)) + ' → ' + esc(kortNaam(x.ontvanger)) + '</b>' +
          '<span>' + x.aantal + ' zending' + (x.aantal === 1 ? '' : 'en') + ' · laatst ' + esc(datumKort(x.laatst)) + esc(nrs) + (x.gn.length ? ' · GN ' + esc(x.gn.slice(0, 3).join(', ')) : '') + '</span></div>' +
          '<button class="btn klein" data-sjabloon="' + esc(x.dossier.id) + '" title="Vaste gegevens van de laatste zending laden: organisaties, route, vervoer, producten (zonder B/L, gewichten en documenten)">Sjabloon laden</button></li>';
      }).join('') + '</ul>'
        : '<div class="empty" style="padding:1rem .5rem">' + ico('mem') + '<b>Nog geen patronen</b>Na de eerste invulronde onthoudt de assistent de route (exporteur → ontvanger), de organisaties en je correcties. Bij een volgende zending van dezelfde route worden die voorgesteld.</div>') +
      beheerHtml(false) + '</section>' +
      '<div class="empty">' + ico('upload') + '<b>Begin met de documenten</b>Sleep het gezondheidscertificaat en eventueel B/L, factuur en paklijst in <i>Bronbestanden</i> en klik <i>Uitlezen</i>.</div>';
  }

  function beheerHtml(metVergeet) {
    return '<div class="beheer">Geheugen (lokaal, ' + geheugen.dossiers.length + ' dossiers): <button class="link" id="mem-export">Exporteren</button> · <label class="link" style="cursor:pointer;color:var(--pb);font-weight:600">Importeren<input type="file" id="mem-import" accept="application/json,.json"></label>' +
      (metVergeet ? ' · <button class="link" id="mem-vergeet" style="color:var(--fout)">Profiel vergeten</button>' : '') + '</div>';
  }

  function laadSjabloon(id) {
    var d = G.dossierOpId(geheugen, id);
    if (!d) return;
    var r = AI.normaliseer(G.kopie(d.sjabloon));
    r.waarschuwingen = [];
    bepaalDocumentenVoor(r);
    aiOrigineel = G.kopie(r);
    r.triage = {};
    r.geheugen = { toegepast: [], sjabloon: d.dossierNr || d.bol || datumKort(d.tijd) };
    zetResultaat(r);
    toast('Sjabloon geladen – vul B/L, gewichten en documenten aan', 'mem');
  }

  /** Smart Memory-kaart boven de velden: herkend profiel en toegepaste correcties (met terugdraaien). */
  function renderProfiel() {
    var el = $('profiel');
    if (!el || !aiResultaat) return;
    var info = profielInfo(), toegepast = (aiResultaat.geheugen || {}).toegepast || [], sj = (aiResultaat.geheugen || {}).sjabloon;
    if (!info) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    var actief = toegepast.filter(function (x) { return !x.teruggedraaid; }).length;
    el.innerHTML = '<div class="kaart-kop"><h3>' + ico('mem', true) + 'Smart profiel</h3>' + (info.aantal ? '<span class="badge mem">' + info.aantal + ' eerdere zending' + (info.aantal === 1 ? '' : 'en') + '</span>' : '<span class="badge info">Nieuw profiel</span>') + '</div>' +
      '<div class="route">' + esc(kortNaam(info.exporteur)) + ' → ' + esc(kortNaam(info.ontvanger)) + '</div>' +
      '<div class="meta">' + (sj ? 'Gestart vanuit sjabloon ' + esc(sj) + '. ' : '') +
        (info.aantal ? 'Laatste zending ' + esc(datumKort(info.laatst)) + (info.laatsteDossier && info.laatsteDossier.dossierNr ? ' (dossier ' + esc(info.laatsteDossier.dossierNr) + ')' : '') + '. ' : 'Na het invullen onthoudt de assistent je correcties voor deze route. ') +
        (toegepast.length ? 'Dit profiel past <b>' + actief + ' regel' + (actief === 1 ? '' : 's') + '</b> toe op basis van eerdere zendingen:' : (info.aantal ? 'Geen afwijkingen van de AI om te corrigeren.' : '')) + '</div>' +
      (toegepast.length ? '<ul class="regels">' + toegepast.map(function (x, i) {
        return '<li' + (x.teruggedraaid ? ' class="terug"' : '') + '><span class="w"><b>' + esc(x.label) + '</b>: ' + (x.van ? '<code>' + esc(x.van) + '</code> → ' : '') + '<code>' + esc(x.naar) + '</code> <span class="muted">(' + x.n + ' van ' + x.totaal + (x.globaal ? ', alle routes' : '') + ')</span></span>' +
          (x.teruggedraaid ? '<span class="small muted">teruggedraaid</span>' : '<button class="btn klein kaal" data-terug="' + i + '" title="Waarde van de AI terugzetten">' + ico('terug', true) + '</button><button class="btn klein kaal" data-nooit="' + i + '" title="Terugzetten en deze regel niet meer toepassen voor dit profiel">Niet meer</button>') + '</li>';
      }).join('') + '</ul>' : '') + beheerHtml(info.aantal > 0);
  }

  function terugdraaien(i, nooitMeer) {
    var x = aiResultaat.geheugen.toegepast[i];
    if (!x || x.teruggedraaid) return;
    var waarde = /\.opnemen$/.test(x.pad) ? x.van === 'ja' : x.van;
    zetPad(aiResultaat, x.pad, waarde);
    var houder = x.pad.replace(/\.[^.]+$/, ''), orig = aiOrigineel && leesPad(aiOrigineel, houder), doel = leesPad(aiResultaat, houder);
    if (orig && doel && typeof orig === 'object') { if ('bron' in orig) doel.bron = orig.bron; if ('zekerheid' in orig && 'zekerheid' in doel) doel.zekerheid = orig.zekerheid; }
    x.teruggedraaid = true;
    if (nooitMeer) {
      var info = profielInfo();
      if (info) G.zetUit(geheugen, info.sleutel, x.sleutel, true);
      bewaarGeheugen();
      toast('Regel uitgezet voor dit profiel', 'mem');
    } else toast('Waarde van de AI teruggezet');
    renderAiResultaat();
    bewaarVoorstel();
  }

  function exporteerGeheugen() {
    download('ggb-smart-memory-' + datumKort(Date.now()) + '.json', geheugen);
    toast('Geheugen geëxporteerd (' + geheugen.dossiers.length + ' dossiers)');
  }
  function importeerGeheugen(file, input) {
    if (!file) return;
    file.text().then(function (t) {
      var n = G.voegSamen(geheugen, JSON.parse(t));
      bewaarGeheugen();
      toast(n + ' dossier' + (n === 1 ? '' : 's') + ' toegevoegd aan het geheugen', 'mem');
      if (!aiResultaat) renderStart(); else renderProfiel();
    }).catch(function () { toast('Dit is geen geldig geheugenbestand', 'info'); });
    input.value = '';
  }
  function vergeetHuidigProfiel() {
    var info = profielInfo();
    if (!info || !confirm('Alles vergeten wat de assistent heeft geleerd over ' + kortNaam(info.exporteur) + ' → ' + kortNaam(info.ontvanger) + '?')) return;
    G.vergeetProfiel(geheugen, info.sleutel);
    bewaarGeheugen();
    renderProfiel(); renderKop();
    toast('Profiel vergeten', 'mem');
  }

  /* ---- organisaties: welke Portbase-regel bij een naam hoort (leren en tonen) ---- */

  var ROL_VAN_VELD = { exporteur: 'exporter', importeur: 'importer', plaatsBestemming: 'bestemming', plaatsVerzending: 'inrichting' };
  var VELD_VAN_ROL = { exporter: 'exporteur', importer: 'importeur', bestemming: 'plaatsBestemming', inrichting: 'plaatsVerzending' };

  function geleerdVoor(veld) {
    var p = aiResultaat && aiResultaat[veld];
    return p && p.naam ? G.vindOrganisatie(geheugen, p.naam, ROL_VAN_VELD[veld], '') : null;
  }

  /** Regel onder een organisatie in het voorstel: bekende Portbase-regel, of uitleg hoe het geleerd wordt. */
  function geleerdHtml(veld) {
    var p = aiResultaat && aiResultaat[veld];
    if (!p || !p.naam) return '';
    var e = geleerdVoor(veld);
    if (!e) return '<span class="muted small">' + ico('mem', true) + ' Nog niet geleerd. Kies in Portbase de juiste regel en klik <i>Save</i>; dan weet de assistent het de volgende keer.</span>';
    return '<span class="badge mem">' + ico('mem', true) + 'Bekend in Portbase</span> <span class="small" title="' + esc(G.rijTekst(e.rij)) + '">' + esc(G.rijTekst(e.rij)) + '</span>' +
      ' <span class="muted small">(' + e.keer + '× gekozen)</span> <button class="link small" data-org-vergeet="' + esc(e.id) + '">Vergeten</button> · <button class="link small" data-org-beheer="1">Beheren</button>';
  }
  function renderGeleerd() {
    alle('[data-geleerd]', $('ai-result') || shadow).forEach(function (el) { el.innerHTML = geleerdHtml(el.getAttribute('data-geleerd')); });
  }
  function vergeetGeleerdeOrganisatie(id) {
    G.vergeetOrganisatie(geheugen, id);
    bewaarGeheugen();
    renderGeleerd();
    toast('Organisatie vergeten', 'mem');
  }

  var ORG_KNOPPEN = [[/organisation-dialog-exporter/, 'exporter'], [/organisation-dialog-importer/, 'importer'], [/place-of-destination/, 'bestemming'], [/^(organisation-dialog|establishment-dialog)$/, 'inrichting']];
  var laatsteOrgKnop = null;

  /** Rol van een organisatievenster uit de titel ("Importer", "Place of destination", …). */
  function rolUitTitel(venster) {
    var t = String((venster.querySelector('h2, [mat-dialog-title]') || {}).textContent || '').toLowerCase();
    if (/export|consignor/.test(t)) return 'exporter';
    if (/import|consignee/.test(t)) return 'importer';
    if (/destination/.test(t)) return 'bestemming';
    if (/establishment|origin|dispatch|approval/.test(t)) return 'inrichting';
    return '';
  }

  /**
   * De gebruiker klikt Save in een Portbase-organisatievenster: de gekozen regel
   * onthouden bij de naam op het HC (uit het voorstel) en de rol. Alleen echte
   * klikken van de gebruiker (isTrusted), niet de klikken van de invuller zelf.
   */
  function leerUitVenster(venster) {
    if (!venster.querySelector('[data-test="organisations-list"], [data-test="search-type"]')) return;
    var rijen = Array.prototype.slice.call(venster.querySelectorAll('[data-test="organisations-list-row"], [data-test="organisations-list"] mat-row, [data-test="organisations-list"] tr.mat-mdc-row'));
    var rijEl = rijen.filter(function (r) {
      return r.querySelector('input:checked, .mat-mdc-radio-checked, .mat-radio-checked') || /\b(selected|mat-mdc-row-selected)\b/.test(r.className || '');
    })[0];
    if (!rijEl) return;
    var rij = G.rijUitCellen(function (k) { var c = rijEl.querySelector('.mat-column-' + k); return c ? String(c.textContent || '').replace(/\s+/g, ' ').trim() : ''; });
    if (!rij.naam) return;
    var ctx = venster.__ggbZoek || null;
    var rol = (ctx && ctx.rol) || (laatsteOrgKnop && Date.now() - laatsteOrgKnop.tijd < 30 * 60000 ? laatsteOrgKnop.rol : '') || rolUitTitel(venster);
    if (!G.ROLLEN[rol]) return;
    var veld = VELD_VAN_ROL[rol], p = aiResultaat && aiResultaat[veld];
    var naam = (ctx && ctx.naam) || (p && p.naam) || '';
    var landEl = venster.querySelector('input[data-test="search-country"]');
    var land = ((landEl && landEl.value) || (ctx && ctx.land) || '').trim().slice(0, 2).toUpperCase();
    var res = G.leerOrganisatie(geheugen, { rol: rol, naam: naam, land: /^[A-Z]{2}$/.test(land) ? land : '', rij: rij, bron: 'portbase' });
    if (!res) return;
    bewaarGeheugen();
    toast('Onthouden als ' + G.ROLLEN[rol].toLowerCase() + ': ' + (naam && G.pastNaam(naam, rij.naam) !== 3 ? naam + ' → ' : '') + rij.naam + (rij.plaats ? ', ' + rij.plaats : ''), 'mem');
    renderGeleerd();
  }

  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    var knop = e.target && e.target.closest && e.target.closest('button');
    if (!knop) return;
    var dt = knop.getAttribute('data-test') || '';
    for (var i = 0; i < ORG_KNOPPEN.length; i++) {
      if (ORG_KNOPPEN[i][0].test(dt)) { laatsteOrgKnop = { rol: ORG_KNOPPEN[i][1], tijd: Date.now() }; return; }
    }
    if (dt === 'save') {
      var venster = knop.closest('mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]');
      if (venster) { try { leerUitVenster(venster); } catch (x) { /* nooit Portbase hinderen */ } }
    }
  }, true);

  /* ======================= documentviewer ======================= */

  var viewer = { el: null, klaar: false, wacht: null, actief: -1 };
  var EXT_ORIGIN = (function () { try { return 'chrome-extension://' + chrome.runtime.id; } catch (e) { return ''; } })();

  function maakViewer() {
    if (viewer.el || !EXT_ORIGIN) return;
    var f = document.createElement('iframe');
    f.id = 'viewer';
    f.title = 'Documentviewer';
    f.src = chrome.runtime.getURL('extension/viewer.html');
    $('viewer-frame').appendChild(f);
    viewer.el = f;
    renderViewerTabs();
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== EXT_ORIGIN || !viewer.el || e.source !== viewer.el.contentWindow) return;
    if (e.data && e.data.type === 'ggb:viewer-klaar') {
      viewer.klaar = true;
      if (viewer.wacht) { viewer.el.contentWindow.postMessage(viewer.wacht, EXT_ORIGIN); viewer.wacht = null; }
    }
  });

  function renderViewerTabs() {
    var el = $('viewer-tabs');
    if (!el) return;
    el.innerHTML = bestanden.length ? bestanden.map(function (f, i) {
      return '<button data-viewer="' + i + '" aria-pressed="' + (i === viewer.actief) + '" title="' + esc(f.name) + '">' + esc(f.name) + '</button>';
    }).join('') : '<span class="small muted">Nog geen documenten</span>';
  }

  function toonBestand(i, pagina) {
    var f = bestanden[i];
    if (!f) return;
    if (layout !== 'werkruimte') zetLayout('werkruimte');
    maakViewer();
    viewer.actief = i;
    renderViewerTabs();
    $('viewer-pagina').textContent = f.type === 'application/pdf' ? 'p. ' + (pagina || 1) : '';
    f.arrayBuffer().then(function (buf) {
      var msg = { type: 'ggb:toon', naam: f.name, mediaType: f.type, data: buf, pagina: pagina || 1 };
      if (viewer.klaar) viewer.el.contentWindow.postMessage(msg, EXT_ORIGIN);
      else viewer.wacht = msg;
    });
    var k = $('viewer-kaart');
    k.classList.remove('flits'); void k.offsetWidth; k.classList.add('flits');
  }

  /** Welk bestand hoort bij een bron als "HC vak I.28 p.2", "B/L p.1" of "Factuur"? */
  function bronBestand(tekst, voorkeur) {
    var naamIdx = function (n) { for (var i = 0; i < bestanden.length; i++) if (bestanden[i].name === n) return i; return -1; };
    if (voorkeur && naamIdx(voorkeur) >= 0) return naamIdx(voorkeur);
    var t = String(tekst || '');
    var soorten = [
      { re: /\b(hc|health|gezondheid|certificaat|certificate|vak\s*i\.|box\s*i\.|i\.\d)/i, type: 'HC', naam: /hc|health|cert|gezond|traces|import\.eu/i },
      { re: /\blab|analys/i, type: 'LAB', naam: /lab|analys|test/i },
      { re: /vangst|catch/i, type: 'CATCH', naam: /catch|vangst/i },
      { re: /\bb\/?l\b|bill of lading|cognossement/i, naam: /\bb.?l\b|bol|lading|bill/i },
      { re: /factuur|invoice/i, naam: /inv|fact/i },
      { re: /paklijst|packing/i, naam: /pack|pak/i }
    ];
    for (var s = 0; s < soorten.length; s++) {
      var x = soorten[s];
      if (!x.re.test(t)) continue;
      var doc = x.type && aiResultaat && aiResultaat.documenten.filter(function (d) { return d.type === x.type && naamIdx(d.bestand) >= 0; })[0];
      if (doc) return naamIdx(doc.bestand);
      for (var i = 0; i < bestanden.length; i++) if (x.naam.test(bestanden[i].name)) return i;
    }
    return bestanden.length === 1 ? 0 : -1;
  }
  function bronPagina(tekst) { var m = String(tekst || '').match(/\b(?:p|pag|pagina|page|blz)\.?\s*(\d{1,3})\b/i); return m ? +m[1] : 1; }

  /** Opent het document van een bron in de viewer; stil = geen melding als het niet lukt (focus op een veld). */
  function toonBron(bron, bestand, stil) {
    if (/^(smart memory|sjabloon|standaard)/i.test(bron || '')) { if (!stil) toast('Deze waarde komt niet uit een document (' + bron + ')', 'info'); return; }
    if (!bestanden.length) { if (!stil) toast('Documenten niet geladen – voeg ze toe bij Bronbestanden', 'info'); return; }
    var i = bronBestand(bron, bestand);
    if (i < 0) { if (!stil) toast('Geen document gevonden bij "' + (bron || '?') + '"', 'info'); return; }
    var pagina = bronPagina(bron);
    if (stil && i === viewer.actief && $('viewer-pagina').textContent === 'p. ' + pagina) return;
    toonBestand(i, pagina);
  }

  /** Bron van het veld achter een invoerpad (voor de viewer). */
  function bronVoorPad(pad) {
    var d = pad.split('.'), r = aiResultaat, x = r[d[0]];
    if (!x) return null;
    if (d[0] === 'documenten') { var doc = x[+d[1]]; return doc ? { bron: doc.type, bestand: doc.bestand } : null; }
    if (Array.isArray(x)) { var el = x[+d[1]]; return el ? { bron: el.bron || '' } : null; }
    return typeof x === 'object' ? { bron: x.bron || '' } : null;
  }

  /* ======================= voorstel ======================= */

  function zetResultaat(r, tijd, origineel) {
    aiResultaat = r;
    aiTijd = tijd || Date.now();
    if (origineel) aiOrigineel = origineel;
    if (!aiOrigineel) aiOrigineel = G.kopie(r);
    if (!r.id) r.id = 'v' + aiTijd.toString(36) + Math.random().toString(36).slice(2, 6);
    r.triage = r.triage || {};
    laatsteVerslag = [];
    brutoNaInvullen = null;
    zFilter = 'alle';
    $('herstel').innerHTML = '';
    // Bronbestanden inklappen: compact staat het voorstel dan bovenaan, in de werkruimte krijgt de viewer de ruimte.
    // Handmatig niet (daar plak je opnieuw JSON).
    if (modus === 'auto') $('sec-bron').open = false;
    renderAiResultaat();
    bewaarVoorstel();
    $('kol-velden').scrollTop = 0;
    $('ai-result').scrollIntoView({ block: 'start' });
  }

  var bewaarTimer = null;
  function bewaarVoorstel() {
    clearTimeout(bewaarTimer);
    bewaarTimer = setTimeout(function () {
      if (!aiResultaat) return;
      var o = {};
      o[LAATSTE] = { tijd: aiTijd, resultaat: aiResultaat, origineel: aiOrigineel };
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
      zetResultaat(v.resultaat, v.tijd, v.origineel || null);
      zetStatus('Vorig voorstel hersteld. Voeg de documenten opnieuw toe als ze geüpload moeten worden.');
    });
  }

  function download(naam, obj) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    a.download = naam;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function exporteer() {
    var r = aiResultaat;
    download('ggb-voorstel-' + String((r.bol && r.bol.waarde) || tijdTekst(aiTijd)).replace(/[^A-Za-z0-9-]+/g, '_') + '.json', r);
    toast('Voorstel geëxporteerd als JSON');
  }

  function nieuweZending() {
    if (vulBezig) return;
    if (!confirm('Nieuwe zending beginnen? Het huidige voorstel en de documenten worden uit het paneel gehaald.')) return;
    aiResultaat = null;
    aiOrigineel = null;
    laatsteVerslag = [];
    bestanden = [];
    viewer.actief = -1;
    $('ctx').value = '';
    $('json-in').value = '';
    $('ai-result').innerHTML = '';
    $('triage').innerHTML = '';
    $('check-kaart').innerHTML = '';
    $('dossier').hidden = true;
    $('ws').setAttribute('data-leeg', '1');
    $('foot-ai').hidden = true;
    $('foot-ai').innerHTML = '';
    $('sec-bron').open = true;
    zetStatus('');
    wisVorige();
    renderBestanden();
    renderViewerTabs();
    renderStart();
    renderKop();
    updateStepper();
    $('sec-bron').scrollIntoView({ block: 'start' });
  }

  /* ---- weergave van het voorstel ---- */

  function zekerheidBadge(z, bron, bestand) {
    if (/^smart memory/i.test(bron || '')) return '<span class="badge mem" title="Overgenomen uit eerdere zendingen van dit profiel (Smart Memory)">' + ico('mem', true) + 'geheugen</span>';
    return '<button class="badge ' + esc(z || 'laag') + '" data-bron="' + esc(bron || '') + '"' + (bestand ? ' data-bestand="' + esc(bestand) + '"' : '') + ' title="' + esc(bron ? 'Bron: ' + bron + ' – klik om het document te tonen' : 'Geen bron') + '">' + esc(z || 'laag') + '</button>';
  }

  var memPaden = {};
  function invoer(pad, waarde, z, extra) {
    var datum = extra && extra.datum;
    var klasse = memPaden[pad] ? 'z-mem' : (z ? 'z-' + z : '');
    return '<input data-pad="' + esc(pad) + '" value="' + esc(waarde) + '"' + (klasse ? ' class="' + esc(klasse) + '"' : '') + (datum ? ' data-datum="1"' : '') + (extra && extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') + (memPaden[pad] ? ' title="Ingevuld door Smart Memory (eerdere zendingen)"' : '') + '>' +
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
      ['Goederen', r.goederen.length + ' item' + (r.goederen.length === 1 ? '' : 's') + (aantalHcRegels(r) > r.goederen.length ? ' (' + aantalHcRegels(r) + ' HC-regels)' : '') + (netto ? ' · ' + netto.toLocaleString('nl-NL') + ' kg' : '')],
      ['Containers', r.containers.map(function (c) { return c.containernummer; }).join(', ') || '–'],
      ['ETA', r.aankomstDatum.waarde || '–']
    ];
    el.innerHTML = feiten.map(function (f) { return '<div class="feit" title="' + esc(f[1]) + '"><small>' + esc(f[0]) + '</small><b>' + esc(f[1]) + '</b></div>'; }).join('');
  }

  /** Kop: context van het dossier en het herkende profiel. */
  function renderKop() {
    var r = aiResultaat, chip = $('profiel-chip');
    if (!r) { $('sub').textContent = 'Documentcheck en AI invullen'; chip.hidden = true; return; }
    var delen = [r.dossierNr ? 'Dossier ' + r.dossierNr : '', r.bol.waarde ? 'B/L ' + r.bol.waarde : '', r.declaratieType.waarde === 'PRD' ? 'CHED-P' : r.declaratieType.waarde === 'LNV' ? 'CHED-D' : ''].filter(Boolean);
    $('sub').textContent = delen.join(' · ') || 'Voorstel van ' + tijdTekst(aiTijd);
    var info = profielInfo();
    chip.hidden = !info;
    if (info) {
      chip.innerHTML = ico('mem', true) + '<span>' + esc(kortNaam(info.exporteur)) + ' → ' + esc(kortNaam(info.ontvanger)) + '</span>' + (info.aantal ? '<span class="n">' + info.aantal + '</span>' : '');
      chip.title = 'Smart profiel: ' + info.exporteur + ' → ' + info.ontvanger + (info.aantal ? ' (' + info.aantal + ' eerdere zendingen)' : ' (nieuw)');
    }
  }

  /** Dossierbalk: kerngegevens, zekerheidsfilter en acties. */
  function renderDossier() {
    var r = aiResultaat, z = alleZekerheden(r), n = { hoog: 0, middel: 0, laag: 0 };
    z.forEach(function (x) { n[x] = (n[x] || 0) + 1; });
    var pct = function (k) { return (100 * n[k] / Math.max(1, z.length)).toFixed(1) + '%'; };
    var el = $('dossier');
    el.hidden = false;
    el.innerHTML = '<div class="feiten" id="feiten"></div>' +
      '<div class="dossier-rij"><div class="zeker" id="zeker" title="Zekerheid van de velden in het voorstel; filter op wat gecontroleerd moet worden">' +
        '<span class="zbalk"><i class="h" style="width:' + pct('hoog') + '"></i><i class="m" style="width:' + pct('middel') + '"></i><i class="l" style="width:' + pct('laag') + '"></i></span>' +
        '<span class="seg"><button data-zfilter="alle">Alle <b>' + z.length + '</b></button>' +
          '<button id="res-filter" data-zfilter="controle" title="Alleen velden met zekerheid middel of laag"><span class="dot" style="background:#e0a03a"></span>Te controleren <b>' + (n.middel + n.laag) + '</b></button>' +
          '<button data-zfilter="laag" title="Alleen velden met zekerheid laag"><span class="dot" style="background:#e0625a"></span>Laag <b>' + n.laag + '</b></button></span>' +
        '<button class="btn klein kaal" id="volgende" title="Spring naar het volgende veld dat gecontroleerd moet worden"' + (n.middel + n.laag ? '' : ' disabled') + '>' + ico('omlaag', true) + ' Volgende</button></div>' +
        '<div class="knoppen"><label class="dnr">Dossier <input data-pad="dossierNr" value="' + esc(r.dossierNr || '') + '" placeholder="bijv. 426249"></label>' +
          '<button class="btn klein" id="res-export" title="Voorstel downloaden als JSON (kan in de handmatige modus weer worden ingelezen)">' + ico('download', true) + ' Exporteren</button>' +
          '<button class="btn klein" id="res-nieuw" title="Leeg paneel voor een nieuwe zending">' + ico('nieuw', true) + ' Nieuw</button></div></div>';
    renderFeiten();
    zetZFilter(zFilter);
  }

  function zetZFilter(f) {
    zFilter = f;
    alle('#zeker [data-zfilter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-zfilter') === f)); });
    var v = $('voorstel');
    if (v) { v.classList.toggle('f-controle', f === 'controle'); v.classList.toggle('f-laag', f === 'laag'); }
  }

  /** Focus op het volgende veld met zekerheid middel/laag (klapt het blok open als dat nodig is). */
  function volgendeTeControleren() {
    var velden = alle('#voorstel input[data-pad]').filter(function (i) {
      var tr = i.closest('tr'), g = i.closest('.groep');
      var z = (tr && tr.getAttribute('data-z')) || (g && g.getAttribute('data-z')) || (i.className.match(/z-(\w+)/) || [])[1];
      return z === 'middel' || z === 'laag';
    });
    if (!velden.length) return;
    var huidig = shadow.activeElement, start = velden.indexOf(huidig);
    var doel = velden[(start + 1) % velden.length];
    var d = doel.closest('details');
    if (d) d.open = true;
    alle('tr.doel').forEach(function (t) { t.classList.remove('doel'); });
    var tr = doel.closest('tr');
    if (tr) tr.classList.add('doel');
    doel.scrollIntoView({ block: 'center', behavior: 'smooth' });
    doel.focus({ preventScroll: true });
  }

  /* ---- brutogewicht per regel: herkomst en controle ---- */

  // Herkomst van het brutogewicht per regel -> zekerheid (voor kleur en filter "Te controleren")
  var BRUTO_Z = { document: '', rato: 'middel', handmatig: '', onbekend: 'middel', '': 'laag' };
  function brutoHerkomst(g) { return g.brutoBron || (g.brutoGewicht ? 'onbekend' : ''); }
  var Z_RANG = { hoog: 0, middel: 1, laag: 2 };
  function slechtste(l) { return l.reduce(function (a, z) { return (Z_RANG[z] || 0) > (Z_RANG[a] || 0) ? z : a; }, 'hoog'); }

  function brutoBadge(g) {
    switch (brutoHerkomst(g)) {
      case 'document': return '<span class="badge ok" title="Uit de documenten (paklijst, factuur, B/L of HC); niet herberekend of afgerond">document</span>';
      case 'rato': return '<span class="badge middel" title="Berekend: totaal brutogewicht (HC I.26) min de regels uit de documenten, verdeeld naar rato van het nettogewicht">berekend (rato)</span>';
      case 'handmatig': return '<span class="badge info" title="Door jou aangepast in het voorstel">aangepast</span>';
      case 'onbekend': return '<span class="badge middel" title="Voorstel van een oudere versie: niet bekend of dit uit een document komt of berekend is">herkomst onbekend</span>';
      default: return '<span class="badge laag" title="Geen brutogewicht voor deze regel">leeg</span>';
    }
  }

  /** Som bruto per regel tegen het totaal (0.01 kg); alleen een melding, er wordt niets aangepast. */
  function renderBrutoCheck() {
    var el = $('bruto-check');
    if (!el || !aiResultaat) return;
    var c = AI.controleerBruto(aiResultaat), g = aiResultaat.goederen;
    var tel = function (b) { return g.filter(function (x) { return (x.brutoBron || '') === b; }).length; };
    var herkomst = [[tel('document'), 'uit document'], [tel('rato'), 'berekend (rato)'], [tel('handmatig'), 'aangepast']]
      .filter(function (x) { return x[0]; }).map(function (x) { return x[0] + ' ' + x[1]; }).join(', ');
    if (!c.heeftTotaal) {
      el.innerHTML = '<div class="melding aandacht"><b>Brutogewicht niet te controleren:</b> geen totaal brutogewicht (HC I.26). Vul het totaal in bij Algemeen.</div>';
    } else if (c.leeg) {
      el.innerHTML = '<div class="melding fout"><b>Brutogewicht ontbreekt</b> voor ' + c.leeg + ' regel' + (c.leeg === 1 ? '' : 's') + '. Som van de ingevulde regels ' + esc(c.som) + ' kg, totaal ' + esc(c.totaal) + ' kg.</div>';
    } else if (!c.ok) {
      el.innerHTML = '<div class="melding fout" id="bruto-verschil"><b>Som brutogewicht per regel ≠ totaal.</b> Som ' + esc(c.som) + ' kg, totaal ' + esc(c.totaal) + ' kg (HC I.26), verschil ' + esc(c.verschil) + ' kg. Er is niets aangepast: corrigeer de regels of het totaal.' + (herkomst ? '<div class="small">' + esc(herkomst) + '</div>' : '') + '</div>';
    } else {
      el.innerHTML = '<div class="melding ok"><b>Brutogewicht klopt:</b> som per regel = totaal ' + esc(c.totaal) + ' kg' + (herkomst ? ' · ' + esc(herkomst) : '') + '.</div>';
    }
  }

  /** Na het invullen: Gross weight terug uit het Portbase-formulier lezen en de som controleren. */
  function controleerBrutoInPortbase() {
    var waarden = FILL.brutoInFormulier();
    if (!waarden.length) return { soort: 'info', tekst: 'Gross weight kon na het invullen niet uit het formulier worden teruggelezen; controleer de som zelf.' };
    var totaal = AI.leesGewicht(aiResultaat.totaalBrutoGewicht.waarde).getal;
    var som = waarden.reduce(function (a, w) { return a + Math.round(AI.leesGewicht(w).getal * 100); }, 0);
    var anders = waarden.map(function (w, i) {
      var v = aiResultaat.goederen[i];
      return v && Math.round(AI.leesGewicht(w).getal * 100) !== Math.round(AI.leesGewicht(v.brutoGewicht).getal * 100) ? 'regel ' + (i + 1) + ': ' + (w || 'leeg') + ' i.p.v. ' + v.brutoGewicht : '';
    }).filter(Boolean);
    var somKg = (som / 100).toFixed(2), verschil = ((som - Math.round(totaal * 100)) / 100).toFixed(2);
    if (!totaal) return { soort: 'aandacht', tekst: 'Gross weight in Portbase: som ' + somKg + ' kg; geen totaal brutogewicht om mee te vergelijken.' };
    if (Math.abs(som - Math.round(totaal * 100)) > 1 || anders.length) {
      return { soort: 'fout', tekst: 'Gross weight in Portbase: som ' + somKg + ' kg, totaal ' + totaal.toFixed(2) + ' kg (verschil ' + verschil + ' kg).' + (anders.length ? ' Afwijkend van het voorstel: ' + anders.join('; ') + '.' : '') + ' Niets aangepast; controleer de goederenregels voordat je indient.' };
    }
    return { soort: 'ok', tekst: 'Gross weight in Portbase: som ' + somKg + ' kg = totaal brutogewicht (' + waarden.length + ' regels).' };
  }
  var brutoNaInvullen = null;

  /* ---- aandachtspunten-triage ---- */

  var NIVEAU_ICO = { kritiek: 'kritiek', let: 'let', info: 'info' };
  var NIVEAU_RANG = { kritiek: 0, let: 1, info: 2 };

  function renderTriage(animeerIndex) {
    var el = $('triage');
    if (!aiResultaat) { el.innerHTML = ''; return; }
    var w = aiResultaat.waarschuwingen, tr = aiResultaat.triage || {};
    var advies = G.triageAdvies(geheugen, aiOrigineel || aiResultaat), info = profielInfo();
    var punten = w.map(function (t, i) { return { t: t, i: i, niveau: G.niveau(t), st: tr[t], adv: advies[t] || {} }; });
    var open = punten.filter(function (p) { return !p.st; }).sort(function (a, b) { return NIVEAU_RANG[a.niveau] - NIVEAU_RANG[b.niveau] || a.i - b.i; });
    var klaar = punten.filter(function (p) { return p.st; });
    var bronKnop = function (p) { var i = bronBestand(p.t); return bestanden.length && i >= 0 ? '<button class="btn klein kaal" data-bron="' + esc(p.t) + '" title="Toon in document">' + ico('oog', true) + '</button>' : ''; };
    var html = '<section class="kaart triage"><div class="kaart-kop"><h3>Aandachtspunten</h3><span class="teller" id="triage-teller"><b>' + klaar.length + '</b> / ' + w.length + ' gecontroleerd</span></div>' +
      '<div class="tvoortgang"><i style="width:' + (w.length ? Math.round(100 * klaar.length / w.length) : 100) + '%"></i></div>';
    if (!w.length) html += '<div class="schoon"><span class="rond">' + ico('check', true) + '</span>Geen aandachtspunten in dit voorstel.</div>';
    else if (!open.length) html += '<div class="schoon"><span class="rond">' + ico('check', true) + '</span>Alles gecontroleerd en akkoord.</div>';
    else {
      html += '<ul class="tp-lijst">' + open.map(function (p) {
        var meta = [];
        if (p.adv.akkoord) meta.push('<span class="badge mem" title="Bij dit profiel eerder ' + p.adv.akkoord + ' van ' + p.adv.gezien + ' keer akkoord">' + ico('mem', true) + ' eerder ' + p.adv.akkoord + '× akkoord</span>');
        if (p.niveau === 'kritiek') meta.push('<span class="badge laag">kritiek</span>');
        return '<li class="tp ' + p.niveau + '" data-tp="' + p.i + '"><div><div class="tp-kaart"><span class="tp-ico">' + ico(NIVEAU_ICO[p.niveau], true) + '</span>' +
          '<div class="tp-tekst">' + esc(p.t) + (meta.length ? '<div class="tp-meta">' + meta.join('') + '</div>' : '') + '</div>' +
          '<div class="tp-acties"><button class="btn klein ok" data-akkoord="' + p.i + '" title="Gecontroleerd & akkoord">' + ico('check', true) + ' Akkoord</button>' + bronKnop(p) + '</div></div></div></li>';
      }).join('') + '</ul>';
      if (open.length > 1) html += '<div style="margin-top:.5rem;text-align:right"><button class="btn klein kaal" id="alles-akkoord">Alle ' + open.length + ' akkoord</button></div>';
    }
    if (klaar.length) {
      html += '<details class="tp-klaar"' + (open.length ? '' : ' open') + '><summary>' + ico('check', true) + ' Gecontroleerd (' + klaar.length + ')</summary><ul>' + klaar.map(function (p) {
        var auto = p.st === 'auto';
        return '<li><span class="v">' + ico('check', true) + '</span><span class="t">' + esc(p.t) + (auto ? ' <span class="badge mem" title="Voorgevinkt door Smart Memory">' + (p.adv.altijd ? 'altijd akkoord' : 'eerder ' + p.adv.akkoord + '× akkoord') + '</span>' : '') + '</span>' +
          '<span class="acties"><button class="link small" data-ongedaan="' + p.i + '">Ongedaan</button>' +
          (info ? '<button class="link small" data-altijd="' + p.i + '" title="Dit soort melding bij deze route voortaan automatisch afvinken">' + (p.adv.altijd ? 'Niet meer automatisch' : 'Altijd bij deze route') + '</button>' : '') + '</span></li>';
      }).join('') + '</ul></details>';
    }
    el.innerHTML = html + '</section>';
    var tel = $('triage-teller');
    if (animeerIndex != null && tel) { tel.classList.remove('pop'); void tel.offsetWidth; tel.classList.add('pop'); }
  }

  function akkoord(i) {
    var t = aiResultaat.waarschuwingen[i];
    if (!t) return;
    var li = shadow.querySelector('.tp[data-tp="' + i + '"]');
    aiResultaat.triage[t] = 'akkoord';
    bewaarVoorstel();
    var klaar = function () { renderTriage(i); updateStepper(); if (!openPunten()) toast('Alle aandachtspunten gecontroleerd'); };
    if (li && !matchMedia('(prefers-reduced-motion: reduce)').matches) { li.classList.add('weg'); setTimeout(klaar, 240); } else klaar();
  }
  function allesAkkoord() {
    aiResultaat.waarschuwingen.forEach(function (t) { if (!aiResultaat.triage[t]) aiResultaat.triage[t] = 'akkoord'; });
    bewaarVoorstel(); renderTriage(0); updateStepper();
    toast('Alle aandachtspunten gecontroleerd');
  }
  function ongedaan(i) {
    delete aiResultaat.triage[aiResultaat.waarschuwingen[i]];
    bewaarVoorstel(); renderTriage(); updateStepper();
  }
  function altijdAkkoord(i) {
    var t = aiResultaat.waarschuwingen[i], info = profielInfo();
    if (!t || !info) return;
    var aan = !G.triageAdvies(geheugen, aiOrigineel || aiResultaat)[t].altijd;
    G.zetAltijdAkkoord(geheugen, info.sleutel, t, aan);
    bewaarGeheugen();
    renderTriage();
    toast(aan ? 'Bij deze route voortaan automatisch akkoord' : 'Niet meer automatisch akkoord', 'mem');
  }

  /* ---- hele voorstel ---- */

  /** Aantal regels van HC-vak I.27 achter de goederenitems (samengevoegde items tellen per regel). */
  function aantalHcRegels(r) {
    return r.goederen.reduce(function (t, g) { return t + Math.max(1, String(g.hcRegels || '').split(',').filter(function (x) { return x.trim(); }).length); }, 0);
  }
  /** Losse HC-regels van een samengevoegd goederenitem: colli en gewichten per regel. */
  function samenTabel(g) {
    if (!g.regelsApart || !g.regelsApart.length) return '<span class="small">HC-regels ' + esc(g.hcRegels) + ' (samengevoegd door de AI; controleer de opgetelde colli en gewichten)</span>';
    return '<span class="small">' + g.regelsApart.map(function (x) {
      return '<b>' + esc(x.hcRegels) + '</b> ' + esc(x.aantalColli || '?') + ' colli, ' + esc(x.nettoGewicht || '?') + ' kg netto' + (x.brutoGewicht ? ', ' + esc(x.brutoGewicht) + ' kg bruto' : '') + (x.batchnummer ? ', batch ' + esc(x.batchnummer) : '');
    }).join('<br>') + '</span>';
  }

  function renderAiResultaat() {
    var r = aiResultaat;
    memPaden = {};
    ((r.geheugen || {}).toegepast || []).forEach(function (x) { if (!x.teruggedraaid) memPaden[x.pad] = 1; });
    $('ws').setAttribute('data-leeg', '0');
    $('start').innerHTML = '';
    renderDossier();
    renderKop();

    var html = '<section class="kaart profiel" id="profiel" hidden></section><div id="voorstel">';
    html += blok('blok-alg', 'Algemeen, goederen en vervoer', '<table class="velden">' + ALG_LABELS.map(function (l) {
      var w = r[l[0]];
      return rij(esc(l[1]), invoer(l[0] + '.waarde', w.waarde, w.zekerheid, { datum: l[0] === 'aankomstDatum' }), w.zekerheid, zekerheidBadge(w.zekerheid, w.bron));
    }).join('') + '</table>', telPil(ALG_LABELS.filter(function (l) { return r[l[0]].zekerheid !== 'hoog'; }).length, 'let'));

    // Organisaties: naam, adres, plaats, land en erkenningsnummer bepalen samen welke regel in de Portbase-dialoog gekozen wordt.
    var orgs = [['exporteur', 'Exporter (I.1)'], ['importeur', 'Importer (I.6)'], ['plaatsBestemming', 'Place of destination (I.7)'], ['plaatsVerzending', 'Place of dispatch / establishment of origin (I.11)']];
    html += blok('blok-org', 'Organisaties', orgs.map(function (o) {
      var p = r[o[0]];
      return groep(esc(o[1]) + ' ' + zekerheidBadge(p.zekerheid, p.bron), [['naam', 'Naam'], ['adres', 'Adres'], ['plaats', 'Plaats'], ['land', 'Land (ISO)'], ['erkenningsnummer', 'Erkenningsnummer']].map(function (x) {
        return rij(x[1], invoer(o[0] + '.' + x[0], p[x[0]]));
      }).join('') + '</table><div class="geleerd" data-geleerd="' + o[0] + '">' + geleerdHtml(o[0]) + '</div><table class="velden">', p.zekerheid);
    }).join(''), telPil(orgs.filter(function (o) { return r[o[0]].zekerheid !== 'hoog'; }).length, 'let'), true);

    if (r.containers.length) {
      html += blok('blok-cont', 'Containers (I.17)', r.containers.map(function (c, i) {
        return groep('Transport equipment ' + (i + 1) + (c.bron ? ' <button class="badge info" data-bron="' + esc(c.bron) + '" title="Bron: ' + esc(c.bron) + ' – klik om het document te tonen">bron</button>' : ''), FILL.CONTAINER.map(function (d) {
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
        (hc ? rij('Certificate reference (I.2)', invoer('documenten.' + i + '.certificaatReferentie', doc.certificaatReferentie) + '<span class="datum-hint" style="color:#64748b">Alleen als nummer als de IMSOC-referentie ontbreekt; telt mee als verwijzing van het labrapport</span>') : '') +
        rij('Verwijst naar', invoer('documenten.' + i + '.verwijstNaar', doc.verwijstNaar)) +
        rij('Bestand', doc.bestand ? '<button class="link small" data-bron="' + esc(doc.type) + '" data-bestand="' + esc(doc.bestand) + '" title="Toon in de documentviewer">' + esc(doc.bestand) + '</button>' : '<span class="small">–</span>', '', zekerheidBadge(doc.zekerheid, doc.type, doc.bestand));
      docs += '<div class="' + (doc.opnemen ? '' : 'uit') + '" id="docgroep-' + i + '">' + groep('<span class="dn">Document ' + (i + 1) + ' – ' + esc((RULES.DOC_TYPES[doc.type] || {}).naam || doc.type) + '</span>', rijen, doc.zekerheid) + '</div>';
    });
    html += blok('blok-docs', 'Documenten (I.9)', docs, telPil(r.documenten.filter(function (d) { return d.opnemen; }).length, 'ok'));

    html += blok('blok-goed', 'Goederenitems (I.31-I.34)', (r.goederen.length ? '<div id="bruto-check"></div>' : '') + r.goederen.map(function (g, i) {
      var bz = BRUTO_Z[brutoHerkomst(g)];
      return groep('Goods item ' + (i + 1) + ' ' + zekerheidBadge(g.zekerheid, g.bron) + (g.gnCode ? ' <span class="muted small">GN ' + esc(g.gnCode) + '</span>' : '') +
        (g.samengevoegd ? ' <span class="badge samen" id="samen-' + i + '" title="Regels van HC-vak I.27 met dezelfde GN-code, soort en bedrijf zijn samengevoegd tot dit goederenitem">Samengevoegd: HC-regels ' + esc(g.hcRegels) + '</span>' : (g.hcRegels ? ' <span class="muted small">HC ' + esc(g.hcRegels) + '</span>' : '')), FILL.GOED.map(function (d) {
        if (d.key === 'brutoGewicht') return rij(esc(d.naam), invoer('goederen.' + i + '.brutoGewicht', g.brutoGewicht, bz), bz, '<span id="bruto-bron-' + i + '">' + brutoBadge(g) + '</span>');
        return rij(esc(d.naam), invoer('goederen.' + i + '.' + d.key, g[d.key], d.key === 'gnCode' ? g.zekerheid : ''));
      }).join('') +
        (g.samengevoegd ? rij('Samengevoegd uit', samenTabel(g)) : '') +
        rij('Code op HC (zoekterm GN)', invoer('goederen.' + i + '.gnCodeHc', g.gnCodeHc)) +
        rij('Soort (wetensch. naam, I.28)', invoer('goederen.' + i + '.wetenschappelijkeNaam', g.wetenschappelijkeNaam)) +
        rij('Aard product (HC I.28)', invoer('goederen.' + i + '.aardProduct', g.aardProduct)) +
        rij('ANIMO code', '<select data-animo="' + i + '"><option value="">– kies –</option>' + AI.ANIMO_CODES.map(function (a) {
          return '<option value="' + esc(a.code) + '"' + (a.code === g.animoCode ? ' selected' : '') + '>' + esc(a.code + ' – ' + a.omschrijving) + '</option>'; }).join('') + '</select>'), slechtste([g.zekerheid, bz || 'hoog']));
    }).join('') || '<div class="melding aandacht">Geen goederenitems herkend.</div>', telPil(r.goederen.length));

    html += '</div><div id="ai-verslag"></div>';
    $('ai-result').innerHTML = html;
    renderBrutoCheck();
    $('check-kaart').innerHTML = '<details class="kaart" id="blok-check" open><summary>Benodigde documenten <span class="rechts" id="check-status"></span></summary><div id="ai-check"></div></details>';
    zetZFilter(zFilter);
    renderProfiel();
    renderTriage();
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
  function bepaalDocumentenVoor(r) {
    var decl = AI.naarDeclaratie(r);
    var index = {};
    rules.forEach(function (x) { index[x.id] = x; });
    var eisen = decl.goederen.map(function (g) { return ENGINE.requirementsFor({ type: decl.type, gn: g.gn, animo: g.animo, land: decl.landOorsprong }, rules).vereisten; });
    AI.bepaalGgbDocumenten(r, eisen, function (id) { return index[id]; });
  }
  function bepaalDocumenten() { if (aiResultaat) bepaalDocumentenVoor(aiResultaat); }

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
    var res = ENGINE.checkDeclaration(decl, rules);
    el.innerHTML = R.renderDeclResult(res);
    if ($('check-status')) $('check-status').innerHTML = R.badge(res.status);
  }

  function updateFillKnop() {
    var knop = $('ai-fill');
    if (!knop) return;
    var ok = FILL.formulierAanwezig();
    knop.disabled = !ok || vulBezig;
    if (vulBezig) return;
    var open = openPunten();
    $('ai-fill-hint').textContent = ok ? (open ? open + ' aandachtspunt' + (open === 1 ? '' : 'en') + ' nog niet gecontroleerd. ' : '') + 'De declaratie wordt niet opgeslagen of verstuurd: alleen in de zoekvensters klikt de extensie op Save. Controleer het formulier en klik zelf op Save/Send.' : 'Open in Portbase "New declaration" (of een bewerkbare declaratie) om in te vullen.';
  }

  function vulOpties() {
    var inv = aiInst.invullen || {};
    return { datumFormaat: datumFormaat(), maxWacht: inv.maxWacht || 120, trefwoorden: inv.trefwoorden !== false, geheugen: geheugen };
  }

  var ST_ICO = { ingevuld: '✓', handmatig: '!', 'niet gevonden': '?', fout: '✕', overgeslagen: '–' };
  var ST_VOLGORDE = ['ingevuld', 'handmatig', 'niet gevonden', 'fout', 'overgeslagen'];

  async function aiInvullen() {
    if (!aiResultaat || vulBezig) return;
    vulBezig = true;
    leerNu();
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
      brutoNaInvullen = controleerBrutoInPortbase();
      if (brutoNaInvullen.soort === 'fout') toast('Let op: som Gross weight in Portbase klopt niet met het totaal', 'info');
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
      (brutoNaInvullen ? '<div class="melding ' + brutoNaInvullen.soort + '" id="bruto-portbase">' + esc(brutoNaInvullen.tekst) + '</div>' : '') +
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
    alle('#verslag-filters button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === verslagFilter)); });
    alle('#ai-verslag .verslag li').forEach(function (li) { li.hidden = verslagFilter !== 'alle' && li.getAttribute('data-status') !== verslagFilter; });
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
      m.style.color = res.gekozen ? '#0f7b4f' : '';
      m.textContent = (res.gekozen ? '✓ ' : '') + (res.melding || '') + (res.gekozen ? ' – klik Save in het venster' : '');
    });
  }

  /* ======================= start ======================= */

  function start() {
    buildPanel();
    laadGeheugen();
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
