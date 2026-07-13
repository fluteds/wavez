// ==UserScript==
// @name         Wavez Auto Woot
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.1
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-auto-woot.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-auto-woot.user.js
// @description  Woots every new track automatically via the WavezFM bridge, including while the tab is in the background.
// @match        https://wavez.fm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

// Uses the official extension API: https://github.com/WavezFM/WavezFM-Extension-API
(function () {
  'use strict';

  var enabled = localStorage.getItem('wavez-autowoot') !== 'off';
  var lastKey = null;

  // Vote only on a new track we haven't already wooted, and only when allowed.
  // playbackKey is the API's track-change signal; clientVote is our own vote.
  function shouldVote(key, last, votes) {
    return !!key && key !== last && !!votes && votes.canVote && votes.clientVote !== 'woot';
  }

  function voteCurrent(api) {
    if (!enabled) return;
    var state = api.room.getState();
    var pb = state && state.playback;
    if (!pb) return;
    // Only stamp lastKey on an actual vote. Stamping on the skip marked a track
    // as handled when votes just weren't ready yet (canVote still false), and
    // nothing ever retried it - the main reason woots got missed in a background
    // tab, where the state lands later relative to playback_changed.
    if (!shouldVote(pb.playbackKey, lastKey, state.votes)) return;
    lastKey = pb.playbackKey;
    var res = api.actions.vote('woot');
    if (!res || !res.ok) console.warn('[wz-woot] vote failed:', res && res.code);
  }

  function init(api) {
    voteCurrent(api); // catch the track already playing at load
    api.room.subscribe('playback_changed', function () { voteCurrent(api); });
    // Retry once the vote state actually arrives for the new track.
    api.room.subscribe('votes_changed', function () { voteCurrent(api); });
    // Backstop for a hidden tab: events can be missed or arrive throttled, and a
    // re-check is free (shouldVote gates it, so no redundant API calls). Timers
    // are throttled in the background, but wavez is playing audio, which exempts
    // the tab from Chrome's harshest throttling - worst case this lands late.
    setInterval(function () { voteCurrent(api); }, 30000);

    window.WZWoot = {
      now: function () { lastKey = null; voteCurrent(api); }, // force a woot
      on: function () { enabled = true; localStorage.setItem('wavez-autowoot', 'on'); voteCurrent(api); },
      off: function () { enabled = false; localStorage.setItem('wavez-autowoot', 'off'); },
      get enabled() { return enabled; }
    };
    console.log('[wz-woot] auto-woot ' + (enabled ? 'on' : 'off') + ' - toggle with WZWoot.on() / WZWoot.off()');
  }

  // The bridge may be injected after document-idle, so wait for it.
  var tries = 0;
  var wait = setInterval(function () {
    var api = window.WavezFM;
    if (api && api.version === '1') {
      clearInterval(wait);
      init(api);
    } else if (++tries > 40) {
      clearInterval(wait); // ~20s, give up quietly (not in a room, or API gone)
    }
  }, 500);

  // Quick check on the vote guard: load with #wz-woot-test.
  if (location.hash === '#wz-woot-test') {
    var ok = { canVote: true, clientVote: null };
    console.assert(shouldVote('k1', null, ok) === true, 'new track, can vote');
    console.assert(shouldVote('k1', 'k1', ok) === false, 'same track, skip');
    console.assert(shouldVote('k2', 'k1', { canVote: false, clientVote: null }) === false, 'cannot vote, skip');
    console.assert(shouldVote('k2', 'k1', { canVote: true, clientVote: 'woot' }) === false, 'already wooted, skip');
    console.assert(shouldVote(null, 'k1', ok) === false, 'no playbackKey, skip');
    console.log('[wz-woot] tests passed');
  }
})();
