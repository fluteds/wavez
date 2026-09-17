// ==UserScript==
// @name         Wavez New Users
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      2.0
// @updateURL    https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-new-users.user.js
// @downloadURL  https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-new-users.user.js
// @description  Pills accounts younger than NEW_DAYS in chat and the user list, using each account's real join date from the public profile API.
// @match        https://wavez.fm/*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

// CONFIG Days after the real join date that an account stays flagged.
var NEW_DAYS = 2;

// Pill text next to a new name. Empty = no pill.
var BADGE = "NEW";

// Recolour the name itself.
var COLOR_NAME = false;

// Pill and name colour.
var COLOR = "#00E5A0";

// --------------------------------------------------------------------------
(function () {
  "use strict";

  var TAG = ["%c[wz-new]", "color:#00E5A0;font-weight:bold"];
  var KEY = "wavez-user-joined-v2";
  var API = "https://api.wavez.fm/users/by-username/";
  // Chat author, user list row, hover preview card.
  var NAME_SELECTOR = '[data-wavezfm-chat-name="true"], [data-wavezfm-people-name="true"], [data-wavezfm-user-preview-name="true"]';

  // { usernameLower: join ms }. 0 = looked up, no usable date, so we stop asking.
  var joined = (function () {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  })();
  var pending = {}; // fetches in flight, so a full user list doesn't duplicate

  function save() { localStorage.setItem(KEY, JSON.stringify(joined)); }

  function isNew(name, now) { return joined[name] > 0 && now - joined[name] < NEW_DAYS * 86400000; }

  var css = document.createElement("style");
  css.textContent = (COLOR_NAME ? ".wz-new-user { color: " + COLOR + " !important; }" : "") + (BADGE ? ".wz-new-user::after { content: '" + BADGE + "'; margin-left: 4px; padding: 0 4px; border-radius: 4px; font-size: 9px; font-weight: 700; letter-spacing: .04em; vertical-align: middle; background: " + COLOR + "; color: #000; }" : "");
  (document.head || document.documentElement).appendChild(css);

  // One request per unknown name, no concurrency cap. Add a queue if a big list rate-limits.
  function lookup(name) {
    if (name in joined || pending[name]) return;
    pending[name] = true;
    fetch(API + encodeURIComponent(name), { credentials: "include" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) {
        var at = u && u.createdAt ? Date.parse(u.createdAt) : 0;
        joined[name] = at > 0 ? at : 0; // cache misses too, createdAt never changes
        save();
        if (isNew(name, Date.now())) console.log.apply(console, TAG.concat([name + " joined " + new Date(at).toISOString().slice(0, 10)]));
        remark(name);
      })
      .catch(function () {}) // leave unknown so the next sighting retries
      .then(function () { delete pending[name]; });
  }

  function apply(el, name) { el.classList.toggle("wz-new-user", isNew(name, Date.now())); }

  function mark(el) {
    var name = (el.textContent || "").trim().toLowerCase();
    if (!name || el.dataset.wzName === name) return; // React reuses nodes, key on the name
    el.dataset.wzName = name;
    if (name in joined) apply(el, name);
    else lookup(name);
  }

  // A resolved date lands on every node showing that name.
  function remark(name) {
    var nodes = document.querySelectorAll(NAME_SELECTOR);
    for (var i = 0; i < nodes.length; i++) if (nodes[i].dataset.wzName === name) apply(nodes[i], name);
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    if (root.matches && root.matches(NAME_SELECTOR)) mark(root);
    var nodes = root.querySelectorAll(NAME_SELECTOR);
    for (var i = 0; i < nodes.length; i++) mark(nodes[i]);
  }

  scan(document.body);

  new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) scan(added[j]);
    }
  }).observe(document.body, { childList: true, subtree: true });

  var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  pageWindow.WZNew = {
    list: function () { var now = Date.now(); return Object.keys(joined).filter(function (n) { return isNew(n, now); }); },
    joined: function () { return joined; },
    forget: function (name) { delete joined[String(name).toLowerCase()]; save(); },
    reset: function () { localStorage.removeItem(KEY); joined = {}; },
  };

  console.log.apply(console, TAG.concat(["watching for accounts under " + NEW_DAYS + " days old. WZNew.list() / WZNew.forget(name) / WZNew.reset()"]));

  // Newness window check: load with #wz-new-test.
  if (location.hash === "#wz-new-test") {
    var real = joined;
    var now = Date.now();
    joined = { fresh: now - 1000, stale: now - (NEW_DAYS + 1) * 86400000, missing: 0 };
    console.assert(isNew("fresh", now) === true, "joined a second ago is new");
    console.assert(isNew("stale", now) === false, "joined before the window is not new");
    console.assert(isNew("missing", now) === false, "no known date is never new");
    console.assert(isNew("nobody", now) === false, "unlooked-up name is not new");
    joined = real;
    console.log.apply(console, TAG.concat(["tests passed"]));
  }
})();
