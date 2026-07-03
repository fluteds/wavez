// ==UserScript==
// @name         Wavez Chat Toggle
// @namespace    https://wavez.fm/
// @icon         https://wavez.fm/favicon.ico
// @version      1.3
// @updateURL    https://github.com/fluteds/userscripts/raw/main/wavez/wavez-sidebar.user.js
// @downloadURL  https://github.com/fluteds/userscripts/raw/main/wavez/wavez-sidebar.user.js
// @description  Adds a collapsible chat button to the chat section, with an unread dot when collapsed.
// @match        https://wavez.fm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'wavez-chat-hidden';

  const css = document.createElement('style');
  css.textContent = `
    #wavez-chat-rail-toggle {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);

      width: 20px;
      height: 58px;

      padding: 0;
      border: 1px solid var(--theme-border);
      border-right: 0;
      border-radius: 8px 0 0 8px;

      background: var(--theme-room-nav);
      color: color-mix(in srgb, var(--theme-text-primary) 56%, transparent);

      box-shadow: -8px 0 18px rgba(0,0,0,.22);

      z-index: 2147483647;
      cursor: pointer;

      display: flex;
      align-items: center;
      justify-content: center;

      opacity: .82;
      transition:
        opacity .2s ease,
        color .2s ease,
        background .2s ease;
    }

    #wavez-chat-rail-toggle:hover {
      opacity: 1;
      color: white;
      background: var(--theme-button-neutral-hover);
    }

    #wavez-chat-rail-toggle svg {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
      transition: transform .2s ease;
    }

    #wavez-chat-rail-toggle:hover svg {
      transform: scale(1.12);
    }

    #wavez-chat-rail-toggle.chat-hidden svg {
      transform: rotate(180deg);
    }

    #wavez-chat-rail-toggle.chat-hidden:hover svg {
      transform: rotate(180deg) scale(1.12);
    }

    #wavez-chat-rail-toggle.has-new::after {
      content: '';
      position: absolute;
      top: 6px;
      right: 6px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--theme-accent, #f43f5e);
      box-shadow: 0 0 0 2px var(--theme-room-nav);
    }
  `;
  document.head.appendChild(css);

  function getRail() {
    return document.querySelector('[data-room-desktop-rail="true"]');
  }

  function makeButton() {
    const btn = document.createElement('button');
    btn.id = 'wavez-chat-rail-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Toggle chat');

    btn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg"
           viewBox="0 0 24 24"
           fill="none"
           stroke="currentColor"
           stroke-width="2.4"
           stroke-linecap="round"
           stroke-linejoin="round">
        <path d="M9 6l6 6l-6 6"></path>
      </svg>
    `;

    document.body.appendChild(btn);
    return btn;
  }

  function init() {
    const rail = getRail();
    if (!rail || document.getElementById('wavez-chat-rail-toggle')) {
      return false;
    }

    const btn = makeButton();

    function apply() {
      const hidden = localStorage.getItem(KEY) === 'true';

      rail.style.display = hidden ? 'none' : '';
      btn.classList.toggle('chat-hidden', hidden);

      // Opening the chat clears the unread dot.
      if (!hidden) btn.classList.remove('has-new');

      if (hidden) {
        btn.style.right = '0px';
      } else {
        const rect = rail.getBoundingClientRect();

        // Makes the handle stick out slightly from the chat rail
        btn.style.right = `${window.innerWidth - rect.left - 1}px`;
      }
    }

    btn.addEventListener('click', () => {
      const hidden = localStorage.getItem(KEY) === 'true';
      localStorage.setItem(KEY, String(!hidden));
      apply();
    });

    window.addEventListener('resize', apply);

    // Flag an unread dot when a message arrives while chat is hidden.
    const markUnread = () => {
      if (localStorage.getItem(KEY) === 'true') btn.classList.add('has-new');
    };

    const api = window.WavezFM;
    if (api && api.version === '1') {
      // Bridge only fires on real chat messages, so no false positives.
      api.room.subscribe('chat_message', markUnread);
    } else {
      // Fallback when the bridge isn't there: treat any node added to the rail as a new message.
      new MutationObserver((records) => {
        if (records.some((r) => r.addedNodes.length)) markUnread();
      }).observe(rail, { childList: true, subtree: true });
    }

    apply();
    return true;
  }

  const wait = setInterval(() => {
    if (init()) {
      clearInterval(wait);
    }
  }, 500);
})();