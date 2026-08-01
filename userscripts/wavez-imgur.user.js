// ==UserScript==
// @name         Wavez Imgur -> Rimgo Safe
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.8
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-imgur.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-imgur.user.js
// @description  Replace Imgur links, backgrounds and CSS url() badges (e.g. niceatc/nicewoot) with Rimgo safely. Avoids "Content not viewable in your region" placeholders.
// @match        https://wavez.fm/*
// @match        https://*.wavez.fm/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      niceatc.api.br
// @connect      woot.niceatc.api.br
// ==/UserScript==

(function () {
  'use strict';

  const ALTSITE = 'https://rimgo.vern.cc';

  function rewrite(value) {
    if (!value || !value.includes('imgur.com')) return value;

    return value.replace(
      /https?:\/\/(?:i\.|m\.|www\.)?imgur\.com/gi,
      ALTSITE
    );
  }

  // nicewoot measures the imgur image (new Image()) to size its avatar sprites, so a region-blocked browser measures the placeholder and the geometry is wrong however we rewrite the DOM. Rewrite at the src boundary so the measurement loads Rimgo. Needs document-start.
  function patchImageSrc() {
    const proto = HTMLImageElement.prototype;
    for (const prop of ['src', 'srcset']) {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set) continue;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get() { return desc.get.call(this); },
        set(v) { desc.set.call(this, rewrite(v)); }
      });
    }
    // Also the setAttribute path.
    const setAttr = proto.setAttribute;
    proto.setAttribute = function (name, value) {
      if (name === 'src' || name === 'srcset') value = rewrite(value);
      return setAttr.call(this, name, value);
    };
  }
  try { patchImageSrc(); } catch (e) {}

  function fixElement(el) {
    if (!el || el.nodeType !== 1) return;

    for (const attr of ['href', 'src', 'srcset', 'data-src', 'poster', 'style']) {
      const oldValue = el.getAttribute(attr);
      if (!oldValue || !oldValue.includes('imgur.com')) continue;

      const newValue = rewrite(oldValue);
      if (newValue !== oldValue) {
        el.setAttribute(attr, newValue);
      }
    }
  }

  // Badges live in an injected <style> block (--nw-badge-img: url(...)), not an attribute, so rewrite the stylesheet text too.
  function fixStyleEl(el) {
    if (!el || el.tagName !== 'STYLE') return;

    const css = el.textContent;
    if (!css || !css.includes('imgur.com')) return;

    const next = rewrite(css);
    if (next !== css) el.textContent = next;
  }

  // insertRule() rules have no <style> text node, so rewrite them in the CSSOM. Recurse into @media/@layer/@supports.
  function fixRules(parent) {
    let rules;
    try {
      rules = parent.cssRules;
    } catch (e) {
      return; // cross-origin sheet, not readable
    }
    if (!rules) return;

    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];

      // Grouping rule - descend.
      if (rule.cssRules && rule.cssRules.length) {
        fixRules(rule);
        continue;
      }

      const text = rule.cssText;
      if (!text || !text.includes('imgur.com')) continue;

      const next = rewrite(text);
      if (next === text) continue;

      try {
        parent.deleteRule(i);
        parent.insertRule(next, i);
      } catch (e) {
        // malformed rule - skip
      }
    }
  }

  function fixSheets(root) {
    let sheets = [];
    // <style> + <link>, plus constructed adoptedStyleSheets.
    try {
      if (root.styleSheets) sheets = sheets.concat(Array.from(root.styleSheets));
    } catch (e) {}
    try {
      if (root.adoptedStyleSheets) sheets = sheets.concat(Array.from(root.adoptedStyleSheets));
    } catch (e) {}
    sheets.forEach(fixRules);
  }

  function scanStyles(root) {
    root = root || document;
    root.querySelectorAll?.('style').forEach(fixStyleEl);
    fixSheets(root);
  }

  // The niceatc badge sheet is cross-origin, so the CSSOM won't read it. Refetch it, rewrite the raw CSS, inject as a local <style>, and disable the original <link>. Needs GM_xmlhttpRequest + @connect.
  const REMOTE_CSS_HOST = 'niceatc';
  const remoteCss = new Map(); // href -> 'pending' | 'done' | 'clean' | 'failed'

  function gmFetch() {
    if (typeof GM_xmlhttpRequest !== 'undefined') return GM_xmlhttpRequest;
    if (typeof GM !== 'undefined' && GM.xmlHttpRequest) return GM.xmlHttpRequest;
    return null;
  }

  function importRemoteCss(link) {
    const href = link.href;
    if (!href) return;

    let url;
    try { url = new URL(href, location.href); } catch (e) { return; }
    if (url.origin === location.origin) return;          // same-origin = readable elsewhere
    if (!url.hostname.includes(REMOTE_CSS_HOST)) return; // only the niceatc sheet

    const state = remoteCss.get(href);
    if (state === 'done') { link.disabled = true; return; } // keep replacements disabled
    if (state) return;                                      // pending / clean / failed

    const fetcher = gmFetch();
    if (!fetcher) return; // no cross-origin read available (script needs @grant)

    remoteCss.set(href, 'pending');
    fetcher({
      method: 'GET',
      url: href,
      onload(res) {
        const css = res.responseText || '';
        if (!css.includes('imgur.com')) { remoteCss.set(href, 'clean'); return; }
        const style = document.createElement('style');
        style.setAttribute('data-rimgo-import', href);
        style.textContent = rewrite(css);
        (document.head || document.documentElement).appendChild(style);
        link.disabled = true;
        remoteCss.set(href, 'done');
      },
      onerror() { remoteCss.set(href, 'failed'); }
    });
  }

  function scanRemoteCss() {
    document.querySelectorAll('link[rel~="stylesheet"]').forEach(importRemoteCss);
  }

  function scan(root) {
    if (!root) return;

    if (root.nodeType === 1) {
      fixElement(root);
      fixStyleEl(root);
    }

    root.querySelectorAll?.('[href*="imgur.com"], [src*="imgur.com"], [srcset*="imgur.com"], [data-src*="imgur.com"], [poster*="imgur.com"], [style*="imgur.com"]')
      .forEach(fixElement);

    root.querySelectorAll?.('style').forEach(fixStyleEl);

    // Descend into shadow roots.
    root.querySelectorAll?.('*').forEach(el => {
      if (el.shadowRoot) {
        scan(el.shadowRoot);
        scanStyles(el.shadowRoot);
      }
    });
  }

  function fullScan() {
    scan(document.body);
    scanStyles();
    scanRemoteCss();
  }

  function start() {
    // Attach at document-start, before nicewoot mounts avatars, so their imgur URLs are rewritten before the browser fetches the placeholder.
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(scan);
        }

        if (mutation.type === 'attributes') {
          fixElement(mutation.target);
        }
      }
    });

    // Observe <html> so injected <head> <style> blocks are caught too.
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['href', 'src', 'srcset', 'data-src', 'poster', 'style']
    });

    // Sweep now, again once the body parses, then a slow fallback.
    fullScan();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fullScan);
    setInterval(fullScan, 1500);
  }

  start();
})();
