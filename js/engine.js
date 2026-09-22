/*
 * Regel-engine: bepaalt op basis van GN-code, Animo-code en land van
 * oorsprong welke documenten vereist zijn, en vergelijkt dat met de
 * documenten die in de declaratie aanwezig zijn.
 *
 * Pure functies, geen DOM. Werkt in de browser (window.GGB_ENGINE) en in
 * Node (module.exports) zodat de logica getest kan worden.
 */
(function (root) {
  'use strict';

  function norm(v) {
    return (v === undefined || v === null) ? '' : String(v).trim();
  }

  function normGn(gn) {
    return norm(gn).replace(/[^0-9]/g, '');
  }

  function normCode(v) {
    return norm(v).toUpperCase();
  }

  function inList(list, value, matcher) {
    if (!list || list === '*') return true;
    if (!Array.isArray(list)) list = [list];
    for (var i = 0; i < list.length; i++) {
      if (matcher(list[i], value)) return true;
    }
    return false;
  }

  function excluded(list, value, matcher) {
    if (!list || list === '*' || (Array.isArray(list) && list.length === 0)) return false;
    return inList(list, value, matcher);
  }

  var gnMatch = function (prefix, gn) { return gn.indexOf(normGn(prefix)) === 0; };
  var codeMatch = function (a, b) { return normCode(a) === b; };

  /** Geeft true als een regel van toepassing is op de context. */
  function matchRule(rule, ctx) {
    var type = normCode(ctx.type);
    var gn = normGn(ctx.gn);
    var animo = normCode(ctx.animo).split(' ')[0];
    var land = normCode(ctx.land);

    if (rule.type && rule.type !== '*' && normCode(rule.type) !== type) return false;
    if (!inList(rule.gn, gn, gnMatch)) return false;
    if (excluded(rule.gnExclude, gn, gnMatch)) return false;
    if (!inList(rule.animo, animo, codeMatch)) return false;
    if (excluded(rule.animoExclude, animo, codeMatch)) return false;
    if (!inList(rule.landen, land, codeMatch)) return false;
    if (excluded(rule.landenExclude, land, codeMatch)) return false;
    return true;
  }

  /**
   * Verzamelt de vereiste documenten voor één goederenitem.
   * Resultaat: { regels: [rule], vereisten: [{type, niveau, alternatieven, verwijstNaar, opmerkingen, regelIds}] }
   */
  function requirementsFor(ctx, rules) {
    var matched = [];
    var byType = {};
    var order = [];

    (rules || []).forEach(function (rule) {
      if (!matchRule(rule, ctx)) return;
      matched.push(rule);
      (rule.documenten || []).forEach(function (doc) {
        var key = normCode(doc.type);
        var req = byType[key];
        if (!req) {
          req = {
            type: key,
            niveau: doc.niveau || 'verplicht',
            alternatieven: [],
            verwijstNaar: null,
            opmerkingen: [],
            regelIds: []
          };
          byType[key] = req;
          order.push(key);
        }
        if (doc.niveau === 'verplicht') req.niveau = 'verplicht';
        (doc.alternatieven || []).forEach(function (a) {
          a = normCode(a);
          if (req.alternatieven.indexOf(a) < 0) req.alternatieven.push(a);
        });
        if (doc.verwijstNaar) req.verwijstNaar = normCode(doc.verwijstNaar);
        if (doc.opmerking) req.opmerkingen.push(doc.opmerking);
        req.regelIds.push(rule.id);
      });
    });

    return {
      regels: matched,
      vereisten: order.map(function (k) { return byType[k]; })
    };
  }

  function parseDate(s) {
    s = norm(s);
    if (!s) return null;
    var m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (m) {
      var d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
      // Portbase toont dd-mm-jjjj, maar de ETA kan als m/d/jjjj komen (Engelse locale).
      if (mo > 12 && d <= 12) { var t = d; d = mo; mo = t; }
      return new Date(m[3], mo - 1, d);
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(m[1], m[2] - 1, m[3]);
    return null;
  }

  function docsOfType(docs, type) {
    return (docs || []).filter(function (d) { return normCode(d.type) === type; });
  }

  /**
   * Controleert één goederenitem tegen de aanwezige documenten.
   * decl: { type, landOorsprong, landLading, eta, documenten: [{type, identificatie, datum, verwijstNaar}] }
   * goed: { gn, animo, omschrijving }
   */
  function checkItem(decl, goed, rules) {
    var ctx = { type: decl.type, gn: goed.gn, animo: goed.animo, land: decl.landOorsprong };
    var reqs = requirementsFor(ctx, rules);
    var docs = decl.documenten || [];
    var resultaten = [];
    var meldingen = [];

    if (normGn(goed.gn).length !== 8) {
      meldingen.push({ niveau: 'aandacht', tekst: 'GN-code "' + norm(goed.gn) + '" heeft niet de verwachte 8 cijfers.' });
    }

    reqs.vereisten.forEach(function (req) {
      var aanwezig = docsOfType(docs, req.type);
      var gebruiktType = req.type;
      if (aanwezig.length === 0) {
        for (var i = 0; i < req.alternatieven.length; i++) {
          var alt = docsOfType(docs, req.alternatieven[i]);
          if (alt.length) { aanwezig = alt; gebruiktType = req.alternatieven[i]; break; }
        }
      }

      var status, tekst = [];
      if (aanwezig.length === 0) {
        status = req.niveau === 'verplicht' ? 'ontbreekt' : 'aandacht';
        tekst.push(req.niveau === 'verplicht' ? 'Document ontbreekt in de declaratie.' : 'Document niet aanwezig; beoordeel of het van toepassing is.');
      } else {
        status = 'ok';
        if (gebruiktType !== req.type) tekst.push('Voldaan via alternatief document (' + gebruiktType + ').');
        aanwezig.forEach(function (d) {
          if (!norm(d.identificatie)) {
            status = 'aandacht';
            tekst.push('Identificatie (nummer) van het document ontbreekt.');
          }
          var dd = parseDate(d.datum), eta = parseDate(decl.eta);
          if (dd && eta && dd.getTime() > eta.getTime()) {
            status = 'aandacht';
            tekst.push('Afgiftedatum ' + norm(d.datum) + ' ligt na de verwachte aankomstdatum.');
          }
        });

        if (req.verwijstNaar) {
          var doelen = docsOfType(docs, req.verwijstNaar);
          if (doelen.length === 0) {
            status = status === 'ok' ? 'aandacht' : status;
            tekst.push('Moet verwijzen naar ' + req.verwijstNaar + ', maar dat document is niet aanwezig.');
          } else {
            var doelIds = doelen.map(function (d) { return normCode(d.identificatie); }).filter(Boolean);
            aanwezig.forEach(function (d) {
              var ref = normCode(d.verwijstNaar);
              if (!ref) {
                if (status === 'ok') status = 'aandacht';
                tekst.push('Controleer handmatig dat "' + norm(d.identificatie) + '" verwijst naar ' + req.verwijstNaar + ' ' + doelIds.join(' / ') + '.');
              } else if (doelIds.indexOf(ref) < 0) {
                status = 'fout';
                tekst.push('Verwijzing "' + norm(d.verwijstNaar) + '" komt niet overeen met ' + req.verwijstNaar + ' ' + doelIds.join(' / ') + '.');
              } else {
                tekst.push('Verwijst correct naar ' + req.verwijstNaar + ' ' + ref + '.');
              }
            });
          }
        }
      }

      resultaten.push({
        type: req.type,
        gebruiktType: gebruiktType,
        niveau: req.niveau,
        alternatieven: req.alternatieven,
        verwijstNaar: req.verwijstNaar,
        status: status,
        tekst: tekst,
        opmerkingen: req.opmerkingen,
        regelIds: req.regelIds,
        documenten: aanwezig
      });
    });

    if (reqs.regels.length === 0) {
      meldingen.push({ niveau: 'info', tekst: 'Geen regels gevonden voor deze combinatie. Voeg zo nodig een regel toe in het tabblad "Regels".' });
    }

    return {
      goed: goed,
      regels: reqs.regels,
      vereisten: resultaten,
      meldingen: meldingen,
      status: worst(resultaten.map(function (r) { return r.status; }).concat(meldingen.map(function (m) { return m.niveau === 'aandacht' ? 'aandacht' : 'ok'; })))
    };
  }

  var RANG = { ok: 0, info: 0, aandacht: 1, ontbreekt: 2, fout: 3 };
  function worst(statussen) {
    var w = 'ok';
    statussen.forEach(function (s) { if ((RANG[s] || 0) > (RANG[w] || 0)) w = s; });
    return w;
  }

  /** Controleert een volledige declaratie (alle goederenitems). */
  function checkDeclaration(decl, rules) {
    var items = (decl.goederen || []).map(function (g) { return checkItem(decl, g, rules); });
    var meldingen = [];

    if (!norm(decl.landOorsprong)) {
      meldingen.push({ niveau: 'ontbreekt', tekst: 'Land van oorsprong ontbreekt.' });
    }
    if (norm(decl.landOorsprong) && norm(decl.landLading) && normCode(decl.landOorsprong) !== normCode(decl.landLading)) {
      meldingen.push({ niveau: 'info', tekst: 'Land van oorsprong (' + normCode(decl.landOorsprong) + ') wijkt af van land van lading (' + normCode(decl.landLading) + ').' });
    }
    if (!decl.goederen || decl.goederen.length === 0) {
      meldingen.push({ niveau: 'aandacht', tekst: 'Geen goederenitems ingevoerd.' });
    }

    // Documenten die aanwezig zijn maar door geen enkele regel worden gevraagd.
    var gevraagd = {};
    items.forEach(function (it) {
      it.vereisten.forEach(function (v) {
        gevraagd[v.type] = true;
        v.alternatieven.forEach(function (a) { gevraagd[a] = true; });
      });
    });
    (decl.documenten || []).forEach(function (d) {
      var t = normCode(d.type);
      if (t && !gevraagd[t]) {
        meldingen.push({ niveau: 'info', tekst: 'Document ' + t + ' (' + norm(d.identificatie) + ') wordt door geen regel gevraagd.' });
      }
    });

    return {
      declaratie: decl,
      items: items,
      meldingen: meldingen,
      status: worst(items.map(function (i) { return i.status; }).concat(meldingen.map(function (m) { return m.niveau; })))
    };
  }

  function validateRules(rules) {
    var errors = [];
    if (!Array.isArray(rules)) return ['Regels moeten een lijst (array) zijn.'];
    var ids = {};
    rules.forEach(function (r, i) {
      var p = 'Regel ' + (i + 1) + (r && r.id ? ' (' + r.id + ')' : '') + ': ';
      if (!r || typeof r !== 'object') { errors.push(p + 'geen object.'); return; }
      if (!r.id) errors.push(p + 'id ontbreekt.');
      else if (ids[r.id]) errors.push(p + 'id komt dubbel voor.');
      ids[r.id] = true;
      if (!Array.isArray(r.documenten) || r.documenten.length === 0) errors.push(p + 'documenten ontbreken.');
      else r.documenten.forEach(function (d, j) {
        if (!d.type) errors.push(p + 'document ' + (j + 1) + ' heeft geen type.');
        if (d.niveau && ['verplicht', 'aandacht'].indexOf(d.niveau) < 0) errors.push(p + 'document ' + (j + 1) + ' heeft ongeldig niveau "' + d.niveau + '".');
      });
      ['gn', 'animo', 'landen'].forEach(function (k) {
        if (r[k] !== undefined && r[k] !== '*' && !Array.isArray(r[k])) errors.push(p + k + ' moet "*" of een lijst zijn.');
      });
    });
    return errors;
  }

  var exported = {
    matchRule: matchRule,
    requirementsFor: requirementsFor,
    checkItem: checkItem,
    checkDeclaration: checkDeclaration,
    validateRules: validateRules,
    parseDate: parseDate,
    worst: worst,
    normGn: normGn
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else {
    root.GGB_ENGINE = exported;
  }
})(typeof window !== 'undefined' ? window : this);
