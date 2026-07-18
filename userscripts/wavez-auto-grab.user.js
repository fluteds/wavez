// ==UserScript==
// @name         Wavez Auto Grab
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.0
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-auto-grab.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-auto-grab.user.js
// @description  Grabs a track into a playlist whenever you woot it, with an on/off toggle in the corner.
// @match        https://wavez.fm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Track changes and "have I already grabbed this?" come from the official extension API (https://github.com/WavezFM/WavezFM-Extension-API), but grab itself is NOT in it - actions are vote/joinQueue/leaveQueue/sendChat/setVolume only - so the grab itself clicks the real button and picks from the picker.
(function () {
  'use strict';

  // Playlist to grab into, by name. "" = whichever the picker lists first.
  var PLAYLIST = 'Recs';

  // Only set these if the heuristics below match the wrong element. Run WZGrab.debug() in the console to see what they currently find.
  var GRAB_BTN_SELECTOR = '';
  var PICKER_SELECTOR = '';

  var LS_KEY = 'wavez-autograb';
  // Default off: unlike a woot, a grab writes to your playlist.
  var enabled = localStorage.getItem(LS_KEY) === 'on';
  var lastKey = null;

  function log(m) { console.log('[wz-grab] ' + m); }

  // Grab a track once you've wooted it, and only once. playbackKey identifies the track; clientVote is your own vote; clientGrabbed is "already in a playlist". Works with a manual woot or an auto-woot script - both land as clientVote.
  function shouldGrab(key, last, votes) {
    return !!key && key !== last && !!votes &&
      votes.clientVote === 'woot' && !votes.clientGrabbed;
  }

  // ---------------------------------- dom ----------------------------------
  function visible(el) {
    return el.offsetParent !== null;
  }

  // The vote buttons carry no aria-label or id, just utility classes. Two things are stable though: the count span is themed with --theme-vote-grab, and the label sits in its own span ("Grab") next to the count. Prefer the theme var, it survives a relabel (the site has pt-BR locales); fall back to the label.
  function findGrabButton() {
    if (GRAB_BTN_SELECTOR) return document.querySelector(GRAB_BTN_SELECTOR);
    var btns = document.querySelectorAll('button');
    var byLabel = null;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].querySelector('[style*="theme-vote-grab"]')) return btns[i];
      if (byLabel) continue;
      // Match the label span exactly: the button's own textContent reads "Grab0".
      var spans = btns[i].querySelectorAll('span');
      for (var j = 0; j < spans.length; j++) {
        if (spans[j].textContent.trim().toLowerCase() === 'grab') { byLabel = btns[i]; break; }
      }
    }
    return byLabel;
  }

  // The popup carries no role/dialog attributes, only data-wavezfm-grab-menu-root which the wrapper around the Grab button carries too. The popup is the one that does NOT contain the button. It's only in the DOM while the menu is open.
  function findPicker() {
    if (PICKER_SELECTOR) return document.querySelector(PICKER_SELECTOR);
    var btn = findGrabButton();
    var roots = document.querySelectorAll('[data-wavezfm-grab-menu-root]');
    for (var i = 0; i < roots.length; i++) {
      if (btn && roots[i].contains(btn)) continue; // that's the wrapper
      if (visible(roots[i])) return roots[i];
    }
    return null;
  }

  // An option's textContent runs the name into the subtitle ("RecsPlaylist - 53/300"), so read the name span instead. Same span the header's "Choose a playlist" uses, but that's a <p>, and Cancel is filtered out before we get here.
  function nameOf(el) {
    var span = el.querySelector('span.truncate');
    return (span ? span.textContent : el.textContent).trim();
  }

  // The second truncate span, e.g. "Active - 58/300" or "Playlist - 53/300".
  function detailOf(el) {
    var spans = el.querySelectorAll('span.truncate');
    return spans.length > 1 ? spans[1].textContent.trim() : '';
  }

  // Every playlist button in the open picker. Full playlists come back too, but disabled - callers decide whether to care.
  function optionsIn(picker) {
    var items = picker.querySelectorAll('button');
    var out = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].getAttribute('aria-label') === 'Cancel') continue; // header close
      if (visible(items[i])) out.push(items[i]);
    }
    return out;
  }

  function closePicker(picker) {
    var cancel = picker.querySelector('[aria-label="Cancel"]');
    if (cancel) cancel.click();
  }

  // Open the picker (if it isn't), hand the options to cb, and say whether we were the one who opened it so the caller can close it again.
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

  // Poll for fn() to go truthy, up to ms. The picker opens asynchronously.
  function waitFor(fn, ms, cb) {
    var waited = 0;
    var t = setInterval(function () {
      var v = fn();
      if (v) { clearInterval(t); cb(v); }
      else if ((waited += 100) >= ms) { clearInterval(t); cb(null); }
    }, 100);
  }

  function choosePlaylist(picker) {
    // Full playlists (300/300) come through disabled, so they can't be grabbed into.
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
    // Only stamp lastKey on an actual grab: a track sits un-wooted for a while before you woot it, and stamping on the skip would dedupe that away.
    if (!shouldGrab(pb.playbackKey, lastKey, state.votes)) return;
    lastKey = pb.playbackKey;
    doGrab();
  }

  // ----------------------------------- ui ----------------------------------
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

  // ---------------------------------- init ---------------------------------
  function init(api) {
    grabCurrent(api); // catch a track that's already wooted at load
    // The woot is the trigger, so watch votes, not playback.
    api.room.subscribe('votes_changed', function () { grabCurrent(api); });
    buildUI(api);

    window.WZGrab = {
      on: function () { enabled = true; localStorage.setItem(LS_KEY, 'on'); grabCurrent(api); },
      off: function () { enabled = false; localStorage.setItem(LS_KEY, 'off'); },
      now: function () { lastKey = null; doGrab(); }, // force a grab
      get enabled() { return enabled; },
      // Your playlist names, for copying into PLAYLIST. Opens the picker, reads it, closes it again - opening it doesn't grab, only clicking an option does. Async: the table prints once the menu has rendered.
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
      // What the heuristics currently match, for pinning the selectors.
      debug: function () {
        console.log('grab button:', findGrabButton());
        console.log('picker (open it first):', findPicker());
      }
    };
    log('auto grab ' + (enabled ? 'on' : 'off') + ' - toggle with the corner pill or WZGrab.on()/off()');
  }

  // The bridge may be injected after document-idle, so wait for it. Say so up front: without this line a missing bridge and a missing script look identical in the console, since WZGrab is only defined once init() runs.
  log('loaded, waiting for the WavezFM bridge...');
  var tries = 0;
  var wait = setInterval(function () {
    var api = window.WavezFM;
    if (api && api.version === '1') {
      clearInterval(wait);
      init(api);
    } else if (++tries > 40) { // ~20s
      clearInterval(wait);
      console.warn('[wz-grab] WavezFM bridge never appeared, so WZGrab is unavailable. ' +
        'Are you inside a room? window.WavezFM is currently ' + typeof window.WavezFM + '.');
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
    console.log('[wz-grab] tests passed');
  }
})();
