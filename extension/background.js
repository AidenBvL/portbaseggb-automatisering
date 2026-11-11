/*
 * Service worker: levert de kennisbank (JSON) aan het content script, opent de
 * volledige tool en voert het uitlezen van documenten met Claude uit
 * (ai.bundle.js, gebouwd uit ai/src/ met de Anthropic SDK).
 */
'use strict';

importScripts('ai.bundle.js');

var AI_INSTELLINGEN = 'ggb.ai';

var cache = null;

async function loadJson(path) {
  try {
    var r = await fetch(chrome.runtime.getURL(path));
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function loadData() {
  if (cache) return cache;
  var parts = await Promise.all([
    loadJson('data/rules.taric.json'),
    loadJson('data/taric-controls.json'),
    loadJson('data/landen.json'),
    loadJson('data/nomenclatuur.json'),
    loadJson('data/taric-meta.json')
  ]);
  cache = { taricRules: parts[0] || [], taric: parts[1], landen: parts[2] || {}, nomenclatuur: parts[3] || {}, meta: parts[4] };
  return cache;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'ggb:getData') {
    loadData().then(sendResponse);
    return true; // asynchroon antwoord
  }
  if (msg && msg.type === 'ggb:openTool') {
    chrome.storage.local.set({ 'ggb.import': msg.declaratie }, function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html') + '#import' });
    });
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

/* Uitlezen met AI via een lange verbinding: het content script stuurt elke 20 s
 * een ping, zodat de service worker actief blijft tijdens een lang verzoek. */
chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'ggb-ai') return;
  var open = true;
  port.onDisconnect.addListener(function () { open = false; });
  port.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'extract') return;
    chrome.storage.local.get(AI_INSTELLINGEN, function (opgeslagen) {
      var inst = opgeslagen[AI_INSTELLINGEN] || {};
      self.GGB_AI_CLIENT.extract({
        apiKey: inst.apiKey,
        model: inst.model || self.GGB_AI_CLIENT.STANDAARD_MODEL,
        effort: inst.effort || 'high',
        bestanden: msg.bestanden,
        context: msg.context
      }).then(function (res) {
        if (open) port.postMessage({ type: 'resultaat', resultaat: res.resultaat, model: res.model, gebruik: res.gebruik });
      }, function (e) {
        if (open) port.postMessage({ type: 'fout', melding: e && e.message ? e.message : String(e) });
      });
    });
  });
});

chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
