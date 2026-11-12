/* Instellingenpagina: AI-aanbieder, sleutels en modellen, handmatige prompt, privacy. Wijzigingen worden direct opgeslagen. */
'use strict';

var AI = window.GGB_AI;
var SLEUTEL = 'ggb.ai';
var MODELLEN = 'ggb.ai.modellen';     // laatst opgehaalde modellenlijst per aanbieder
var VOLGORDE = ['claude', 'openai', 'gemini', 'handmatig'];

var inst = AI.instellingen({});
var modellenCache = {};
var opslaanTimer = null;

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function toast(tekst) {
  var t = $('toast');
  t.textContent = tekst;
  t.classList.add('zichtbaar');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { t.classList.remove('zichtbaar'); }, 1800);
}

function opslaan(direct) {
  clearTimeout(opslaanTimer);
  opslaanTimer = setTimeout(function () {
    var o = {};
    o[SLEUTEL] = inst;
    chrome.storage.local.set(o, function () {
      var nu = new Date();
      $('opgeslagen').textContent = '✓ Opgeslagen om ' + String(nu.getHours()).padStart(2, '0') + ':' + String(nu.getMinutes()).padStart(2, '0');
      renderKaarten();
    });
  }, direct ? 0 : 400);
}

/* ---------------- navigatie ---------------- */

function toonPagina() {
  var p = (location.hash || '#aanbieder').slice(1);
  if (!$('pagina-' + p)) p = 'aanbieder';
  document.querySelectorAll('.pagina').forEach(function (s) { s.hidden = s.id !== 'pagina-' + p; });
  document.querySelectorAll('nav a').forEach(function (a) { a.classList.toggle('actief', a.getAttribute('data-pagina') === p); });
  if (p === 'prompt') $('prompt-tekst').value = AI.handmatigePrompt([], '');
  if (p === 'invullen') renderInvullen();
}
// Direct wisselen bij klikken (niet wachten op hashchange).
document.querySelectorAll('nav a').forEach(function (a) {
  a.addEventListener('click', function () { setTimeout(toonPagina, 0); });
});
window.addEventListener('hashchange', toonPagina);

/* ---------------- aanbieder ---------------- */

function statusVan(id) {
  if (id === 'handmatig') return { tekst: 'Geen sleutel nodig', klasse: 'klaar' };
  var p = inst[id];
  if (p.apiKey && p.model) return { tekst: 'Klaar · ' + p.model, klasse: 'klaar' };
  if (p.apiKey) return { tekst: 'Kies een model', klasse: '' };
  return { tekst: 'Geen sleutel', klasse: '' };
}

function renderKaarten() {
  $('kaarten').innerHTML = VOLGORDE.map(function (id) {
    var meta = AI.PROVIDERS[id], st = statusVan(id), actief = inst.provider === id;
    return '<button class="kaart" role="radio" aria-checked="' + actief + '" data-provider="' + id + '">' +
      '<span class="vink"></span><span class="naam">' + esc(meta.naam) + '</span><span class="bedrijf">' + esc(meta.bedrijf) + '</span>' +
      '<span class="status ' + (actief ? 'actief' : st.klasse) + '">' + esc(actief ? 'In gebruik' : st.tekst) + '</span></button>';
  }).join('');
}

