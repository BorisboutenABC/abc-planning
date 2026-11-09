/*
 * ABC Planning — verbinding met de planning
 * De app praat met een eigen Apps Script-achterkant (die de sheet leest en schrijft).
 * Elk apparaat logt één keer in met Google en krijgt dan een eigen apparaatsleutel:
 * daarna nooit meer inloggen, tot je zelf uitlogt.
 */
(function () {
  'use strict';

  var CFG = {
    clientId: '1091272801207-bfdmd6hmlda5h8pd14tuak4fdrpvt38j.apps.googleusercontent.com',
    api: 'https://script.google.com/macros/s/AKfycbxlBxqfbn4fI7zYQHsRnfbSRjJNktApVXN9V_GyfSu3LU9ClUC1j5_q37AoZuckbS4_/exec'
  };

  var Dev = { token: null, email: '' };
  try {
    var saved = JSON.parse(localStorage.getItem('abc_dev') || 'null');
    if (saved && saved.token) Dev = saved;
    localStorage.removeItem('abc_tok'); // oude inlogmethode opruimen
  } catch (e) { /* geen opslag */ }

  function authValid() { return !!Dev.token; }
  function clearDev() {
    Dev = { token: null, email: '' };
    try { localStorage.removeItem('abc_dev'); } catch (e) { /* */ }
  }
  function authErr(detail) { var e = new Error('AUTH'); e.auth = true; e.detail = detail || ''; return e; }

  function call(fn, args, extra) {
    var body = { fn: fn, args: args || [], token: Dev.token };
    if (extra) for (var k in extra) body[k] = extra[k];
    return fetch(CFG.api, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    }).then(function (r) {
      if (!r.ok) throw new Error('De planning-server gaf foutcode ' + r.status + '.');
      return r.json();
    }, function () {
      throw new Error('Geen verbinding. Controleer je internet.');
    }).then(function (j) {
      if (!j || !j.ok) {
        if (j && j.auth) { if (fn !== 'login') clearDev(); throw authErr(j.error); }
        throw new Error((j && j.error) || 'Onbekende fout.');
      }
      return j.data;
    });
  }

  /* ---------- eenmalig inloggen met Google ---------- */
  var client = null, waiters = [];
  function settle(ok, val) { waiters.splice(0).forEach(function (w) { ok ? w.resolve(val) : w.reject(val); }); }
  function initAuth() {
    if (client) return true;
    if (!(window.google && google.accounts && google.accounts.oauth2)) return false;
    client = google.accounts.oauth2.initTokenClient({
      client_id: CFG.clientId,
      scope: 'openid email',
      callback: function (r) {
        if (!r || r.error) { settle(false, new Error('Inloggen is niet gelukt. Probeer het opnieuw.')); return; }
        call('login', [], { accessToken: r.access_token, device: (navigator.userAgent || '').slice(0, 120) }).then(function (d) {
          Dev = { token: d.token, email: d.email };
          try {
            localStorage.setItem('abc_dev', JSON.stringify(Dev));
            localStorage.setItem('abc_hint', d.email);
          } catch (e) { /* */ }
          try { google.accounts.oauth2.revoke(r.access_token, function () {}); } catch (e) { /* */ }
          settle(true);
        }, function (e) { settle(false, new Error(e.detail || e.message)); });
      },
      error_callback: function () { settle(false, new Error('Inloggen afgebroken.')); }
    });
    return true;
  }
  function signIn() {
    return new Promise(function (resolve, reject) {
      if (!initAuth()) { reject(new Error('Google-login is nog aan het laden. Probeer het over een paar seconden opnieuw.')); return; }
      waiters.push({ resolve: resolve, reject: reject });
      var hint = '';
      try { hint = localStorage.getItem('abc_hint') || ''; } catch (e) { /* */ }
      var opts = { prompt: hint ? '' : 'select_account' };
      if (hint) opts.login_hint = hint;
      client.requestAccessToken(opts);
    });
  }
  function signOut() {
    if (Dev.token) call('logout', []).catch(function () {});
    clearDev();
    try {
      Object.keys(localStorage).filter(function (k) { return k.indexOf('abc_') === 0; }).forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { /* */ }
  }

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
        getData: function (a, b) { call('getData', [a, b]).then(ok, fail); },
        saveTrip: function (f) { call('saveTrip', [f]).then(ok, fail); },
        deleteTrip: function (i, k) { call('deleteTrip', [i, k]).then(ok, fail); }
      };
      return c;
    }
  };
})();
