'use strict';

var SLEUTEL = 'ggb.ai';

function el(id) { return document.getElementById(id); }

chrome.storage.local.get(SLEUTEL, function (res) {
  var inst = res[SLEUTEL] || {};
  el('apiKey').value = inst.apiKey || '';
  el('model').value = inst.model || 'claude-opus-5-5';
  el('effort').value = inst.effort || 'high';
});

el('save').addEventListener('click', function () {
  var inst = { apiKey: el('apiKey').value.trim(), model: el('model').value, effort: el('effort').value };
  var o = {};
  o[SLEUTEL] = inst;
  chrome.storage.local.set(o, function () {
    el('msg').textContent = 'Opgeslagen.';
    setTimeout(function () { el('msg').textContent = ''; }, 2000);
  });
});
