/* Service worker: levert de kennisbank (JSON) aan het content script en opent de volledige tool. */
'use strict';

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

chrome.action.onClicked.addListener(function () {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
