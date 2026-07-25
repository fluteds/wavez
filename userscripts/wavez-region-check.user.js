// ==UserScript==
// @name         Wavez Region Check
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.5
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-region-check.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-region-check.user.js
// @description  Flags tracks in your playlists that YouTube only allows in a couple of countries, so you can keep spinning.
// @match        https://wavez.fm/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // A track is flagged when its allowed list is a subset of these.
  var REGIONS = ['US', 'CA'];

  // YouTube Data API v3 key. Leave blank to be prompted on first run (then remembered).
  var YT_API_KEY = '';

  var API = 'https://api.wavez.fm';
  var KEY_LS = 'wavez-region-ytkey';
  var FLAGS_LS = 'wavez-region-flags-v1'; // persisted flags, to restore pills on load
  var YT = 'https://www.googleapis.com/youtube/v3/videos';

  // normTitle -> count, so rows can be tagged as the list re-renders. Title is all we can match on: rows carry no track id.
  var lockedTitles = {};
  var lastOffenders = []; // from the last check, for the console remove helpers

  function log(m) { console.log('[wz-region] ' + m); }

  // Snoop the app's own Authorization header off its requests and reuse it, since we can't guess it.
  var authHeader = null;
  (function captureAuth() {
    var of = window.fetch;
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.indexOf('api.wavez.fm') !== -1) {
          var h = new Headers((init && init.headers) || (typeof input === 'object' && input.headers) || {});
          var a = h.get('authorization');
          if (a) authHeader = a;
        }
      } catch (e) {}
      return of.apply(this, arguments);
    };
  })();

  function apiKey() {
    var k = YT_API_KEY || localStorage.getItem(KEY_LS) || '';
    if (!k) {
      k = (window.prompt('YouTube Data API key (stored in localStorage, only used for videos.list):') || '').trim();
      if (k) localStorage.setItem(KEY_LS, k);
    }
    return k;
  }

  function apiGet(path) {
    var headers = {};
    if (authHeader) headers['Authorization'] = authHeader;
    return fetch(API + path, { credentials: 'include', headers: headers }).then(function (res) {
      if (!res.ok) throw new Error(path + ' -> ' + res.status);
      return res.json();
    }).then(function (j) {
      return Array.isArray(j) ? j : (j && j.data) || []; // bare array today, tolerate a data envelope
    });
  }

  function apiDelete(path) {
    var headers = {};
    if (authHeader) headers['Authorization'] = authHeader;
    return fetch(API + path, { method: 'DELETE', credentials: 'include', headers: headers }).then(function (res) {
      if (!res.ok) throw new Error('DELETE ' + path + ' -> ' + res.status);
      return true;
    });
  }

  function readJSON(lsKey) {
    try { return JSON.parse(localStorage.getItem(lsKey)) || null; } catch (e) { return null; }
  }
  function writeJSON(lsKey, obj) {
    try { localStorage.setItem(lsKey, JSON.stringify(obj)); } catch (e) {}
  }

  function saveFlags() { writeJSON(FLAGS_LS, { regions: REGIONS.join(','), titles: lockedTitles }); }

  // Pure, so the self-check can hit it: locked when every allowed country is one of ours.
  function limitedTo(allowed, regions) {
    if (!allowed || !allowed.length) return false;
    return allowed.every(function (r) { return regions.indexOf(r) !== -1; });
  }

  // videos.list, 50 ids and 1 quota unit per call. Resolves { id: { status: 'ok'|'gone', allowed } }; ids YouTube omits are deleted/private.
  function restrictions(ids) {
    var key = apiKey();
    if (!key) return Promise.reject(new Error('no API key'));
    var found = {};
    var batches = [];
    for (var i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
    return batches.reduce(function (chain, batch) {
      return chain.then(function () {
        return fetch(YT + '?part=contentDetails&maxResults=50&key=' + encodeURIComponent(key) + '&id=' + batch.join(','))
          .then(function (res) {
            if (!res.ok) return res.text().then(function (t) { throw new Error('youtube ' + res.status + ': ' + t); });
            return res.json();
          })
          .then(function (j) {
            (j.items || []).forEach(function (item) {
              var rr = item.contentDetails && item.contentDetails.regionRestriction;
              // Only the allowed whitelist; a blocked list naming all-but-two countries would slip past.
              found[item.id] = (rr && rr.allowed) || null;
            });
          });
      });
    }, Promise.resolve()).then(function () {
      var map = {};
      ids.forEach(function (id) { map[id] = (id in found) ? { status: 'ok', allowed: found[id] } : { status: 'gone', allowed: null }; });
      return map;
    });
  }

  function checkPlaylist(playlist) {
    return apiGet('/playlists/' + encodeURIComponent(playlist.id) + '/tracks').then(function (tracks) {
      var yt = tracks.filter(function (t) { return t.source === 'youtube' && t.sourceId; });
      if (!yt.length) return { playlist: playlist.name, total: 0, locked: [], gone: [] };
      return restrictions(yt.map(function (t) { return t.sourceId; })).then(function (map) {
        var locked = [], gone = [];
        yt.forEach(function (t) {
          var r = map[t.sourceId];
          // playlistId/trackId ride along for removal later; report() trims them for the console table.
          var row = { playlistId: playlist.id, playlistName: playlist.name, trackId: t.id, title: t.title, track: t.title + (t.artist ? ' - ' + t.artist : ''), url: 'https://youtu.be/' + t.sourceId };
          if (r.status === 'gone') gone.push(row);
          else if (r.status === 'ok' && limitedTo(r.allowed, REGIONS)) {
            locked.push(Object.assign(row, { allowed: r.allowed.join(',') }));
            lockedTitles[norm(t.title)] = r.allowed.length;
          }
        });
        return { playlist: playlist.name, total: yt.length, locked: locked, gone: gone };
      });
    });
  }

  // One playlist at a time: sequential YouTube calls, ordered log. A full scan resets flags first so a now-available track drops its pill, then persists.
  function checkAll(only) {
    if (!apiKey()) { log('no API key, cancelled'); return Promise.resolve([]); }
    return apiGet('/playlists').then(function (playlists) {
      var wanted = only ? playlists.filter(function (p) { return p.id === only || p.name.toLowerCase() === String(only).toLowerCase(); }) : playlists;
      if (!wanted.length) { log('no playlist matched "' + only + '"'); return []; }
      if (!only) lockedTitles = {};
      return wanted.reduce(function (chain, p) {
        return chain.then(function (acc) {
          return checkPlaylist(p).then(function (r) { log(r.playlist + ': ' + r.locked.length + ' locked, ' + r.gone.length + ' gone, of ' + r.total + ' youtube tracks'); return acc.concat([r]); });
        });
      }, Promise.resolve([])).then(function (results) { saveFlags(); return results; });
    });
  }

  function report(results) {
    var locked = [], gone = [];
    results.forEach(function (r) { locked = locked.concat(r.locked); gone = gone.concat(r.gone); });
    var lockedCols = function (r) { return { playlist: r.playlistName, track: r.track, allowed: r.allowed }; };
    var goneCols = function (r) { return { playlist: r.playlistName, track: r.track, url: r.url }; };
    if (locked.length) { console.log('[wz-region] playable only in ' + REGIONS.join('/') + ':'); console.table(locked.map(lockedCols)); }
    if (gone.length) { console.log('[wz-region] deleted or private:'); console.table(gone.map(goneCols)); }
    if (!locked.length && !gone.length) log('nothing region-locked or missing');
    return locked.length;
  }

  // Flatten results into removable offenders, gone first then region-locked.
  function offendersOf(results) {
    var out = [];
    results.forEach(function (r) {
      r.gone.forEach(function (g) { out.push(Object.assign({ why: 'deleted or private on YouTube' }, g)); });
      r.locked.forEach(function (l) { out.push(Object.assign({ why: 'only playable in ' + REGIONS.join('/') }, l)); });
    });
    return out;
  }

  function removeOffender(o) {
    return apiDelete('/playlists/' + encodeURIComponent(o.playlistId) + '/tracks/' + encodeURIComponent(o.trackId)).then(function () {
      delete lockedTitles[norm(o.title)];
      markRemoved(o.title);
      log('removed "' + o.track + '" from ' + o.playlistName);
      return true;
    }).catch(function (e) {
      log('remove failed for "' + o.track + '": ' + e.message);
      toast('Remove failed', o.track);
      return false;
    });
  }

  // ----------------------------------- ui ----------------------------------
  // Tabler's world icon, matching the toolbar's own icons.
  var WORLD = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tabler-icon tabler-icon-world"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"></path><path d="M3.6 9h16.8"></path><path d="M3.6 15h16.8"></path><path d="M11.5 3a17 17 0 0 0 0 18"></path><path d="M12.5 3a17 17 0 0 1 0 18"></path></svg>';

  // No id on the toolbar, so anchor on the Create button. Step out by parent, not closest('.inline-flex'): the button carries that class itself.
  function toolbar() {
    var create = document.querySelector('button[aria-label="Create playlist"]');
    var wrap = create && create.parentElement;
    var bar = wrap && wrap.parentElement;
    return bar && bar.classList.contains('flex') ? { bar: bar, before: wrap } : null;
  }

  function runCheck(btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    var label = btn.getAttribute('aria-label');
    btn.setAttribute('aria-label', 'Checking regions...');
    btn.style.opacity = '.5';
    checkAll(null).then(function (results) {
      var n = report(results);
      btn.setAttribute('aria-label', n ? n + ' track(s) playable only in ' + REGIONS.join('/') + ' - see console' : 'No region-locked tracks');
      markRows();
      if (!toastUnavailable(results)) toast('Every track is available', 'nothing region-locked or missing');
      // Locked but no pill placed means the row markup moved; say so rather than look clean.
      if (n && !document.querySelector('.wz-region-flag')) log('found ' + n + ' locked track(s) but could not tag any row - run WZRegion.debug()');
    }).catch(function (e) {
      log('failed: ' + e.message);
      btn.setAttribute('aria-label', 'Region check failed - see console');
    }).then(function () {
      btn.disabled = false;
      btn.style.opacity = '';
      setTimeout(function () { btn.setAttribute('aria-label', label); }, 8000);
    });
  }

  function addButton() {
    if (document.getElementById('wz-region-btn')) return;
    var spot = toolbar();
    if (!spot) return;
    var wrap = document.createElement('div');
    wrap.className = 'inline-flex';
    var btn = document.createElement('button');
    btn.id = 'wz-region-btn';
    btn.type = 'button';
    btn.className = 'theme-button-neutral inline-flex h-9 w-9 items-center justify-center rounded-md';
    btn.setAttribute('aria-label', 'Region check');
    btn.title = 'Flag tracks YouTube only allows in ' + REGIONS.join('/');
    btn.innerHTML = WORLD;
    btn.addEventListener('click', function () { runCheck(btn); });
    wrap.appendChild(btn);
    spot.bar.insertBefore(wrap, spot.before);
  }

  function pill(count, key) {
    var el = document.createElement('span');
    el.className = 'wz-region-flag inline-flex shrink-0 items-center gap-1 rounded-md border border-rose-300/24 bg-rose-400/12 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-rose-100 uppercase';
    el.dataset.wzTitle = key; // lets removal find this track's pill(s)
    var msg = 'YouTube only allows this track in ' + count + ' countr' + (count === 1 ? 'y' : 'ies') + ', all inside ' + REGIONS.join('/') + '.';
    el.title = msg;
    el.setAttribute('aria-label', msg);
    el.innerHTML = WORLD.replace('width="16" height="16"', 'width="11" height="11"') + REGIONS.join('/') + ' only';
    return el;
  }

  // After a DELETE, dim the row and swap its pill(s); wavez won't re-render until a reload.
  function markRemoved(title) {
    var key = norm(title);
    var pills = document.querySelectorAll('.wz-region-flag');
    for (var i = 0; i < pills.length; i++) {
      if (norm(pills[i].dataset.wzTitle) !== key) continue;
      var p = pills[i];
      p.className = 'wz-region-flag inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-300/24 bg-emerald-400/12 px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-emerald-100 uppercase';
      p.innerHTML = 'removed - reload';
      if (p.parentElement) { p.parentElement.style.opacity = '.5'; p.parentElement.style.textDecoration = 'line-through'; }
    }
  }

  // Normalise for matching: DOM titles carry NBSPs/doubled spaces the API title doesn't.
  function norm(s) {
    return (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function tag(el, n, key) {
    var host = el.parentElement;
    if (!host || host.querySelector('.wz-region-flag')) return false; // no parent, or already tagged
    host.appendChild(pill(n, key));
    return true;
  }

  // Match rows by title text across most elements; a full scan per re-render but only a few thousand nodes.
  function markRows() {
    var titles = Object.keys(lockedTitles);
    if (!titles.length) return;
    var nodes = document.querySelectorAll('span, p, div, a, h1, h2, h3, h4');
    var seen = {};
    var i, el, text;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.children.length > 1) continue; // a wrapper, not the title line (one child allowed for a search highlight)
      text = norm(el.textContent);
      if (lockedTitles[text] === undefined) continue;
      if (el.children.length === 1 && norm(el.children[0].textContent) === text) continue; // tag the inner title node instead
      seen[text] = true;
      tag(el, lockedTitles[text], text);
    }
    // Fallback: title run into a duration/badge in the same leaf. Short extra text only, so it can't latch onto a row wrapper.
    var missing = titles.filter(function (t) { return !seen[t]; });
    if (!missing.length) return;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.children.length) continue;
      text = norm(el.textContent);
      for (var j = 0; j < missing.length; j++) {
        if (text.length > missing[j].length && text.length < missing[j].length + 40 && text.indexOf(missing[j]) === 0) tag(el, lockedTitles[missing[j]], missing[j]);
      }
    }
  }

  // Render into the site's own toast stack if found (inherits its animation/placement), else a themed stack of our own. TOAST_HOST pins the selector if the guess is wrong.
  var TOAST_HOST = '';
  function toastHost() {
    var host = document.querySelector(TOAST_HOST || '[data-sonner-toaster], [data-radix-toast-viewport], .toaster, #toast-root');
    if (host) return { el: host, native: true };
    var own = document.getElementById('wz-region-toasts');
    if (!own) {
      own = document.createElement('div');
      own.id = 'wz-region-toasts';
      own.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:360px';
      document.body.appendChild(own);
    }
    return { el: own, native: false };
  }

  // action = { label, fn }: renders a button whose fn resolves truthy to dismiss. Action toasts linger and don't dismiss on a stray click, so the button is easy to hit.
  function toast(title, detail, action) {
    var host = toastHost();
    var el = document.createElement('div');
    el.className = 'wz-region-toast flex items-start gap-2 rounded-md border px-3 py-2 text-sm';
    if (!host.native) el.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:8px;border:1px solid var(--theme-field-border,rgba(255,255,255,.12));background:var(--theme-dropdown-bg,rgba(20,20,26,.96));color:var(--theme-text-primary,#e7e7ea);box-shadow:0 8px 20px rgba(0,0,0,.16);font:500 13px/1.35 system-ui,sans-serif';
    el.innerHTML = WORLD.replace('width="16" height="16"', 'width="14" height="14"') +
      '<span style="flex:1"><strong style="font-weight:600">' + esc(title) + '</strong>' + (detail ? '<br><span style="opacity:.7">' + esc(detail) + '</span>' : '') + '</span>';
    if (action) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'theme-button-neutral shrink-0 rounded-md px-2 py-1 text-xs font-semibold';
      btn.style.cssText = 'border:1px solid var(--theme-field-border,rgba(255,255,255,.18));background:var(--theme-dropdown-hover,rgba(255,255,255,.06));color:inherit;cursor:pointer';
      btn.textContent = action.label;
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = '...';
        Promise.resolve(action.fn()).then(function (ok) { if (ok !== false) el.remove(); else { btn.disabled = false; btn.textContent = action.label; } });
      });
      el.appendChild(btn);
    } else {
      el.addEventListener('click', function () { el.remove(); });
    }
    host.el.appendChild(el);
    setTimeout(function () { el.remove(); }, action ? 20000 : 8000);
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // One Remove toast per unavailable track, capped at 5 with a "Remove all" for the rest.
  function toastUnavailable(results) {
    var offenders = offendersOf(results);
    lastOffenders = offenders;
    offenders.slice(0, 5).forEach(function (o) {
      toast(o.track, o.why + ' - in ' + o.playlistName, { label: 'Remove', fn: function () { return removeOffender(o); } });
    });
    if (offenders.length > 5) {
      var rest = offenders.slice(5);
      toast(rest.length + ' more unavailable', 'full list in the console', { label: 'Remove all', fn: function () { return removeMany(rest); } });
    }
    return offenders.length;
  }

  // Sequential, to stay within rate limits; resolves to how many went.
  function removeMany(list) {
    return list.reduce(function (chain, o) {
      return chain.then(function (done) { return removeOffender(o).then(function (ok) { return done + (ok ? 1 : 0); }); });
    }, Promise.resolve(0)).then(function (done) { toast('Removed ' + done + ' of ' + list.length, 'reload to refresh the list'); return done; });
  }

  // Restore the last check's flags so pills come back on refresh. Ignored if REGIONS changed, since the pass/fail no longer holds.
  (function restoreFlags() {
    var f = readJSON(FLAGS_LS);
    if (f && f.regions === REGIONS.join(',') && f.titles) lockedTitles = f.titles;
  })();

  // React tears down and rebuilds the toolbar and rows, so a debounced observer re-adds the button and pills.
  var pending = null;
  new MutationObserver(function () {
    clearTimeout(pending);
    pending = setTimeout(function () { addButton(); markRows(); }, 200);
  }).observe(document.body, { childList: true, subtree: true });
  addButton();
  markRows();

  window.WZRegion = {
    // Check everything, or one playlist by name or id.
    check: function (only) { return checkAll(only).then(function (r) { var n = report(r); markRows(); toastUnavailable(r); return n; }); },
    // What the anchors currently resolve to, for when the markup shifts.
    debug: function () { console.log('toolbar:', toolbar()); console.log('toast host:', toastHost()); console.log('locked titles:', lockedTitles); },
    toast: function (a, b) { toast(a || 'Test toast', b || 'from wavez-region-check'); },
    // Log every leaf element containing the string, with its parent markup. For when a pill won't land.
    find: function (text) {
      var want = norm(text);
      var hits = [];
      var all = document.body.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        if (norm(all[i].textContent).indexOf(want) === -1) continue;
        if (all[i].querySelector('#wz-region-toasts, #wz-region-btn')) continue; // skip our own furniture
        if (!all[i].children.length) hits.push(all[i]);
      }
      hits.forEach(function (el) { console.log(el, '\nparent markup:\n' + (el.parentElement ? el.parentElement.outerHTML.slice(0, 700) : '(none)')); });
      if (!hits.length) log('nothing on screen contains "' + text + '"');
      return hits;
    },
    playlists: function () { return apiGet('/playlists').then(function (p) { console.table(p.map(function (x) { return { id: x.id, name: x.name, active: !!x.isActive }; })); return p; }); },
    setKey: function (k) { localStorage.setItem(KEY_LS, k); return 'saved'; },
    // Forget the persisted pills; they return on the next check.
    clearFlags: function () { localStorage.removeItem(FLAGS_LS); lockedTitles = {}; return 'cleared'; },
    // The last check's offenders, to eyeball what remove() would touch.
    unavailable: function () { console.table(lastOffenders.map(function (o) { return { playlist: o.playlistName, track: o.track, why: o.why }; })); return lastOffenders; },
    // Delete the last check's offenders. Narrow with 'gone', 'locked', or a title substring. Confirms first.
    remove: function (filter) {
      if (!lastOffenders.length) { log('run a check first (nothing to remove)'); return Promise.resolve(0); }
      var want = lastOffenders.filter(function (o) {
        if (!filter) return true;
        if (filter === 'gone') return o.why.indexOf('deleted') === 0;
        if (filter === 'locked') return o.why.indexOf('only playable') === 0;
        return norm(o.track).indexOf(norm(filter)) !== -1;
      });
      if (!want.length) { log('no offenders match ' + JSON.stringify(filter)); return Promise.resolve(0); }
      if (!window.confirm('Remove ' + want.length + ' track(s) from your playlists? This cannot be undone.')) return Promise.resolve(0);
      return removeMany(want);
    },
    regions: REGIONS
  };
  log('loaded - hit the globe in the playlist toolbar or run WZRegion.check()');

  if (location.hash === '#wz-region-test') {
    console.assert(limitedTo(['US', 'CA'], REGIONS) === true, 'US+CA only, flag it');
    console.assert(limitedTo(['US'], REGIONS) === true, 'US only, flag it');
    console.assert(limitedTo(['US', 'CA', 'GB'], REGIONS) === false, 'GB can play it, leave it');
    console.assert(limitedTo(['JP'], REGIONS) === false, 'JP only is not a US/CA lock');
    console.assert(limitedTo(null, REGIONS) === false, 'no restriction at all');
    console.assert(limitedTo([], REGIONS) === false, 'empty allowed list is not a lock');
    console.log('[wz-region] self-check passed');
  }
})();