function renderConfig() {
  var id = inst.provider, meta = AI.PROVIDERS[id], el = $('config');
  if (id === 'handmatig') {
    el.innerHTML = '<h2>Handmatig via een chat</h2>' +
      '<p>Er wordt niets automatisch verstuurd. In het paneel op de Portbase-pagina kopieer je de prompt, plak je die samen met de documenten in ChatGPT, Gemini of Claude, en plak je het JSON-antwoord terug.</p>' +
      '<a class="knop" href="#prompt">Prompt bekijken en kopiëren →</a>' +
      '<p class="hint">Je kunt in het paneel altijd ook handmatig werken, ook als hierboven een aanbieder met API-sleutel is gekozen.</p>';
    return;
  }
  var p = inst[id], lijst = modellenCache[id] || [];
  el.innerHTML =
    '<h2>' + esc(meta.naam) + ' <span class="hint">(' + esc(meta.bedrijf) + ')</span></h2>' +
    '<div class="veld"><label for="sleutel">API-sleutel</label>' +
      '<div class="invoer"><input type="password" id="sleutel" autocomplete="off" spellcheck="false" placeholder="' + esc(meta.sleutelVoorbeeld) + '" value="' + esc(p.apiKey) + '">' +
      '<button class="knop" id="toon" type="button" aria-label="Sleutel tonen">Toon</button></div>' +
      '<p class="hint">Nog geen sleutel? <a href="' + esc(meta.sleutelUrl) + '" target="_blank" rel="noopener">Maak er een aan bij ' + esc(meta.bedrijf) + ' ↗</a>. Gebruik bij voorkeur een aparte sleutel met een bestedingslimiet.</p></div>' +
    '<div class="veld"><label for="model">Model</label>' +
      '<div class="invoer"><input type="text" id="model" list="modellen-lijst" autocomplete="off" spellcheck="false" placeholder="' + (lijst.length ? 'Kies of typ een model' : 'Klik op Modellen ophalen') + '" value="' + esc(p.model) + '">' +
      '<datalist id="modellen-lijst">' + lijst.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.naam !== m.id ? m.naam : '') + '</option>'; }).join('') + '</datalist>' +
      '<button class="knop primair" id="ophalen" type="button">Modellen ophalen</button></div>' +
      '<p class="hint">' + (lijst.length ? lijst.length + ' modellen beschikbaar met deze sleutel. ' : '') + 'Ophalen test meteen of de sleutel werkt. Het model moet PDF\'s en afbeeldingen kunnen lezen.' +
      (meta.standaardModel ? ' Standaard: <code>' + esc(meta.standaardModel) + '</code>.' : '') + '</p>' +
      '<div id="ophaal-melding"></div></div>' +
    (meta.effort ? '<div class="veld"><label>Grondigheid</label><div class="segment" id="effort">' +
      [['medium', 'Gemiddeld'], ['high', 'Hoog (aanbevolen)'], ['xhigh', 'Zeer hoog']].map(function (e) {
        return '<button type="button" data-effort="' + e[0] + '" aria-pressed="' + (p.effort === e[0]) + '">' + e[1] + '</button>';
      }).join('') + '</div><p class="hint">Hoger is grondiger maar trager en duurder.</p></div>' : '');

  $('sleutel').addEventListener('input', function (e) { p.apiKey = e.target.value.trim(); opslaan(); });
  $('model').addEventListener('input', function (e) { p.model = e.target.value.trim(); opslaan(); });
  $('toon').addEventListener('click', function () {
    var s = $('sleutel'), zicht = s.type === 'password';
    s.type = zicht ? 'text' : 'password';
    this.textContent = zicht ? 'Verberg' : 'Toon';
  });
  $('ophalen').addEventListener('click', haalModellen);
  if ($('effort')) $('effort').addEventListener('click', function (e) {
    var w = e.target.getAttribute('data-effort');
    if (!w) return;
    p.effort = w;
    this.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === e.target)); });
    opslaan();
  });
}

