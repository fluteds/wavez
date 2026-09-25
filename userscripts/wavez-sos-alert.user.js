// ==UserScript==
// @name         Wavez SOS Alert
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      3.0
// @updateURL    https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-sos-alert.user.js
// @downloadURL  https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-sos-alert.user.js
// @description  Plays an audible alert when the room footer's reports/SOS button lights up its bright badge, so a call isn't missed while you're tabbed away.
// @match        https://wavez.fm/*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==

var SOS_ACTION = "reports";

var BADGE_SELECTOR = '[class*="bg-rose"], [class*="bg-red"], [class*="-top-1"]';

var COOLDOWN_SECONDS = 15;

var VOLUME = 0.35;

var SOUND_URL = "";

(function () {
  "use strict";

  var TAG = ["%c[wz-sos]", "color:#FF1744;font-weight:bold"];
  var HOST_SELECTORS = ['[data-wavezfm-room-footer-action="' + SOS_ACTION + '"]', ".tabler-icon-shield-exclamation", '[aria-label*="' + SOS_ACTION + '" i]', '[aria-label*="sos" i]'];

  var config = { enabled: true };
  var host = null;
  var count = 0;
  var lastFire = 0;
  var ctx = null;

  function audio() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  document.addEventListener("pointerdown", audio, { once: true });

  function tone(ac, at, len) {
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(VOLUME, at + 0.01);
    gain.gain.setValueAtTime(VOLUME, at + len - 0.01);
    gain.gain.linearRampToValueAtTime(0, at + len);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + len + 0.02);
  }

  function alarm() {
    if (SOUND_URL) {
      var el = new Audio(SOUND_URL);
      el.volume = VOLUME;
      el.play().catch(function (err) { console.warn.apply(console, TAG.concat(["sound file blocked or missing:", err])); });
      return;
    }
    var ac = audio();
    var unit = 0.09;
    var at = ac.currentTime + 0.05;
    "...---...".split("").forEach(function (c, i) {
      var len = (c === "-" ? 3 : 1) * unit;
      tone(ac, at, len);
      at += len + unit + (i === 2 || i === 5 ? unit * 2 : 0);
    });
  }

  function findHost() {
    for (var i = 0; i < HOST_SELECTORS.length; i++) {
      var el = document.querySelector(HOST_SELECTORS[i]);
      if (el) return el;
    }
    return null;
  }

  function scope(el) {
    return (el.closest && el.closest('button, a, li, [role="button"], [role="tab"]')) || el.parentElement || el;
  }

  function visible(el) {
    var s = el.ownerDocument.defaultView.getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
  }

  function badgeCount() {
    if (!host) return 0;
    var nodes = scope(host).querySelectorAll(BADGE_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      if (!visible(nodes[i])) continue;
      var n = parseInt((nodes[i].textContent || "").trim(), 10);
      return n > 0 ? n : 1;
    }
    return 0;
  }

  function check() {
    if (host && !document.contains(host)) host = null;
    if (!host) {
      host = findHost();
      if (!host) return;
      count = badgeCount();
      return;
    }
    var now = badgeCount();
    if (now > count && config.enabled && Date.now() - lastFire >= COOLDOWN_SECONDS * 1000) {
      lastFire = Date.now();
      console.log.apply(console, TAG.concat(["SOS badge -> " + now]));
      alarm();
    }
    count = now;
  }

  host = findHost();
  count = badgeCount();
  setInterval(check, 1000);

  var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  pageWindow.WZSos = {
    config: config,
    test: alarm,
    on: function () { config.enabled = true; },
    off: function () { config.enabled = false; },
    debug: function () {
      var h = host || findHost();
      console.log.apply(console, TAG.concat(["control:", h, "\nwrapper:", h ? scope(h).outerHTML : "(not found)", "\ncount now:", badgeCount()]));
      return h;
    },
  };

  console.log.apply(console, TAG.concat([host ? "active - watching the SOS badge (currently " + count + "). WZSos.test() / WZSos.debug() / WZSos.off()" : "no footer button matching '" + SOS_ACTION + "' on screen yet - will keep looking. WZSos.debug() once one appears."]));
})();
