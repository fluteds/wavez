// ==UserScript==
// @name         Wavez Translate
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.8
// @updateURL    https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-translate.user.js
// @downloadURL  https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-translate.user.js
// @description  Translate wavez.fm chat and system messages into English (or any language) inline.
// @match        https://wavez.fm/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      clients5.google.com
// ==/UserScript==

var TARGET_LANG = "en";

var DISPLAY_MODE = "append";

var ONLY_NON_TARGET = true;

var MAX_INFLIGHT = 4;

(function () {
  "use strict";

  var MSG_SELECTOR =
    '[class*="wavezfm-chat-text-size"], .wavezfm-centered-icon + div > p';

  var config = {
    target: TARGET_LANG,
    mode: DISPLAY_MODE,
    onlyNonTarget: ONLY_NON_TARGET,
    enabled: true,
  };

  var style = document.createElement("style");
  style.textContent =
    ".wz-translation{display:block;margin-top:2px;opacity:.6;font-style:italic;" +
    "font-size:var(--wavezfm-chat-text-size,13px);line-height:var(--wavezfm-chat-line-height,1.25rem)}" +
    ".wz-translation::before{content:'\\1F310\\00A0';opacity:.7}" +
    ".wz-replaced::before{content:'\\1F310\\00A0';opacity:.5;font-size:.85em}" +
    ".wz-hover{cursor:pointer;transition:opacity .15s ease,transform .15s ease}" +
    ".wz-hover.wz-swap{opacity:0;transform:translateY(3px)}";
  (document.head || document.documentElement).appendChild(style);

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
      fetch(url)
        .then(function (r) {
          return r.text();
        })
        .then(resolve, reject);
    });
  }

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

  var cache = Object.create(null);

  function translate(text) {
    if (cache[text]) return Promise.resolve(cache[text]);
    return enqueue(function () {
      var url =
        "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=" +
        encodeURIComponent(config.target) +
        "&q=" +
        encodeURIComponent(text);
      return httpGet(url).then(function (raw) {
        var data = JSON.parse(raw);
        var seg = data[0] || [];
        var result = { text: seg[0] || "", src: seg[1] || "" };
        cache[text] = result;
        return result;
      });
    });
  }

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
      if (el._wzHover.shown) el.innerHTML = el._wzHover.html;
      el._wzHover = null;
    }
    el.classList.remove("wz-hover", "wz-swap", "wz-replaced");
    el.removeAttribute("title");
  }

  function swapHover(el, toTranslated) {
    var h = el._wzHover;
    if (!h || h.shown === toTranslated) return;
    h.shown = toTranslated;
    el._wzBusy = true;
    el.classList.add("wz-swap");
    window.setTimeout(function () {
      if (!el._wzHover) {
        el.classList.remove("wz-swap");
        el._wzBusy = false;
        return;
      }
      if (toTranslated) el.textContent = h.translated;
      else el.innerHTML = h.html;
      el.classList.remove("wz-swap");
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
      el.textContent = translated;
      el.classList.add("wz-replaced");
      el.title = original;
      return;
    }
    if (config.mode === "hover") {
      setupHover(el, translated);
      return;
    }
    var node = document.createElement("span");
    node.className = "wz-translation";
    node.textContent = translated;
    el._wzNode = node;
    el.parentNode.insertBefore(node, el.nextSibling);
  }

  var LETTERS = /\p{L}{2,}/u;

  function process(el) {
    if (!config.enabled || el._wzBusy) return;
    var original = (el.textContent || "").trim();
    if (!original || !LETTERS.test(original)) return;
    if (original === el._wzSrc || original === el._wzTranslated) return;
    el._wzSrc = original;

    translate(original)
      .then(function (res) {
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
      .catch(function (err) {
        if (!process._warned) { process._warned = true; console.warn("%c[wz-translate]", "color:#30C7FB;font-weight:bold", "translation request failed - the endpoint is likely blocking (bot check / CORS / rate-limit), not the selector:", err); }
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

  var observer = new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      for (var j = 0; j < m.addedNodes.length; j++) scan(m.addedNodes[j]);
      if (m.type === "characterData" && m.target.parentNode) {
        var p = m.target.parentNode;
        if (p.matches && p.matches(MSG_SELECTOR)) process(p);
      }
    }
  });
  function observeChat() {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    scan(document.body);
  }
  if (document.body) observeChat();
  else document.addEventListener("DOMContentLoaded", observeChat, { once: true });

  function retranslateAll() {
    var nodes = document.querySelectorAll(MSG_SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      nodes[i]._wzSrc = null;
      process(nodes[i]);
    }
  }

  var pageWindow = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  pageWindow.WZTranslate = {
    config: config,
    setMode: function (mode) {
      config.mode = mode;
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
