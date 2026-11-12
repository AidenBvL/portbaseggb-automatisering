/*
 * Draait in de pagina zelf (content script met "world": "MAIN", document_start).
 *
 * Houdt bij of Portbase nog een verzoek (fetch/XHR) open heeft, zodat de
 * invuller na "Search" in een zoekvenster kan wachten tot Portbase echt
 * geantwoord heeft. Angular toont tijdens het zoeken vaak al "No results";
 * zonder dit signaal is dat niet te onderscheiden van een echt leeg resultaat.
 *
 * Alleen tijdstippen (start/einde) worden bijgehouden, nooit adressen of inhoud.
 * Ze staan als JSON in het attribuut data-ggb-net van <html>:
 *   { l: [start van lopende verzoeken], g: [start van recente verzoeken], k: [[start, einde] van recent afgeronde] }
 */
(function () {
  'use strict';
  if (window.__ggbNet) return;
  window.__ggbNet = true;

  var lopend = {}, volgnr = 0, gestart = [], klaar = [];

  function publiceer() {
    try {
      var l = [];
      for (var k in lopend) l.push(lopend[k]);
      document.documentElement.setAttribute('data-ggb-net', JSON.stringify({ l: l, g: gestart, k: klaar }));
    } catch (e) { /* negeren */ }
  }
  function begin() {
    var n = ++volgnr, t = Date.now();
    lopend[n] = t;
    gestart.push(t);
    if (gestart.length > 40) gestart.shift();
    publiceer();
    return n;
  }
  function einde(n) {
    if (!(n in lopend)) return;
    klaar.push([lopend[n], Date.now()]);
    if (klaar.length > 40) klaar.shift();
    delete lopend[n];
    publiceer();
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function () {
      var n = begin();
      try {
        return origFetch.apply(this, arguments).then(function (r) { einde(n); return r; }, function (e) { einde(n); throw e; });
      } catch (e) { einde(n); throw e; }
    };
  }

  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var n = begin();
    this.addEventListener('loadend', function () { einde(n); });
    try { return origSend.apply(this, arguments); } catch (e) { einde(n); throw e; }
  };

  publiceer();
})();
