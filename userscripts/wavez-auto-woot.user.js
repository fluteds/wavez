// ==UserScript==
// @name         Wavez Auto Woot
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.2
// @updateURL    https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-auto-woot.user.js
// @downloadURL  https://raw.githubusercontent.com/fluteds/wavez/main/userscripts/wavez-auto-woot.user.js
// @description  Woots every new track automatically via the WavezFM bridge, including while the tab is in the background.
// @match        https://wavez.fm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  var log = function () { console.log.apply(console, ["%c[wz-woot]", "color:#EF5350;font-weight:bold"].concat([].slice.call(arguments))); };
  var warn = function () { console.warn.apply(console, ["%c[wz-woot]", "color:#EF5350;font-weight:bold"].concat([].slice.call(arguments))); };

  var enabled = localStorage.getItem('wavez-autowoot') !== 'off';
  var lastKey = null;

  function shouldVote(key, last, votes) {
    return !!key && key !== last && !!votes && votes.canVote && votes.clientVote !== 'woot';
  }

  function voteCurrent(api) {
    if (!enabled) return;
    var state = api.room.getState();
    var pb = state && state.playback;
    if (!pb) return;
    if (!shouldVote(pb.playbackKey, lastKey, state.votes)) return;
    lastKey = pb.playbackKey;
    var res = api.actions.vote('woot');
    if (!res || !res.ok) warn('vote failed:', res && res.code);
  }

  function init(api) {
    voteCurrent(api);
    api.room.subscribe('playback_changed', function () { voteCurrent(api); });
    api.room.subscribe('votes_changed', function () { voteCurrent(api); });
    setInterval(function () { voteCurrent(api); }, 30000);

    window.WZWoot = {
      now: function () { lastKey = null; voteCurrent(api); },
      on: function () { enabled = true; localStorage.setItem('wavez-autowoot', 'on'); voteCurrent(api); },
      off: function () { enabled = false; localStorage.setItem('wavez-autowoot', 'off'); },
      get enabled() { return enabled; }
    };
    log('auto-woot ' + (enabled ? 'on' : 'off') + ' - toggle with WZWoot.on() / WZWoot.off()');
  }

  var tries = 0;
  var wait = setInterval(function () {
    var api = window.WavezFM;
    if (api && api.version === '1') {
      clearInterval(wait);
      init(api);
    } else if (++tries > 40) {
      clearInterval(wait);
    }
  }, 500);

  if (location.hash === '#wz-woot-test') {
    var ok = { canVote: true, clientVote: null };
    console.assert(shouldVote('k1', null, ok) === true, 'new track, can vote');
    console.assert(shouldVote('k1', 'k1', ok) === false, 'same track, skip');
    console.assert(shouldVote('k2', 'k1', { canVote: false, clientVote: null }) === false, 'cannot vote, skip');
    console.assert(shouldVote('k2', 'k1', { canVote: true, clientVote: 'woot' }) === false, 'already wooted, skip');
    console.assert(shouldVote(null, 'k1', ok) === false, 'no playbackKey, skip');
    log('tests passed');
  }
})();
