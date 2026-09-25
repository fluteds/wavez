// ==UserScript==
// @name         Wavez Auto Grab
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-auto-grab.user.js
// @downloadURL  https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-auto-grab.user.js
// @description  Grabs a track into a playlist whenever you woot it, with an on/off toggle in the corner.
// @match        https://wavez.fm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var PLAYLIST = 'Recs';

  var GRAB_BTN_SELECTOR = '';
  var PICKER_SELECTOR = '';

  var LS_KEY = 'wavez-autograb';
  var enabled = localStorage.getItem(LS_KEY) === 'on';
  var lastKey = null;

  var log = function () { console.log.apply(console, ["%c[wz-grab]", "color:#FFCA28;font-weight:bold"].concat([].slice.call(arguments))); };
  var warn = function () { console.warn.apply(console, ["%c[wz-grab]", "color:#FFCA28;font-weight:bold"].concat([].slice.call(arguments))); };

  function shouldGrab(key, last, votes) {
    return !!key && key !== last && !!votes &&
      votes.clientVote === 'woot' && !votes.clientGrabbed;
  }

  function visible(el) {
    return el.offsetParent !== null;
  }

  function findGrabButton() {
    if (GRAB_BTN_SELECTOR) return document.querySelector(GRAB_BTN_SELECTOR);
    var btns = document.querySelectorAll('button');
    var byLabel = null;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].querySelector('[style*="theme-vote-grab"]')) return btns[i];
      if (byLabel) continue;
      var spans = btns[i].querySelectorAll('span');
      for (var j = 0; j < spans.length; j++) {
        if (spans[j].textContent.trim().toLowerCase() === 'grab') { byLabel = btns[i]; break; }
      }
    }
    return byLabel;
  }

  function findPicker() {
    if (PICKER_SELECTOR) return document.querySelector(PICKER_SELECTOR);
    var btn = findGrabButton();
    var roots = document.querySelectorAll('[data-wavezfm-grab-menu-root]');
    for (var i = 0; i < roots.length; i++) {
      if (btn && roots[i].contains(btn)) continue;
      if (visible(roots[i])) return roots[i];
    }
    return null;
  }

  function nameOf(el) {
    var span = el.querySelector('span.truncate');
    return (span ? span.textContent : el.textContent).trim();
  }

  function detailOf(el) {
    var spans = el.querySelectorAll('span.truncate');
    return spans.length > 1 ? spans[1].textContent.trim() : '';
  }

  function optionsIn(picker) {
    var items = picker.querySelectorAll('button');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('aria-label') === 'Cancel') continue;
      if (visible(items[i])) out.push(items[i]);
    }
    return out;
  }

  function closePicker(picker) {
    var cancel = picker.querySelector('[aria-label="Cancel"]');
    if (cancel) cancel.click();
  }

  function withPicker(cb) {
    var open = findPicker();
    if (open) return cb(optionsIn(open), null);
    var btn = findGrabButton();
    if (!btn) { log('grab button not found - are you in a room?'); return cb([], null); }
    btn.click();
    waitFor(findPicker, 2000, function (picker) {
      if (!picker) { log('picker did not open'); return cb([], null); }
      cb(optionsIn(picker), picker);
    });
  }

  function waitFor(fn, ms, cb) {
    var waited = 0;
    var t = setInterval(function () {
      var v = fn();
      if (v) { clearInterval(t); cb(v); }
      else if ((waited += 100) >= ms) { clearInterval(t); cb(null); }
    }, 100);
  }

  function choosePlaylist(picker) {
    var options = optionsIn(picker).filter(function (el) { return !el.disabled; });
    if (!options.length) { log('picker opened but listed no playlists'); return; }

    var pick = options[0];
    if (PLAYLIST) {
      pick = options.filter(function (el) {
        return nameOf(el).toLowerCase() === PLAYLIST.toLowerCase();
      })[0];
      if (!pick) {
        log('playlist "' + PLAYLIST + '" not in the picker (full or renamed?), skipping');
        return;
      }
    }
    pick.click();
    log('grabbed into "' + nameOf(pick) + '"');
  }

  function doGrab() {
    var btn = findGrabButton();
    if (!btn) { log('grab button not found - set GRAB_BTN_SELECTOR'); return; }
    btn.click();
    waitFor(findPicker, 2000, function (picker) {
      if (!picker) { log('no picker appeared, assuming the grab went straight through'); return; }
      choosePlaylist(picker);
    });
  }

  function grabCurrent(api) {
    if (!enabled) return;
    var state = api.room.getState();
    var pb = state && state.playback;
    if (!pb) return;
    if (!shouldGrab(pb.playbackKey, lastKey, state.votes)) return;
    lastKey = pb.playbackKey;
    doGrab();
  }

  function buildUI(api) {
    var css = document.createElement('style');
    css.textContent =
      '#wz-grab-pill{position:fixed;right:14px;bottom:14px;z-index:99999;' +
      'display:flex;gap:6px;align-items:center;padding:7px 12px;border-radius:999px;' +
      'background:rgba(20,20,26,.86);border:1px solid rgba(255,255,255,.12);' +
      'font:500 12px/1 system-ui,sans-serif;color:#e7e7ea;cursor:pointer;user-select:none;opacity:.6}' +
      '#wz-grab-pill.on{opacity:1}' +
      '#wz-grab-pill input{accent-color:#ff5c8a;margin:0;cursor:pointer}';
    document.head.appendChild(css);

    var pill = document.createElement('label');
    pill.id = 'wz-grab-pill';
    pill.title = 'Grab a track into "' + (PLAYLIST || 'the first playlist') + '" whenever you woot it';
    if (enabled) pill.className = 'on';

    var box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = enabled;
    box.addEventListener('change', function () {
      enabled = box.checked;
      localStorage.setItem(LS_KEY, enabled ? 'on' : 'off');
      pill.className = enabled ? 'on' : '';
      if (enabled) grabCurrent(api);
    });

    pill.appendChild(box);
    pill.appendChild(document.createTextNode('auto grab'));
    document.body.appendChild(pill);
  }

  function init(api) {
    grabCurrent(api);
    api.room.subscribe('votes_changed', function () { grabCurrent(api); });
    buildUI(api);

    window.WZGrab = {
      on: function () { enabled = true; localStorage.setItem(LS_KEY, 'on'); grabCurrent(api); },
      off: function () { enabled = false; localStorage.setItem(LS_KEY, 'off'); },
      now: function () { lastKey = null; doGrab(); },
      get enabled() { return enabled; },
      playlists: function () {
        withPicker(function (options, opened) {
          if (options.length) {
            console.table(options.map(function (el) {
              return {
                playlist: nameOf(el),
                detail: detailOf(el),
                full: !!el.disabled,
                target: nameOf(el).toLowerCase() === PLAYLIST.toLowerCase()
              };
            }));
          }
          if (opened) closePicker(opened);
        });
      },
      debug: function () {
        console.log('grab button:', findGrabButton());
        console.log('picker (open it first):', findPicker());
      }
    };
    log('auto grab ' + (enabled ? 'on' : 'off') + ' - toggle with the corner pill or WZGrab.on()/off()');
  }

  log('loaded, waiting for the WavezFM bridge...');
  var tries = 0;
  var wait = setInterval(function () {
    var api = window.WavezFM;
    if (api && api.version === '1') {
      clearInterval(wait);
      init(api);
    } else if (++tries > 40) {
      clearInterval(wait);
      warn('WavezFM bridge never appeared, so WZGrab is unavailable. Are you inside a room? window.WavezFM is currently ' + typeof window.WavezFM + '.');
    }
  }, 500);

  if (location.hash === '#wz-grab-test') {
    var wooted = { clientVote: 'woot', clientGrabbed: false };
    console.assert(shouldGrab('k1', null, wooted) === true, 'wooted, not grabbed');
    console.assert(shouldGrab('k1', 'k1', wooted) === false, 'already grabbed this track, skip');
    console.assert(shouldGrab('k2', 'k1', { clientVote: null, clientGrabbed: false }) === false, 'not wooted yet, skip');
    console.assert(shouldGrab('k2', 'k1', { clientVote: 'meh', clientGrabbed: false }) === false, 'mehed, skip');
    console.assert(shouldGrab('k2', 'k1', { clientVote: 'woot', clientGrabbed: true }) === false, 'already in a playlist, skip');
    console.assert(shouldGrab(null, 'k1', wooted) === false, 'no playbackKey, skip');
    log('tests passed');
  }
})();
