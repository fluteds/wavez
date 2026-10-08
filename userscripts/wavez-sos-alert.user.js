// ==UserScript==
// @name         Wavez SOS Alert
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      3.8
// @updateURL    https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-sos-alert.user.js
// @downloadURL  https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-sos-alert.user.js
// @description  Plays an audible alert when the room footer's reports/SOS button lights up its bright badge, so a call isn't missed while you're tabbed away.
// @match        https://wavez.fm/*
// @run-at       document-idle
// @grant        unsafeWindow
// @grant        GM_notification
// ==/UserScript==

(function () {
  var KEY = 'wavez-tools:';
  var SPEC = { id: 'sos-alert', label: 'SOS Alert', cat: 'Moderation', settings: [["SOS_ACTION", "Button watched", "moderation", ""], ["COOLDOWN_SECONDS", "Quiet seconds", 15, ""], ["VOLUME", "Volume", 0.35, ""], ["NOTIFY", "Desktop alert", true, ""], ["SOUND_URL", "Sound URL", "", ""]] };
  function setting(id, name, dflt) { try { var v = localStorage.getItem(KEY + id + ":" + name); return v === null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }
  function announce() { document.dispatchEvent(new CustomEvent('wavez-tools:addon', { detail: JSON.stringify(SPEC) })); }
  document.addEventListener('wavez-tools:ping', announce);
  announce();
  if (localStorage.getItem(KEY + SPEC.id) === 'off') return;

  var SOS_ACTION = setting("sos-alert", "SOS_ACTION", "moderation");
  var BADGE_SELECTOR = '[data-room-action-menu-attention], [class*="bg-rose"], [class*="bg-red"], [class*="-top-1"]';

  var COOLDOWN_SECONDS = setting("sos-alert", "COOLDOWN_SECONDS", 15);
  var VOLUME = setting("sos-alert", "VOLUME", 0.35);
  var NOTIFY = setting("sos-alert", "NOTIFY", true);
  var SOUND_URL = setting("sos-alert", "SOUND_URL", "");
  (function () {
    "use strict";

    var TAG = ["%c[wz-sos]", "color:#FF1744;font-weight:bold"];
    var HOST_SELECTORS = ['[data-wavezfm-room-footer-action="' + SOS_ACTION + '"]', ".tabler-icon-shield-exclamation", '[data-wavezfm-room-footer-action][aria-label*="' + SOS_ACTION + '" i]'];

    var config = { enabled: true };
    var host = null;
    var count = 0;
    var lastFire = 0;
    var ctx = null;

    var FLAG = "(!) ";

    function audio() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }
    document.addEventListener("pointerdown", function () {
      audio();
      if (window.Notification && Notification.permission === "default") Notification.requestPermission();
    }, { once: true });

    function tone(ac, at, len, freq) {
      var osc = ac.createOscillator();
      var gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + len);
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
      var at = ac.currentTime + 0.05;
      tone(ac, at, 0.5, 660);
      tone(ac, at + 0.16, 0.6, 880);
    }

    function away() { return document.hidden || !document.hasFocus(); }

    function notify(body) {
      if (typeof GM_notification === "function") return GM_notification({ title: "Wavez SOS", text: body, onclick: function () { window.focus(); } });
      if (!window.Notification || Notification.permission !== "granted") return console.warn.apply(console, TAG.concat(["no desktop notification: GM_notification missing and site permission is " + (window.Notification ? Notification.permission : "unsupported")]));
      var note = new Notification("Wavez SOS", { body: body, tag: "wz-sos", renotify: true, requireInteraction: true });
      note.onclick = function () { window.focus(); note.close(); };
    }

    function alertAway(n, force) {
      if (!force && !away()) return;
      if (!force && !NOTIFY) return;
      if (document.title.indexOf(FLAG) !== 0) document.title = FLAG + document.title;
      notify(n > 1 ? n + " moderation alerts need attention" : "A moderation alert needs attention");
    }

    function unflag() { if (!away() && document.title.indexOf(FLAG) === 0) document.title = document.title.slice(FLAG.length); }
    document.addEventListener("visibilitychange", unflag);
    window.addEventListener("focus", unflag);

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
        alertAway(now);
      }
      count = now;
    }

    host = findHost();
    count = badgeCount();
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });

    var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
    pageWindow.WZSos = {
      config: config,
      test: function () { alarm(); alertAway(1, true); },
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
})();
