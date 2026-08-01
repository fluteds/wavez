// ==UserScript==
// @name         Wavez Translate
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.5
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-translate.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-translate.user.js
// @description  Translate wavez.fm chat and system messages into English (or any language) inline.
// @match        https://wavez.fm/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      translate.googleapis.com
// ==/UserScript==

// CONFIG Language to translate INTO (ISO code: "en", "es", "pt", "ja", ...).
var TARGET_LANG = "en";

// How translated text is shown. Change live from the console with WZTranslate.setMode(...). "append" = keep the original and add a dimmed translated line beneath it; "replace" = swap the message text for the translation (original kept on hover); "hover" = chat stays original and crossfades to the translation on hover (back on leave).
var DISPLAY_MODE = "append";

// Only translate messages NOT already in TARGET_LANG (uses Google's detected source language). Set false to translate everything.
var ONLY_NON_TARGET = true;

// Max simultaneous translation requests (keeps the free endpoint from rate-limiting).
var MAX_INFLIGHT = 4;

// --------------------------------------------------------------------------
(function () {
  "use strict";

  // Chat message bodies carry a wavez-specific token, a stable hook across theme changes. System callouts (e.g. "Agente X moveu...") have no such token on text itself, so we anchor off the only wavez class in the callout the icon, and grab the paragraph beside it.
  var MSG_SELECTOR =
    '[class*="wavezfm-chat-text-size"], .wavezfm-centered-icon + div > p';

  var config = {
    target: TARGET_LANG,
    mode: DISPLAY_MODE,
    onlyNonTarget: ONLY_NON_TARGET,
    enabled: true,
  };

  // --- styling -------------------------------------------------------------
  var style = document.createElement("style");
  style.textContent =
    ".wz-translation{display:block;margin-top:2px;opacity:.6;font-style:italic;" +
    "font-size:var(--wavezfm-chat-text-size,13px);line-height:var(--wavezfm-chat-line-height,1.25rem)}" +
    ".wz-translation::before{content:'\\1F310\\00A0';opacity:.7}" +
    ".wz-replaced::before{content:'\\1F310\\00A0';opacity:.5;font-size:.85em}" +
    ".wz-hover{cursor:pointer;transition:opacity .15s ease,transform .15s ease}" +
    ".wz-hover.wz-swap{opacity:0;transform:translateY(3px)}";
  (document.head || document.documentElement).appendChild(style);

  // --- cross-origin GET (GM first, fetch fallback) -------------------------
  function httpGet(url) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest === "function") {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          onload: function (r) {
            resolve(r.responseText);
          },
          onerror: reject,
          ontimeout: reject,
        });
        return;
      }
      if (typeof GM !== "undefined" && GM.xmlHttpRequest) {
        GM.xmlHttpRequest({
          method: "GET",
          url: url,
          onload: function (r) {
            resolve(r.responseText);
          },
          onerror: reject,
          ontimeout: reject,
        });
        return;
      }
      // No GM API (e.g. raw injection): the endpoint sends CORS *, so plain fetch works in most setups.
      fetch(url)
        .then(function (r) {
          return r.text();
        })
        .then(resolve, reject);
    });
  }

  // --- concurrency-limited queue -------------------------------------------
  var inflight = 0;
  var queue = [];
  function pump() {
    while (inflight < MAX_INFLIGHT && queue.length) {
      var job = queue.shift();
      inflight++;
      job().then(release, release);
    }
  }
  function release() {
    inflight--;
    pump();
  }
  function enqueue(fn) {
    return new Promise(function (resolve, reject) {
      queue.push(function () {
        return fn().then(resolve, reject);
      });
      pump();
    });
  }

  // translation cache: original text -> { text, src }
  var cache = Object.create(null);

  function translate(text) {
    if (cache[text]) return Promise.resolve(cache[text]);
    return enqueue(function () {
      var url =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" +
        encodeURIComponent(config.target) +
        "&dt=t&q=" +
        encodeURIComponent(text);
      return httpGet(url).then(function (raw) {
        var data = JSON.parse(raw);
        var out = (data[0] || [])
          .map(function (seg) {
            return seg && seg[0] ? seg[0] : "";
          })
          .join("");
        var result = { text: out, src: data[2] || "" };
        cache[text] = result;
        return result;
      });
    });
  }

  // --- rendering -----------------------------------------------------------
  function clearTranslation(el) {
    if (el._wzNode && el._wzNode.parentNode) {
      el._wzNode.parentNode.removeChild(el._wzNode);
    }
    el._wzNode = null;
    if (el._wzOriginal != null) {
      el.textContent = el._wzOriginal;
      el._wzOriginal = null;
    }
    if (el._wzHover) {
      // Restore the original markup if we're mid-swap, then drop hover state.
      if (el._wzHover.shown) el.innerHTML = el._wzHover.html;
      el._wzHover = null;
    }
    el.classList.remove("wz-hover", "wz-swap", "wz-replaced");
    el.removeAttribute("title");
  }

  // Crossfade between the original markup and the translation on hover. We keep a busy flag so the MutationObserver ignores our own text swaps.
  function swapHover(el, toTranslated) {
    var h = el._wzHover;
    if (!h || h.shown === toTranslated) return;
    h.shown = toTranslated;
    el._wzBusy = true;
    el.classList.add("wz-swap"); // fade + nudge out
    window.setTimeout(function () {
      if (!el._wzHover) {
        el.classList.remove("wz-swap");
        el._wzBusy = false;
        return;
      }
      if (toTranslated) el.textContent = h.translated;
      else el.innerHTML = h.html;
      el.classList.remove("wz-swap"); // fade back in
      // Clear busy after the mutation records have been delivered.
      window.setTimeout(function () {
        el._wzBusy = false;
      }, 0);
    }, 150);
  }

  function setupHover(el, translated) {
    el._wzHover = { html: el.innerHTML, translated: translated, shown: false };
    el.classList.add("wz-hover");
    if (!el._wzHoverBound) {
      el._wzHoverBound = true;
      el.addEventListener("mouseenter", function () {
        swapHover(el, true);
      });
      el.addEventListener("mouseleave", function () {
        swapHover(el, false);
      });
    }
  }

  function render(el, original, translated) {
    clearTranslation(el);
    if (config.mode === "replace") {
      el._wzOriginal = original;
      el.textContent = translated; // drops inline emoji <img>; use hover mode to keep them
      el.classList.add("wz-replaced"); // leading 🌐 marks the swap
      el.title = original;
      return;
    }
    if (config.mode === "hover") {
      setupHover(el, translated);
      return;
    }
    // append (default)
    var node = document.createElement("span");
    node.className = "wz-translation";
    node.textContent = translated;
    el._wzNode = node;
    el.parentNode.insertBefore(node, el.nextSibling);
  }

  // At least two letters worth translating (skip pure emoji/numbers/links).
  var LETTERS = /\p{L}{2,}/u;

  function process(el) {
    if (!config.enabled || el._wzBusy) return;
    var original = (el.textContent || "").trim();
    if (!original || !LETTERS.test(original)) return;
    // Skip if this is text we've already handled - either the source we translated, or the translation itself currently swapped in on hover.
    if (original === el._wzSrc || original === el._wzTranslated) return;
    el._wzSrc = original;

    translate(original)
      .then(function (res) {
        // Element text changed while we were translating, bail, the observer will re-fire for the new content.
        if ((el.textContent || "").trim() !== original) return;
        el._wzTranslated = res.text.trim();
        var sameLang =
          res.src &&
          res.src.toLowerCase().split("-")[0] === config.target.toLowerCase();
        var unchanged =
          res.text.trim().toLowerCase() === original.toLowerCase();
        if (config.onlyNonTarget && (sameLang || unchanged)) {
          clearTranslation(el);
          return;
        }
        if (unchanged) {
          clearTranslation(el);
          return;
        }
        render(el, original, res.text);
      })
      .catch(function () {
        // Network/parse error: allow a retry next time the node is seen.
        if (el._wzSrc === original) el._wzSrc = null;
      });
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(MSG_SELECTOR)) process(root);
    var nodes = root.querySelectorAll
      ? root.querySelectorAll(MSG_SELECTOR)
      : [];
    for (var i = 0; i < nodes.length; i++) process(nodes[i]);
  }

  // --- observe chat --------------------------------------------------------
  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
      // Text swapped in place (React re-render): re-check the target element.
      if (m.type === "characterData" && m.target.parentNode) {
        var p = m.target.parentNode;
        if (p.matches && p.matches(MSG_SELECTOR)) process(p);
      }
    }
  });
  // Wait for <body>: at document-start (the all-in-one bundle) it isn't parsed yet.
  function observeChat() {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scan(document.body); // catch messages already on screen
  }
  if (document.body) observeChat();
  else document.addEventListener("DOMContentLoaded", observeChat, { once: true });

  // --- live controls -------------------------------------------------------
  function retranslateAll() {
    var nodes = document.querySelectorAll(MSG_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i]._wzSrc = null;
      process(nodes[i]);
    }
  }

  // Expose controls on the page window (unsafeWindow) so they're reachable from the DevTools console; under a sandboxed @grant the script's own `window` isn't the page's.
  var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  pageWindow.WZTranslate = {
    config: config,
    setMode: function (mode) {
      config.mode = mode;
      // Re-render every message in the new layout.
      var nodes = document.querySelectorAll(MSG_SELECTOR);
      for (var i = 0; i < nodes.length; i++) {
        nodes[i]._wzSrc = null;
        clearTranslation(nodes[i]);
        process(nodes[i]);
      }
    },
    setTarget: function (lang) {
      config.target = lang;
      cache = Object.create(null);
      retranslateAll();
    },
    enable: function () {
      config.enabled = true;
      retranslateAll();
    },
    disable: function () {
      config.enabled = false;
      var nodes = document.querySelectorAll(MSG_SELECTOR);
      for (var i = 0; i < nodes.length; i++) clearTranslation(nodes[i]);
    },
    retranslateAll: retranslateAll,
  };

  console.log(
    "%c[wz-translate] active → " +
      config.target +
      " (mode: " +
      config.mode +
      "). Controls: WZTranslate.setMode('append'|'replace'|'hover')",
    "color:#30C7FB;font-weight:bold",
  );
})();
