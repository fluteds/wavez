// ==UserScript==
// @name         Wavez Auto Idle
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.1
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-auto-idle.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-auto-idle.user.js
// @description  Sets your presence to "away" after you've been off the tab for X minutes; restores it when you return. Leaves "dnd" alone.
// @match        https://wavez.fm/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var log = function () { console.log.apply(console, ["%c[wz-idle]", "color:#90A4AE;font-weight:bold"].concat([].slice.call(arguments))); };

  // Minutes off the tab before you're marked away.
  var IDLE_MINUTES = 5;

  // Presence values wavez accepts. If "online" is wrong, re-run wavez-status-discover to capture the right value.
  var AWAY = "away";
  var ACTIVE = "online";
  var DND = "dnd";

  var API = "https://api.wavez.fm/settings";
  var timer = null;
  var current = ACTIVE;

  // Snoop the app's own Authorization header off its requests and reuse it for our PATCH, since we can't guess it.
  var authHeader = null;
  (function captureAuth() {
    var of = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf("api.wavez.fm") !== -1) {
          var h = new Headers((init && init.headers) || (typeof input === "object" && input.headers) || {});
          var a = h.get("authorization");
          if (a) authHeader = a;
        }
      } catch (e) {}
      return of.apply(this, arguments);
    };
  })();

  // Ask the server rather than trust `current`: you can set dnd from the app while we're idling.
  function remotePresence() {
    var headers = {};
    if (authHeader) headers["Authorization"] = authHeader;
    return fetch(API, { credentials: "include", headers: headers }).then(function (res) { return res.json(); }).then(function (j) { return j && j.presenceStatus; }).catch(function () { return null; });
  }

  function setPresence(status) {
    if (status === current) return Promise.resolve();
    return remotePresence().then(function (remote) {
      if (remote === DND) { current = DND; return; }
      current = status;
      var headers = { "Content-Type": "application/json" };
      if (authHeader) headers["Authorization"] = authHeader;
      return fetch(API, {
        method: "PATCH",
        credentials: "include",
        headers: headers,
        body: JSON.stringify({ presenceStatus: status }),
      }).then(function (res) {
        if (!res.ok) current = status === AWAY ? ACTIVE : AWAY;
      }).catch(function () {
        current = status === AWAY ? ACTIVE : AWAY;
      });
    });
  }

  function onHidden() {
    clearTimeout(timer);
    timer = setTimeout(function () { setPresence(AWAY); }, IDLE_MINUTES * 60 * 1000);
  }

  function onVisible() {
    clearTimeout(timer);
    setPresence(ACTIVE);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) onHidden(); else onVisible();
  });

  if (location.hash === "#wz-idle-test") {
    var calls = [];
    var realFetch = window.fetch;
    var remote = ACTIVE;
    window.fetch = function (u, o) {
      if (!o || o.method !== "PATCH") return Promise.resolve({ json: function () { return Promise.resolve({ presenceStatus: remote }); } });
      calls.push(JSON.parse(o.body).presenceStatus);
      return Promise.resolve({ ok: true });
    };
    current = ACTIVE;
    Promise.resolve()
      .then(function () { return setPresence(ACTIVE); })                      // no-op (already active)
      .then(function () { return setPresence(AWAY); })                        // -> away
      .then(function () { return setPresence(AWAY); })                        // dedup, no-op
      .then(function () { return setPresence(ACTIVE); })                      // -> online
      .then(function () { remote = DND; return setPresence(AWAY); })          // dnd set in app, leave it
      .then(function () { return setPresence(ACTIVE); })                      // still dnd, leave it
      .then(function () {
        window.fetch = realFetch;
        console.assert(calls.join(",") === "away,online", "idle dnd/dedupe broken:", calls);
        log("self-check passed");
      });
  }
})();
