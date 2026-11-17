/*
 * Documentviewer van het GGB-paneel. Draait als extensiepagina in een iframe in
 * het paneel (Shadow DOM op de Portbase-pagina), zodat de PDF-viewer van de
 * browser werkt zonder de beveiligingsregels (CSP) van Portbase te raken.
 * Het paneel stuurt het bestand met postMessage; niets gaat naar een server.
 *
 * Bericht van het paneel: { type: 'ggb:toon', naam, mediaType, data: ArrayBuffer, pagina }
 * Antwoord aan het paneel: { type: 'ggb:viewer-klaar' } zodra de viewer luistert.
 */
(function () {
  'use strict';
  var PORTBASE = 'https://food-and-consumer-products.pcs.portbase.com';
  var pdf = document.getElementById('pdf'), afb = document.getElementById('afb'), img = document.getElementById('img');
  var huidig = null; // { sleutel, url, pdf }

  function toon(m) {
    var sleutel = m.naam + '|' + (m.data ? m.data.byteLength : 0);
    var isPdf = m.mediaType === 'application/pdf';
    if (!huidig || huidig.sleutel !== sleutel) {
      if (huidig) URL.revokeObjectURL(huidig.url);
      huidig = { sleutel: sleutel, url: URL.createObjectURL(new Blob([m.data], { type: m.mediaType })), pdf: isPdf };
    }
    var pagina = Math.max(1, parseInt(m.pagina, 10) || 1);
    document.body.dataset.staat = 'document';
    document.body.dataset.bestand = m.naam;
    document.body.dataset.pagina = String(pagina);
    document.getElementById('leeg').hidden = true;
    afb.hidden = isPdf; pdf.hidden = !isPdf;
    if (isPdf) {
      // Alleen het #page-fragment wijzigen laadt de PDF-viewer niet altijd opnieuw: eerst leegmaken.
      var doel = huidig.url + '#page=' + pagina + '&view=FitH';
      if (pdf.src === doel) return;
      pdf.src = 'about:blank';
      setTimeout(function () { pdf.src = doel; }, 30);
    } else {
      img.src = huidig.url;
      img.alt = m.naam;
    }
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== PORTBASE || e.source !== window.parent) return;
    var m = e.data || {};
    if (m.type === 'ggb:toon' && m.data) toon(m);
  });
  window.parent.postMessage({ type: 'ggb:viewer-klaar' }, PORTBASE);
})();
