// ==UserScript==
// @name         Wavez Chat Pop-out
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      4.2
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-chat-popout.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-chat-popout.user.js
// @description  Pops chat into a separate always-on-top window that mirrors the real wavez chat rail (pixel-identical markup + styling) and sends over the wavez WebSocket directly. No second session, fully interactive (read + send).
// @match        https://wavez.fm/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Grab a handle to the live socket so we can send (reading is done by mirroring the rail DOM). Wraps message listeners only, never the constructor.
  let socket = null;
  let reqN = 0;

  function tap(e) {
    if (typeof e.data !== 'string') return;
    let b;
    try { b = JSON.parse(e.data); } catch { return; }
    if (!b || b.version !== 'v1') return;
    socket = e.target; // this is the wavez socket
  }

  const addEL = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, ...rest) {
    if (type === 'message' && typeof listener === 'function') {
      const wrapped = function (e) { tap(e); return listener.apply(this, arguments); };
      return addEL.call(this, type, wrapped, ...rest);
    }
    return addEL.call(this, type, listener, ...rest);
  };

  const desc = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
  if (desc && desc.set) {
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
      configurable: true,
      get() { return desc.get.call(this); },
      set(fn) {
        if (typeof fn === 'function') {
          const wrapped = function (e) { tap(e); return fn.apply(this, arguments); };
          desc.set.call(this, wrapped);
        } else {
          desc.set.call(this, fn);
        }
      },
    });
  }

  function send(content) {
    content = content.trim();
    if (!content || !socket || socket.readyState !== 1) return false;
    socket.send(JSON.stringify({
      type: 'command',
      event: 'send_chat',
      requestId: `req-${++reqN}-${Date.now()}`,
      version: 'v1',
      timestamp: new Date().toISOString(),
      payload: { content, channel: 'public', replyTo: null },
    }));
    return true;
  }

  // Popup window with a custom chat UI (blank same-origin window => no session).
  let popup = null;

  // Copy the page's stylesheets into the popup so theme vars, font and scrollbars are the live ones; our markup just references var(--theme-*).
  function copyStyles(win) {
    for (const sheet of document.styleSheets) {
      try {
        const rules = [...sheet.cssRules].map((r) => r.cssText).join('\n');
        const style = win.document.createElement('style');
        style.textContent = rules;
        win.document.head.appendChild(style);
      } catch {
        if (sheet.href) {
          const link = win.document.createElement('link');
          link.rel = 'stylesheet';
          link.href = sheet.href;
          win.document.head.appendChild(link);
        }
      }
    }
  }

  // Our layout, loaded after the page sheets so it wins; colors/fonts pull from the copied --theme-* vars (fallbacks cover a cold load).
  const popupCss = () => `
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; }
    body {
      display: flex; flex-direction: column;
      background: var(--theme-room-nav, #16181c);
      color: var(--theme-text-primary, #e7e9ea);
      font: 14px/1.4 var(--theme-font, system-ui, -apple-system, Segoe UI, sans-serif);
    }
    #wz-head {
      flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
      padding: 10px 12px; font-weight: 700; font-size: 13px; letter-spacing: .02em;
      border-bottom: 1px solid var(--theme-border, #2a2d33);
      background: var(--theme-room-nav, #16181c);
    }
    #wz-head svg { width: 15px; height: 15px; opacity: .7; }
    #wz-list { flex: 1 1 auto; overflow-y: auto; padding: 10px; }
    #wz-bar { flex: 0 0 auto; display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--theme-border, #2a2d33); }
    #wz-input {
      flex: 1 1 auto; resize: none; height: 38px; padding: 9px 10px;
      background: var(--theme-background, #0f1115); color: var(--theme-text-primary, #e7e9ea);
      border: 1px solid var(--theme-border, #2a2d33); border-radius: 8px;
      font: inherit;
    }
    #wz-send {
      flex: 0 0 auto; padding: 0 14px; border: 0; border-radius: 8px; cursor: pointer;
      background: var(--theme-accent, #1d9bf0); color: #fff; font-weight: 600;
    }
    #wz-send:hover { filter: brightness(1.1); }
    #wz-offline { padding: 6px 10px; font-size: 12px; color: var(--theme-accent, #f43f5e); display: none; }
    body.wz-offline #wz-offline { display: block; }
    body.wz-offline #wz-send { opacity: .5; pointer-events: none; }
  `;

  function openPopup() {
    if (popup && !popup.closed) { popup.focus(); return; }

    popup = window.open('', 'wavezChat', 'popup,width=380,height=640');
    if (!popup) { alert('Popup blocked - allow popups for wavez.fm.'); return; }

    const d = popup.document;
    d.title = 'Wavez Chat';
    d.head.innerHTML = '<meta charset="utf-8">';
    copyStyles(popup);
    const own = d.createElement('style');
    own.textContent = popupCss();
    d.head.appendChild(own);
    d.body.innerHTML = `
      <div id="wz-head">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>Chat</span>
      </div>
      <div id="wz-list"></div>
      <div id="wz-offline">Reconnecting… messages can't be sent right now.</div>
      <div id="wz-bar">
        <textarea id="wz-input" placeholder="Message…" rows="1"></textarea>
        <button id="wz-send" type="button">Send</button>
      </div>
    `;

    const list = d.getElementById('wz-list');
    const input = d.getElementById('wz-input');

    // Mirror the rail's message nodes verbatim; the copied stylesheets style the clones, so it's pixel-identical.
    function railList() {
      const rail = document.querySelector('[data-room-desktop-rail="true"]');
      if (!rail) return null;
      let el = rail.querySelector('[class*="wavezfm-chat-text-size"]'); // a message body
      while (el && el !== rail) {
        const oy = getComputedStyle(el).overflowY;
        if (oy === 'auto' || oy === 'scroll') return el; // the scroll container
        el = el.parentElement;
      }
      return null;
    }

    function clone(node) {
      if (node.nodeType !== 1) return; // elements only
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
      list.appendChild(d.importNode(node, true));
      if (atBottom) list.scrollTop = list.scrollHeight;
    }

    let mo = null;
    (function attach() {
      if (!popup || popup.closed) return;
      const src = railList();
      if (!src) { popup.setTimeout(attach, 300); return; } // wait for chat to render
      for (const child of src.children) clone(child);
      list.scrollTop = list.scrollHeight;
      mo = new MutationObserver((muts) => {
        for (const mu of muts) mu.addedNodes.forEach(clone);
      });
      mo.observe(src, { childList: true });
    })();

    function syncState() {
      d.body.classList.toggle('wz-offline', !socket || socket.readyState !== 1);
    }
    const stateTimer = popup.setInterval(syncState, 1000);
    syncState();

    function submit() {
      if (send(input.value)) { input.value = ''; input.style.height = '38px'; }
    }
    d.getElementById('wz-send').addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); submit(); }
    });
    input.focus();

    popup.addEventListener('pagehide', () => {
      if (mo) mo.disconnect();
      popup.clearInterval(stateTimer);
    });
  }

  // Pop-out button (added once the page DOM exists).
  const BTN_CSS = `
    #wavez-chat-popout-btn {
      position: fixed; right: 0; top: 50%; transform: translateY(-50%); margin-top: -64px;
      width: 20px; height: 58px; padding: 0;
      border: 1px solid var(--theme-border, #333); border-right: 0; border-radius: 8px 0 0 8px;
      background: var(--theme-room-nav, #1a1a1a);
      color: color-mix(in srgb, var(--theme-text-primary, #eee) 56%, transparent);
      box-shadow: -8px 0 18px rgba(0,0,0,.22);
      z-index: 2147483646; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      opacity: .82; transition: opacity .2s ease, color .2s ease, background .2s ease;
    }
    #wavez-chat-popout-btn:hover { opacity: 1; color: #fff; background: var(--theme-button-neutral-hover, #2a2a2a); }
    #wavez-chat-popout-btn svg { width: 12px; height: 12px; }
  `;

  function addButton() {
    if (document.getElementById('wavez-chat-popout-btn')) return;
    const style = document.createElement('style');
    style.textContent = BTN_CSS;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'wavez-chat-popout-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Pop out chat');
    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h6v6"></path><path d="M10 14L21 3"></path>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
      </svg>
    `;
    btn.addEventListener('click', openPopup);
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton);
  } else {
    addButton();
  }
})();
