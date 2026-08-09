// ==UserScript==
// @name         Wavez Scrobble Toggle
// @namespace    https://wavez.fm/
// @author       fluteds
// @version      1.0
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-scrobble.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-scrobble.user.js
// @description  Flip wavez's Last.fm scrobbling on/off from a room-footer button, no digging through settings.
// @match        https://wavez.fm/*
// @icon         https://wavez.fm/favicon.ico?favicon.39fukza6fvb7p.ico
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  var API = "https://api.wavez.fm/settings";
  var state = null; // null until first read
  var busy = false;
  var btn = null;

  function read(body) {
    if (body && typeof body.lastFmScrobblingEnabled === "boolean") state = body.lastFmScrobblingEnabled;
    return state;
  }

  function getState() {
    return fetch(API, { credentials: "include" }).then(function (r) { return r.json(); }).then(read);
  }

  function setState(v) {
    return fetch(API, {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lastFmScrobblingEnabled: v }),
    }).then(function (r) { if (!r.ok) throw new Error("PATCH " + r.status); return r.json(); }).then(read);
  }

  function toggle() {
    if (busy) return;
    busy = true;
    render();
    var ready = state === null ? getState() : Promise.resolve(state);
    ready
      .then(function (cur) { return setState(!cur); })
      .catch(function () { state = null; })
      .then(function () { busy = false; render(); });
  }

  function render() {
    if (!btn || !btn.isConnected) return;
    var on = state === true, off = state === false;
    var label = busy ? "Scrobbling…" : "Last.fm scrobbling: " + (on ? "on" : off ? "off" : "unknown");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.style.opacity = busy ? "0.6" : "1";
    if (on) { btn.style.borderColor = "rgba(52,211,153,.26)"; btn.style.background = "rgba(16,185,129,.10)"; btn.style.color = "#d1fae5"; }
    else if (off) { btn.style.borderColor = "rgba(248,113,113,.26)"; btn.style.background = "rgba(239,68,68,.10)"; btn.style.color = "#fee2e2"; }
    else { btn.style.borderColor = ""; btn.style.background = ""; btn.style.color = "rgba(255,255,255,.4)"; }
  }

  // State colour is inline so it renders without Tailwind JIT.
  function build() {
    var wrap = document.createElement("div");
    wrap.className = "inline-flex";
    wrap.innerHTML =
      '<button id="wz-scrobble-btn" type="button" data-wavezfm-room-footer-action="scrobble" class="relative inline-flex h-8 w-8 items-center justify-center rounded-md border leading-none transition xl:h-9 xl:w-9 hover:border-(--theme-field-border-focus) hover:bg-(--theme-button-neutral-hover)">' +
      '<span class="pointer-events-none relative z-10 inline-flex h-full w-full items-center justify-center leading-none [&>svg]:block [&>svg]:shrink-0">' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-radio">' +
      '<path d="M14 3l-9.371 3.749a1 1 0 0 0 -.629 .928v11.323a1 1 0 0 0 1 1h14a1 1 0 0 0 1 -1v-11a1 1 0 0 0 -1 -1h-14.5"></path><path d="M4 12h16"></path><path d="M7 12v-2"></path><path d="M17 16v.01"></path><path d="M13 16v.01"></path>' +
      "</svg></span></button>";
    btn = wrap.firstChild;
    btn.addEventListener("click", toggle);
    return wrap;
  }

  // The wrapper div, not the button (it also has inline-flex).
  function discordWrap() {
    var btns = document.querySelectorAll('button[aria-label="Discord"]');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].offsetParent === null) continue;
      var w = btns[i].closest("div.inline-flex");
      if (w && w.parentElement) return w;
    }
    return null;
  }

  // Sit after Discord; re-add if the SPA re-renders the row away.
  function ensure() {
    if (document.getElementById("wz-scrobble-btn")) return;
    var anchor = discordWrap();
    if (!anchor) return;
    anchor.after(build());
    render();
    if (state === null) getState().then(render).catch(function () {});
  }

  new MutationObserver(ensure).observe(document.documentElement, { childList: true, subtree: true });
  ensure();

  if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand("Toggle Last.fm scrobbling", toggle);
})();
