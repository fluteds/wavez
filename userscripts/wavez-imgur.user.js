// ==UserScript==
// @name         Wavez Imgur -> Rimgo Safe
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.7
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-imgur.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-imgur.user.js
// @description  Replace Imgur links, backgrounds and CSS url() badges (e.g. niceatc/nicewoot) with Rimgo safely. Avoids "Content not viewable in your region" placeholders.
// @match        https://wavez.fm/*
// @match        https://*.wavez.fm/*
// @run-at       document-idle
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

  // niceatc/nicewoot renders its badge from a CSS rule injected as a <style> block (e.g. --nw-badge-img: url("https://i.imgur.com/...png")), not from an element attribute - so the stylesheet text needs rewriting too.
  function fixStyleEl(el) {
    if (!el || el.tagName !== 'STYLE') return;

    const css = el.textContent;
    if (!css || !css.includes('imgur.com')) return;

    const next = rewrite(css);
    if (next !== css) el.textContent = next;
  }

  // Rules built with insertRule() (no <style> text node) only live in the CSSOM, so rewrite them in place. Recurse into @media/@layer/@supports groups.
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

      // Grouping rule (@media, @layer, @supports) - descend.
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
    // document.styleSheets / ShadowRoot.styleSheets cover <style> + <link>.
    try {
      if (root.styleSheets) sheets = sheets.concat(Array.from(root.styleSheets));
    } catch (e) {}
    // Constructed sheets attached via adoptedStyleSheets.
    try {
      if (root.adoptedStyleSheets) sheets = sheets.concat(Array.from(root.adoptedStyleSheets));
    } catch (e) {}
    sheets.forEach(fixRules);
  }

  function scanStyles(root) {
    root = root || document;
    // Styles usually live in <head>, so scan the whole document, not just body.
    root.querySelectorAll?.('style').forEach(fixStyleEl);
    fixSheets(root);
  }

  // Cross-origin CSS (e.g. niceatc/nicewoot badge sheet). The badge image lives in a remote stylesheet the browser won't let us read via the CSSOM (sheet.cssRules throws cross-origin). So refetch it ourselves, rewrite imgur -> rimgo in the raw CSS, inject the result as a local <style>, and disable the original <link> so the imgur-referencing version stops applying. Needs @grant GM_xmlhttpRequest + @connect for the host.
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

    // Descend into shadow roots (userscript widgets often isolate their UI).
    root.querySelectorAll?.('*').forEach(el => {
      if (el.shadowRoot) {
        scan(el.shadowRoot);
        scanStyles(el.shadowRoot);
      }
    });
  }

  function start() {
    scan(document.body);
    scanStyles();
    scanRemoteCss();

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

    // Fallback for scripts that inject/rewrite styles or backgrounds after load.
    setInterval(() => {
      scan(document.body);
      scanStyles();
      scanRemoteCss();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