function haalModellen() {
  var id = inst.provider, p = inst[id], knop = $('ophalen'), m = $('ophaal-melding');
  if (!p.apiKey) { m.innerHTML = '<div class="melding fout">Vul eerst een API-sleutel in.</div>'; return; }
  knop.disabled = true;
  knop.textContent = 'Bezig…';
  chrome.runtime.sendMessage({ type: 'ggb:modellen', provider: id, apiKey: p.apiKey }, function (res) {
    knop.disabled = false;
    knop.textContent = 'Modellen ophalen';
    if (chrome.runtime.lastError || !res) { m.innerHTML = '<div class="melding fout">Geen antwoord van de extensie. Herlaad de extensie en probeer opnieuw.</div>'; return; }
    if (!res.ok) { m.innerHTML = '<div class="melding fout">' + esc(res.melding) + '</div>'; return; }
    modellenCache[id] = res.modellen;
    var o = {};
    o[MODELLEN] = modellenCache;
    chrome.storage.local.set(o);
    var gekozen = '';
    if (!p.model && res.modellen.length) {
      var std = AI.PROVIDERS[id].standaardModel;
      p.model = res.modellen.some(function (x) { return x.id === std; }) ? std : res.modellen[0].id;
      gekozen = ' Model ingesteld op ' + p.model + '; pas aan als je een ander wilt.';
      opslaan(true);
    }
    var bestaat = !p.model || res.modellen.some(function (x) { return x.id === p.model; });
    renderConfig();
    $('ophaal-melding').innerHTML = '<div class="melding ok">✓ Sleutel werkt · ' + res.modellen.length + ' modellen gevonden.' + esc(gekozen) + '</div>' +
      (bestaat ? '' : '<div class="melding fout">Het gekozen model "' + esc(p.model) + '" staat niet in de lijst van deze sleutel.</div>');
  });
}

$('kaarten').addEventListener('click', function (e) {
  var k = e.target.closest('.kaart');
  if (!k) return;
  inst.provider = k.getAttribute('data-provider');
  renderKaarten();
  renderConfig();
  opslaan(true);
});

/* ---------------- invullen in Portbase ---------------- */

function renderInvullen() {
  var inv = inst.invullen;
  $('datumformaat').querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-formaat') === inv.datumFormaat)); });
  var sel = $('maxwacht');
  if (!sel.querySelector('option[value="' + inv.maxWacht + '"]')) sel.insertAdjacentHTML('beforeend', '<option value="' + inv.maxWacht + '">' + inv.maxWacht + ' seconden</option>');
  sel.value = String(inv.maxWacht);
  $('trefwoorden').checked = inv.trefwoorden;
}
$('datumformaat').addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (!b) return;
  inst.invullen.datumFormaat = b.getAttribute('data-formaat');
  renderInvullen();
  opslaan(true);
});
$('maxwacht').addEventListener('change', function () { inst.invullen.maxWacht = +this.value; opslaan(true); });
$('trefwoorden').addEventListener('change', function () { inst.invullen.trefwoorden = this.checked; opslaan(true); });

/* ---------------- handmatige prompt ---------------- */

$('prompt-kopie').addEventListener('click', function () {
  navigator.clipboard.writeText($('prompt-tekst').value).then(function () { toast('Prompt gekopieerd'); }, function () { toast('Kopiëren mislukt'); });
});
$('prompt-download').addEventListener('click', function () {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([$('prompt-tekst').value], { type: 'text/plain' }));
  a.download = 'ggb-prompt.txt';
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
});

/* ---------------- privacy ---------------- */

$('wis-alles').addEventListener('click', function () {
  if (!confirm('Alle API-sleutels en AI-instellingen uit deze browser verwijderen?')) return;
  chrome.storage.local.remove([SLEUTEL, MODELLEN, 'ggb.ai.laatste'], function () {
    inst = AI.instellingen({});
    modellenCache = {};
    renderKaarten();
    renderConfig();
    toast('Alles gewist');
  });
});

/* ---------------- start ---------------- */

var versie = chrome.runtime.getManifest().version;
$('versie').textContent = 'Versie ' + versie;
$('over-versie').textContent = versie;

chrome.storage.local.get([SLEUTEL, MODELLEN], function (res) {
  inst = AI.instellingen(res[SLEUTEL]);
  modellenCache = res[MODELLEN] || {};
  // Oud formaat ({apiKey, model, effort}) meteen in het nieuwe formaat bewaren.
  if (res[SLEUTEL] && !res[SLEUTEL].provider) opslaan(true);
  renderKaarten();
  renderConfig();
  toonPagina();
});
