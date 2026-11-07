/*
 * ABC Planning — datalaag
 * Praat rechtstreeks met de Google Sheets API (geen Apps Script meer nodig).
 * Inloggen gaat via Google; alleen accounts met toegang tot de sheet kunnen lezen/schrijven.
 */
(function () {
  'use strict';

  var CFG = {
    clientId: '1091272801207-bfdmd6hmlda5h8pd14tuak4fdrpvt38j.apps.googleusercontent.com',
    sheetId: '128IXoJWYMU9t1-a-HlqSGfwBe0ZmuKKtkOG6fNfrzUk',
    scope: 'https://www.googleapis.com/auth/spreadsheets'
  };
  var API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/' + CFG.sheetId;
  var ALF_TAB = 'ALF 2027';
  var MAANDEN = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];
  var DAGEN = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
  var COL = { DAG: 1, DATUM: 2, TIJD: 3, KLANT: 4, APP_KLANT: 5, PAX: 6, DRANK: 7, HAPJES: 8, OPSTAP: 9, AFSTAP: 10, SCHIPPER: 11, LINK_SCHIPPER: 12, BOOT: 13, NOTES: 14 };
  var PHONE_RE = /\+?[0-9][0-9 \-]{7,}[0-9]/;
  var PHONE_RE_G = /\+?[0-9][0-9 \-]{7,}[0-9]/g;

  /* ---------------- inloggen ---------------- */
  var Auth = { token: null, exp: 0, client: null, waiters: [] };
  try {
    var saved = JSON.parse(localStorage.getItem('abc_tok') || 'null');
    if (saved && saved.exp > Date.now() + 60000) { Auth.token = saved.token; Auth.exp = saved.exp; }
  } catch (e) { /* geen opslag */ }

  function authValid() { return !!Auth.token && Auth.exp > Date.now() + 60000; }
  function authErr() { var e = new Error('AUTH'); e.auth = true; return e; }
  function settle(ok, val) {
    Auth.waiters.splice(0).forEach(function (w) { ok ? w.resolve(val) : w.reject(val); });
  }
  function initAuth() {
    if (Auth.client) return true;
    if (!(window.google && google.accounts && google.accounts.oauth2)) return false;
    Auth.client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: CFG.scope,
      callback: function (r) {
        if (!r || r.error) { settle(false, new Error('Inloggen is niet gelukt. Probeer het opnieuw.')); return; }
        Auth.token = r.access_token;
        Auth.exp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
        try {
          localStorage.setItem('abc_tok', JSON.stringify({ token: Auth.token, exp: Auth.exp }));
          localStorage.setItem('abc_consent', '1');
        } catch (e) { /* geen opslag */ }
        settle(true);
      },
      error_callback: function () { settle(false, new Error('Inloggen afgebroken.')); }
    });
    return true;
  }
  /** Moet vanuit een klik/tik worden aangeroepen (popup). */
  function signIn() {
    return new Promise(function (resolve, reject) {
      if (!initAuth()) { reject(new Error('Google-login is nog aan het laden. Probeer het over een paar seconden opnieuw.')); return; }
      Auth.waiters.push({ resolve: resolve, reject: reject });
      var consented = false;
      try { consented = !!localStorage.getItem('abc_consent'); } catch (e) { /* */ }
      Auth.client.requestAccessToken({ prompt: consented ? '' : 'consent' });
    });
  }
  function signOut() {
    try {
      if (Auth.token && window.google && google.accounts && google.accounts.oauth2) google.accounts.oauth2.revoke(Auth.token, function () {});
      localStorage.removeItem('abc_tok'); localStorage.removeItem('abc_consent');
      Object.keys(localStorage).filter(function (k) { return k.indexOf('abc_') === 0; }).forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* */ }
    Auth.token = null; Auth.exp = 0;
  }

  /* ---------------- Sheets API ---------------- */
  function api(path, opts) {
    if (!authValid()) return Promise.reject(authErr());
    opts = opts || {};
    var headers = { Authorization: 'Bearer ' + Auth.token };
    if (opts.body) headers['Content-Type'] = 'application/json';
    return fetch(API_BASE + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        if (r.status === 401) {
          Auth.token = null;
          try { localStorage.removeItem('abc_tok'); } catch (e) { /* */ }
          throw authErr();
        }
        if (r.status === 403) throw new Error('Dit Google-account heeft geen toegang tot de planning. Log in met een account dat "ABC planning 26" kan bewerken.');
        if (!r.ok) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            throw new Error((j.error && j.error.message) || ('Google gaf foutcode ' + r.status));
          });
        }
        return r.json();
      }, function () { throw new Error('Geen verbinding met Google. Controleer je internet.'); });
  }
  function q(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  function rng(name, a1) { return q(name) + '!' + a1; }
  function getRange(range, render) {
    return api('/values/' + encodeURIComponent(range) + '?valueRenderOption=' + (render || 'FORMATTED_VALUE'))
      .then(function (r) { return r.values || []; });
  }
  function batchGet(ranges, render) {
    if (!ranges.length) return Promise.resolve([]);
    var qs = ranges.map(function (r) { return 'ranges=' + encodeURIComponent(r); }).join('&');
    return api('/values:batchGet?' + qs + '&valueRenderOption=' + (render || 'FORMATTED_VALUE'))
      .then(function (r) { return (r.valueRanges || []).map(function (v) { return v.values || []; }); });
  }
  function batchUpdate(requests) {
    if (!requests.length) return Promise.resolve();
    return api(':batchUpdate', { method: 'POST', body: { requests: requests } });
  }
  function writeValues(data) {
    return api('/values:batchUpdate', { method: 'POST', body: { valueInputOption: 'RAW', data: data } });
  }
  function clearRanges(ranges) {
    return api('/values:batchClear', { method: 'POST', body: { ranges: ranges } });
  }

  var META = null, META_AT = 0;
  function meta(force) {
    if (META && !force && Date.now() - META_AT < 10 * 60 * 1000) return Promise.resolve(META);
    return api('?fields=sheets.properties(sheetId,title)').then(function (r) {
      var m = {};
      (r.sheets || []).forEach(function (s) { m[s.properties.title] = s.properties.sheetId; });
      META = m; META_AT = Date.now();
      return m;
    });
  }

  /* ---------------- hulpfuncties ---------------- */
  function p2(n) { n = String(+n); return n.length < 2 ? '0' + n : n; }
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; }
  function dispToIso(s) {
    var m = String(s || '').trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    return m ? m[3] + '-' + p2(m[2]) + '-' + p2(m[1]) : null;
  }
  function serial(iso) { var a = iso.split('-'); return Date.UTC(+a[0], +a[1] - 1, +a[2]) / 86400000 + 25569; }
  function dagVan(iso) { var a = iso.split('-'); return DAGEN[new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay()]; }
  function pad(row, n) { var r = (row || []).slice(); while (r.length < n) r.push(''); return r.map(function (x) { return x == null ? '' : String(x); }); }
  function parseId(id) { var i = String(id).lastIndexOf('!'); return { sheet: id.slice(0, i), row: parseInt(id.slice(i + 1), 10) }; }
  function properIfLower(s) {
    return String(s).split(' ').map(function (w) { return w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w; }).join(' ');
  }
  function parseTime(s) {
    s = String(s || '');
    var m = s.match(/(\d{1,2})[.:](\d{2})\s*(?:[-–—]|tot)\s*(\d{1,2})[.:](\d{2})/);
    if (m) {
      var a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
      if (b < a) b += 1440;
      return { start: p2(m[1]) + ':' + m[2], end: p2(m[3]) + ':' + m[4], startMin: a, endMin: b };
    }
    var s1 = s.match(/(\d{1,2})[.:](\d{2})/);
    if (s1) return { start: p2(s1[1]) + ':' + s1[2], end: '', startMin: +s1[1] * 60 + +s1[2], endMin: null };
    return { start: '', end: '', startMin: null, endMin: null };
  }
  function monthSheet(M, year, m0) {
    var names = [MAANDEN[m0] + ' ' + year];
    if (year === 2026) names.push(MAANDEN[m0]); // 2026-tabbladen heten nog zonder jaartal
    for (var i = 0; i < names.length; i++) if (M[names[i]] != null) return names[i];
    return null;
  }

  /* ---------------- lezen ---------------- */
  function buildTrip(sheet, gid, row, d, dateIso) {
    var klant = d[COL.KLANT - 1].trim();
    var tijd = d[COL.TIJD - 1].trim();
    var tm = parseTime(tijd);
    var m = klant.match(PHONE_RE);
    var nr = m ? m[0].replace(/[^0-9]/g, '').replace(/^00/, '').replace(/^0/, '31') : '';
    var naamRaw = klant.replace(PHONE_RE_G, ' ').replace(/\bEN\b/g, ' ').replace(/\s+/g, ' ').trim();
    var src = /\bgyg\b|getyourguide/i.test(klant) ? 'GetYourGuide' : (/trytn/i.test(klant) ? 'Trytn' : (/\bprio\b/i.test(klant) ? 'Prio' : ''));
    var name = naamRaw.replace(/\bgyg\b/ig, ' ').replace(/\btrytn\b/ig, ' ').replace(/^\s*(via|prive|privé)\s+/i, '').replace(/\s+/g, ' ').trim();
    name = properIfLower(name) || '(zonder naam)';
    var boatRaw = d[COL.BOOT - 1].trim();
    var notes = d[COL.NOTES - 1].trim();
    var hapjes = d[COL.HAPJES - 1].trim();
    if (/^[-–—]+$/.test(hapjes)) hapjes = '';
    var status = (/^\s*optie\b/i.test(notes) || /\boptie\b/i.test(klant) || /\?/.test(klant)) ? 'Optie'
      : ((/offerte/i.test(notes) && !/getekend|akkoord|betaald/i.test(notes)) ? 'Offerte open' : 'Bevestigd');
    return {
      id: sheet + '!' + row, sheet: sheet, gid: gid, row: row,
      kind: /losse tickets/i.test(klant) ? 'alfnote' : 'trip',
      date: dateIso, dag: d[COL.DAG - 1].trim(), tijd: tijd,
      start: tm.start, end: tm.end, startMin: tm.startMin, endMin: tm.endMin,
      timeLabel: tm.start ? tm.start + (tm.end ? ' – ' + tm.end : '') : (tijd || '—'),
      klantRaw: klant, naamRaw: naamRaw, name: name, phone: nr,
      en: /\bEN\b/.test(klant) || (!!nr && nr.slice(0, 2) !== '31'),
      source: src, pax: num(d[COL.PAX - 1]), drankRaw: d[COL.DRANK - 1].trim(), hapjes: hapjes,
      opstap: d[COL.OPSTAP - 1].trim(), afstap: d[COL.AFSTAP - 1].trim(), schipper: d[COL.SCHIPPER - 1].trim(),
      boatRaw: boatRaw, boat: /zaza/i.test(boatRaw) ? 'zaza' : (/mosi/i.test(boatRaw) ? 'mosi' : ''),
      notes: notes, status: status
    };
  }
  function readMonth(sheet, gid, rows) {
    var out = [], cur = null;
    rows.forEach(function (raw, i) {
      var d = pad(raw, 14);
      var iso = dispToIso(d[COL.DATUM - 1]);
      if (iso) cur = iso;
      if ((!d[COL.TIJD - 1].trim() && !d[COL.KLANT - 1].trim()) || !cur) return;
      out.push(buildTrip(sheet, gid, i + 2, d, cur));
    });
    return out;
  }
  function readAlf(rows) {
    var map = {}, order = [], cur = null;
    rows.forEach(function (raw) {
      var d = pad(raw, 15);
      var iso = dispToIso(d[1]);
      if (iso) cur = iso;
      var shift = d[2].trim();
      if (!cur || !shift) return;
      var key = cur + '|' + shift, g = map[key];
      if (!g) {
        var tm = parseTime(shift);
        g = map[key] = {
          id: 'alf:' + key, date: cur, shift: shift, start: tm.start, end: tm.end, startMin: tm.startMin, endMin: tm.endMin,
          timeLabel: tm.start ? tm.start + (tm.end ? ' – ' + tm.end : '') : shift,
          cap: 0, booked: 0, status: d[4].trim(), boats: []
        };
        order.push(key);
      }
      var cap = num(d[8]), booked = num(d[9]);
      if (cap && !g.cap) g.cap = cap;
      if (booked && !g.booked) g.booked = booked;
      g.boats.push({ boat: d[3].trim(), schipper: d[5].trim(), host: d[6].trim(), pax: num(d[7]) });
    });
    return order.map(function (k) { return map[k]; });
  }

  function getData(startIso, endIso) {
    return meta().then(function (M) {
      var names = [];
      var y = +startIso.slice(0, 4), m = +startIso.slice(5, 7), ey = +endIso.slice(0, 4), em = +endIso.slice(5, 7);
      while (y < ey || (y === ey && m <= em)) {
        var n = monthSheet(M, y, m - 1);
        if (n && names.indexOf(n) < 0) names.push(n);
        m++; if (m > 12) { m = 1; y++; }
      }
      var ranges = names.map(function (n) { return rng(n, 'A2:N'); });
      var hasAlf = M[ALF_TAB] != null, hasSk = M.schippers != null, hasLoc = M.locaties != null;
      if (hasAlf) ranges.push(rng(ALF_TAB, 'A2:O'));
      if (hasSk) ranges.push(rng('schippers', 'A3:C80'));
      if (hasLoc) ranges.push(rng('locaties', 'A3:B80'));
      return batchGet(ranges).then(function (vr) {
        var trips = [], k = 0;
        names.forEach(function (n) { trips = trips.concat(readMonth(n, M[n], vr[k++])); });
        var alf = hasAlf ? readAlf(vr[k++]) : [];
        var schippers = hasSk ? vr[k++].map(function (r) { r = pad(r, 3); return { naam: r[0].trim(), tel: r[2].replace(/[^0-9]/g, '') }; }).filter(function (s) { return s.naam; }) : [];
        var locaties = hasLoc ? vr[k++].map(function (r) { r = pad(r, 2); return { naam: r[0].trim(), link: r[1].trim() }; }).filter(function (l) { return l.naam; }) : [];
        var inRange = function (x) { return x.date >= startIso && x.date <= endIso; };
        return {
          trips: trips.filter(inRange), alf: alf.filter(inRange), schippers: schippers, locaties: locaties,
          sheetUrl: 'https://docs.google.com/spreadsheets/d/' + CFG.sheetId + '/edit',
          alfGid: hasAlf ? M[ALF_TAB] : null, loadedAt: new Date().toISOString()
        };
      });
    });
  }

  /* ---------------- schrijven ---------------- */
  function inputRanges(sheet, row, alsoDate) {
    var r = [rng(sheet, 'C' + row + ':D' + row), rng(sheet, 'F' + row + ':K' + row), rng(sheet, 'M' + row + ':N' + row)];
    if (alsoDate) r.unshift(rng(sheet, 'A' + row + ':B' + row));
    return r;
  }
  function rowRange(gid, idx0) { return { sheetId: gid, startRowIndex: idx0, endRowIndex: idx0 + 1 }; }

  function findOrInsertRow(M, iso) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7);
    var sheet = monthSheet(M, y, m - 1);
    if (!sheet) return Promise.reject(new Error('Er is nog geen tabblad "' + MAANDEN[m - 1] + ' ' + y + '" in de planning.'));
    var gid = M[sheet];
    return getRange(rng(sheet, 'A2:D')).then(function (rows) {
      var cur = null, forDate = [], firstAfter = null, lastWithDate = null;
      rows.forEach(function (raw, i) {
        var d = pad(raw, 4), row = i + 2, dt = dispToIso(d[1]);
        if (dt) { cur = dt; lastWithDate = row; }
        if (!cur) return;
        var empty = !d[2].trim() && !d[3].trim();
        if (cur === iso && (dt || !empty)) forDate.push({ row: row, empty: empty, hasDate: !!dt });
        if (dt && cur > iso && firstAfter === null) firstAfter = row;
      });
      for (var j = 0; j < forDate.length; j++) if (forDate[j].empty && forDate[j].hasDate) return { sheet: sheet, row: forDate[j].row };
      var insertAt, copyFrom; // 1-based rijnummers na invoegen
      if (forDate.length) { insertAt = forDate[forDate.length - 1].row + 1; copyFrom = insertAt - 1; }
      else if (firstAfter) { insertAt = firstAfter; copyFrom = firstAfter + 1; }
      else { var base = lastWithDate || rows.length + 1; insertAt = base + 1; copyFrom = base; }
      return batchUpdate([
        { insertDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: insertAt - 1, endIndex: insertAt }, inheritFromBefore: insertAt > 2 } },
        { copyPaste: { source: rowRange(gid, copyFrom - 1), destination: rowRange(gid, insertAt - 1), pasteType: 'PASTE_NORMAL' } }
      ]).then(function () { return clearRanges(inputRanges(sheet, insertAt, true)); })
        .then(function () { return { sheet: sheet, row: insertAt }; });
    });
  }

  function buildKlant(f) {
    var naam = String(f.naam || '').replace(/\s+/g, ' ').trim();
    var tel = String(f.tel || '').trim().replace(/[^\d+]/g, '');
    var nr = tel.replace(/[^0-9]/g, '').replace(/^00/, '').replace(/^0/, '31');
    var k = naam + (tel ? ' ' + tel : '');
    var foreign = nr && nr.slice(0, 2) !== '31';
    if (f.en && !foreign) k += ' EN';
    return k;
  }

  function writeRow(sheet, row, f) {
    var start = String(f.start || '').trim(), end = String(f.end || '').trim();
    var tijd = start ? (end ? start + '-' + end : start) : '';
    var notes = String(f.notes || '').trim().replace(/^OPTIE\s*·?\s*/i, '');
    if (f.status === 'Optie') notes = 'OPTIE' + (notes ? ' · ' + notes : '');
    var boot = /zaza/i.test(f.boot || '') ? 'ZAZA' : (/mosi/i.test(f.boot || '') ? 'Mosi Jo' : '');
    var pax = parseInt(f.pax, 10);
    return writeValues([
      { range: rng(sheet, 'A' + row + ':D' + row), values: [[dagVan(f.datum), serial(f.datum), tijd, buildKlant(f)]] },
      { range: rng(sheet, 'F' + row + ':K' + row), values: [[isNaN(pax) ? '' : pax, f.drank || '', f.hapjes || '', f.opstap || '', f.afstap || '', f.schipper || '']] },
      { range: rng(sheet, 'M' + row + ':N' + row), values: [[boot, notes]] }
    ]);
  }

  /** Zorgt dat de WhatsApp-formules (kolom E en L) in de regel staan. */
  function ensureFormulas(M, sheet, row) {
    var gid = M[sheet];
    return batchGet([rng(sheet, 'E2:E'), rng(sheet, 'L2:L')], 'FORMULA').then(function (cols) {
      var reqs = [];
      [[cols[0], 4], [cols[1], 11]].forEach(function (pair) {
        var col = pair[0], ci = pair[1];
        var here = (col[row - 2] || [])[0];
        if (here && String(here).charAt(0) === '=') return;
        for (var i = 0; i < col.length; i++) {
          var v = (col[i] || [])[0];
          if (v && String(v).charAt(0) === '=') {
            reqs.push({ copyPaste: {
              source: { sheetId: gid, startRowIndex: i + 1, endRowIndex: i + 2, startColumnIndex: ci, endColumnIndex: ci + 1 },
              destination: { sheetId: gid, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: ci, endColumnIndex: ci + 1 },
              pasteType: 'PASTE_FORMULA' } });
            return;
          }
        }
      });
      return batchUpdate(reqs);
    });
  }

  function saveTrip(f) {
    if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f.datum || '')) return Promise.reject(new Error('Kies een datum.'));
    if (!String(f.naam || '').trim()) return Promise.reject(new Error('Vul de naam van de klant in.'));
    return meta().then(function (M) {
      var step = Promise.resolve(null);
      if (f.id) {
        var p = parseId(f.id);
        if (M[p.sheet] == null) return Promise.reject(new Error('Tabblad "' + p.sheet + '" niet gevonden. Ververs de app.'));
        step = getRange(rng(p.sheet, 'A' + p.row + ':D' + p.row)).then(function (rows) {
          var d = pad(rows[0], 4);
          if (d[3].trim() !== String(f.origKlant || '').trim()) throw new Error('Deze regel is intussen in de sheet aangepast. Ververs de app en probeer het opnieuw.');
          if (dispToIso(d[1]) === f.datum) return { sheet: p.sheet, row: p.row };
          return clearRanges(inputRanges(p.sheet, p.row, false)).then(function () { return null; });
        });
      }
      return step.then(function (t) { return t || findOrInsertRow(M, f.datum); }).then(function (t) {
        return writeRow(t.sheet, t.row, f)
          .then(function () { return ensureFormulas(M, t.sheet, t.row); })
          .then(function () { return { id: t.sheet + '!' + t.row, datum: f.datum }; });
      });
    });
  }

  function deleteTrip(id, origKlant) {
    return meta().then(function (M) {
      var p = parseId(id);
      if (M[p.sheet] == null) throw new Error('Tabblad "' + p.sheet + '" niet gevonden. Ververs de app.');
      var from = Math.max(2, p.row - 1);
      return getRange(rng(p.sheet, 'A' + from + ':D' + (p.row + 1))).then(function (rows) {
        var at = p.row - from;
        var d = pad(rows[at], 4);
        if (d[3].trim() !== String(origKlant || '').trim()) throw new Error('Deze regel is intussen in de sheet aangepast. Ververs de app en probeer het opnieuw.');
        var iso = dispToIso(d[1]), others = 0;
        [at - 1, at + 1].forEach(function (k) {
          if (k < 0 || k >= rows.length || (from + k) < 2 || !iso) return;
          if (dispToIso(pad(rows[k], 4)[1]) === iso) others++;
        });
        if (others) {
          return batchUpdate([{ deleteDimension: { range: { sheetId: M[p.sheet], dimension: 'ROWS', startIndex: p.row - 1, endIndex: p.row } } }]);
        }
        return clearRanges(inputRanges(p.sheet, p.row, false));
      }).then(function () { return { ok: true }; });
    });
  }

  /* ---------------- koppeling met de app ---------------- */
  window.ABC = {
    authValid: authValid,
    signIn: signIn,
    signOut: signOut,
    initAuth: initAuth,
    run: function () {
      var ok = function () {}, fail = function () {};
      var c = {
        withSuccessHandler: function (f) { ok = f; return c; },
        withFailureHandler: function (f) { fail = f; return c; },
        getData: function (a, b) { getData(a, b).then(ok, fail); },
        saveTrip: function (f) { saveTrip(f).then(ok, fail); },
        deleteTrip: function (i, k) { deleteTrip(i, k).then(ok, fail); }
      };
      return c;
    },
    _test: { readMonth: readMonth, readAlf: readAlf, buildKlant: buildKlant, dispToIso: dispToIso, serial: serial, dagVan: dagVan }
  };
})();
