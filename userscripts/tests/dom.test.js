const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPTS = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8');

function load(t, file, { html = '<!DOCTYPE html><body></body>', hash = '', before, throwOnAssert = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://wavez.fm/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.console = Object.assign(Object.create(w.console), {
    log() {}, warn() {}, error() {}, table() {}, info() {},
    assert(cond, ...m) { if (throwOnAssert && !cond) throw new assert.AssertionError({ message: 'self-check: ' + m.join(' ') }); }
  });
  if (before) before(w);
  w.eval(read(file));
  return dom;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [file, hash] of [
  ['wavez-region-check.user.js', '#wz-region-test'],
  ['wavez-auto-woot.user.js', '#wz-woot-test'],
  ['wavez-auto-grab.user.js', '#wz-grab-test'],
  ['wavez-open-in-spotify.user.js', '#wz-spotify-test']
]) {
  test(`self-check: ${file}`, (t) => {
    load(t, file, { hash, throwOnAssert: true });
  });
}

test('region-check adds its button next to the Create playlist button', (t) => {
  const dom = load(t, 'wavez-region-check.user.js', {
    html: '<!DOCTYPE html><body><div class="flex"><div><button aria-label="Create Playlist"></button></div></div></body>'
  });
  assert.ok(dom.window.document.getElementById('wz-region-btn'), 'no globe button, toolbar() anchor stale');
});

test('region-check pills a playlist row whose title matches a saved flag', (t) => {
  const dom = load(t, 'wavez-region-check.user.js', {
    html: '<!DOCTYPE html><body><div id="row"><span>Some Locked Track</span></div></body>',
    before(w) {
      w.localStorage.setItem('wavez-region-flags-v1', JSON.stringify({ regions: 'US,CA', titles: { 'some locked track': 1 } }));
    }
  });
  const pill = dom.window.document.querySelector('#row .wz-region-flag');
  assert.ok(pill, 'no pill, markRows title matching broke');
  assert.match(pill.textContent, /US\/CA only/);
});

test('region-check re-adds its button after client-side navigation', async (t) => {
  const dom = load(t, 'wavez-region-check.user.js');
  assert.equal(dom.window.document.getElementById('wz-region-btn'), null, 'button should not exist before the toolbar renders');
  dom.window.document.body.innerHTML = '<div class="flex"><div><button aria-label="Create Playlist"></button></div></div>';
  await tick(300);
  assert.ok(dom.window.document.getElementById('wz-region-btn'), 'button not re-added after nav, observer/anchor stale');
});

test('scrobble sits after the last footer action in the visible footer row', (t) => {
  const row = (id) => `<div id="${id}" class="flex"><div class="inline-flex"><button data-wavezfm-room-footer-action="donation-goal"></button></div><div class="inline-flex"><button data-wavezfm-room-footer-action="whispers"></button></div></div>`;
  const dom = load(t, 'wavez-scrobble.user.js', {
    html: `<!DOCTYPE html><body><div hidden>${row('mobile')}</div>${row('desktop')}</body>`,
    before(w) {
      w.fetch = () => Promise.reject(new Error('offline'));
      Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { get() { return this.closest('[hidden]') ? null : this.parentElement; } });
    }
  });
  const btn = dom.window.document.getElementById('wz-scrobble-btn');
  assert.ok(btn, 'no scrobble button, footer anchor stale');
  assert.equal(btn.closest('.flex').id, 'desktop', 'landed in the hidden mobile footer');
  assert.equal(btn.parentElement.previousElementSibling.firstChild.dataset.wavezfmRoomFooterAction, 'whispers', 'not after the last footer action');
});

const MIRROR = read('wavez-imgur.user.js').match(/ALTSITE[^']*'([^']+)'/)?.[1];
test('imgur rewrites an imgur src to the rimgo mirror', (t) => {
  assert.ok(MIRROR, 'ALTSITE is gone from wavez-imgur.user.js, so this test cannot know the mirror');
  const dom = load(t, 'wavez-imgur.user.js', {
    html: '<!DOCTYPE html><body><img id="pic" src="https://i.imgur.com/abc.png"></body>'
  });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const src = dom.window.document.getElementById('pic').getAttribute('src');
  assert.equal(src, `${MIRROR}/abc.png`);
  assert.doesNotMatch(src, /imgur\.com/, 'the imgur host has to be gone, not just prefixed');
});

test('translate renders a translation for a chat message', async (t) => {
  const dom = load(t, 'wavez-translate.user.js', {
    html: '<!DOCTYPE html><body><div id="chat"><div class="wavezfm-chat-text-size-md">Hola mundo</div></div></body>',
    before(w) {
      w.GM_xmlhttpRequest = ({ onload }) => onload({ responseText: JSON.stringify([['Hello world', 'es']]) });
    }
  });
  await tick(50);
  const node = dom.window.document.querySelector('.wz-translation');
  assert.ok(node, 'no translation node, MSG_SELECTOR missed the message');
  assert.equal(node.textContent, 'Hello world');
});

test('spotify adds its button next to the now-playing YouTube link', async (t) => {
  const dom = load(t, 'wavez-open-in-spotify.user.js', {
    html: '<!DOCTYPE html><body><div class="flex"><div><span id="wavezfm-current-track-title-desktop">A Song</span></div><a aria-label="Open on YouTube" href="#"></a></div></body>'
  });
  await tick(700);
  assert.ok(dom.window.document.getElementById('wavez-open-spotify-btn'), 'spotify button not injected, title/YouTube anchor stale');
});

test('sidebar adds its toggle once the chat rail exists', async (t) => {
  const dom = load(t, 'wavez-sidebar.user.js', {
    html: '<!DOCTYPE html><body><div data-room-desktop-rail="true">chat</div></body>'
  });
  await tick(700);
  assert.ok(dom.window.document.getElementById('wavez-chat-rail-toggle'), 'chat toggle not injected, rail selector stale');
});

test('auto-woot woots a votable new track through the WavezFM bridge', async (t) => {
  const voted = [];
  const dom = load(t, 'wavez-auto-woot.user.js', {
    before(w) {
      w.localStorage.setItem('wavez-autowoot', 'on');
      w.WavezFM = {
        version: '1',
        room: { subscribe() {}, getState: () => ({ playback: { playbackKey: 'k1' }, votes: { canVote: true, clientVote: null } }) },
        actions: { vote: (v) => { voted.push(v); return { ok: true }; } }
      };
    }
  });
  await tick(700);
  assert.deepEqual(voted, ['woot']);
});

test('panel auto leave quits the queue after N of your own plays and turns auto join off', async (t) => {
  const left = [];
  const subs = {};
  const s = { currentUser: { id: 'me', username: 'fluted' }, room: { slug: 'r' }, users: [], permissions: { joinQueue: true }, votes: {}, playback: null, queue: { isJoined: true, isCurrentDj: false, entries: [] } };
  const play = (key, dj) => { s.playback = { playbackKey: key, trackId: key, djUsername: dj }; s.queue.isCurrentDj = dj === 'fluted'; (subs.playback_changed || []).forEach((f) => f()); };
  const w = load(t, 'wavez-all.user.js', {
    before(w) {
      w.localStorage.setItem('wavez-tools', JSON.stringify({ autoleave: true, leaveAfter: 2, autojoin: true, sound: 'none' }));
      w.WavezFM = { version: '1', room: { subscribe: (e, f) => { (subs[e] = subs[e] || []).push(f); }, getState: () => s }, actions: { leaveQueue: () => { left.push(1); s.queue.isJoined = false; return { ok: true }; }, joinQueue: () => ({ ok: false }), vote: () => ({ ok: true }) } };
    }
  }).window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await tick(700);
  const h = w.WavezTools.helpers;
  assert.equal(h.shouldLeave(2, 2, { isJoined: true, isCurrentDj: true }), false, 'never mid-play');
  assert.equal(h.shouldLeave(2, 2, { isJoined: false }), false, 'not queued, nothing to leave');
  play('a', 'fluted');
  play('b', 'kai');
  assert.equal(left.length, 0, 'one play is not two');
  play('c', 'fluted');
  assert.equal(left.length, 0, 'still on the decks for play two');
  play('d', 'nova');
  assert.equal(left.length, 1, 'left once play two finished');
  assert.equal(w.WavezTools.cfg.autojoin, false, 'auto join switched off so it does not rejoin');
});

test('panel alert gates: mentions, replays, booth, joins, escaping, vote delay', (t) => {
  const w = load(t, 'wavez-all.user.js').window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const h = w.WavezTools.helpers;
  assert.equal(h.mentionHit('hey @fluted look', [], 'fluted'), 'fluted', 'name with @');
  assert.equal(h.mentionHit('fluted!', [], 'fluted'), 'fluted', 'bare name');
  assert.equal(h.mentionHit('flutedsomething', [], 'fluted'), null, 'no partial name match');
  assert.equal(h.mentionHit('any Techno here', ['techno'], 'fluted'), 'techno', 'keyword, case-insensitive');
  assert.equal(h.mentionHit('quiet room', ['techno'], 'fluted'), null, 'no hit');
  assert.equal(h.mentionHit('party time', ['art'], 'fluted'), 'art', 'keyword anywhere');
  assert.equal(h.mentionHit('party time', ['art'], 'fluted', true), null, 'whole word skips partial');
  assert.equal(h.mentionHit('nice art!', ['art'], 'fluted', true), 'art', 'whole word hit');
  assert.equal(h.playedAgo(['a', 'b', 'c'], 'c'), 1, 'the track just before');
  assert.equal(h.playedAgo(['a', 'b', 'c'], 'a'), 3, 'three back');
  assert.equal(h.playedAgo(['a', 'b'], 'z'), -1, 'never played');
  assert.equal(h.boothHit(3, 3, null), true, 'first time at threshold');
  assert.equal(h.boothHit(3, 3, 3), false, 'same position, no repeat alert');
  assert.equal(h.boothHit(2, 3, 3), false, 'moved closer inside threshold, no repeat');
  assert.equal(h.boothHit(3, 3, 4), true, 'crossed into threshold');
  assert.equal(h.boothHit(5, 3, null), false, 'still too far back');
  assert.equal(h.joinable({ isFollowing: true }, 'following'), true, 'following mode');
  assert.equal(h.joinable({ isFollowing: false }, 'following'), false, 'not followed');
  assert.equal(h.joinable({}, 'everyone'), true, 'everyone mode');
  assert.equal(h.html('<img src=x onerror="a">'), '&#60;img src=x onerror=&#34;a&#34;&#62;', 'html escaped');
  assert.equal(h.delayFor('instant'), 0, 'instant is instant');
  const d = h.delayFor('1-10');
  assert.ok(d >= 1000 && d <= 10000, 'random delay in range');
});

test('bundle lists every addon in the panel and a row flips its switch', async (t) => {
  const dom = load(t, 'wavez-all.user.js');
  const w = dom.window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const rows = [...w.document.querySelectorAll('#wt [data-addon]')];
  const scripts = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith('.user.js') && !['wavez-all.user.js', 'wavez-auto-woot.user.js'].includes(f));
  assert.equal(rows.length, scripts.length + 1, 'one panel row per addon script (auto woot is the panel\'s own switch), plus the panel itself');
  assert.equal(rows.filter((r) => /Auto Woot/.test(r.textContent)).length, 0, 'no second auto woot switch');
  const imgur = rows.find((r) => /Imgur/.test(r.textContent));
  assert.ok(imgur, 'imgur row missing');
  let reloaded = false;
  w.addEventListener('beforeunload', () => { reloaded = true; });
  imgur.click();
  assert.equal(w.localStorage.getItem('wavez-tools:imgur'), 'on', 'clicking an off addon should save it as on');
  assert.equal(imgur.getAttribute('aria-checked'), 'true', 'switch flips in place');
  assert.match(w.document.querySelector('#wt .wt-notice').textContent, /reload to apply/, 'reminder shown');
  assert.equal(reloaded, false, 'no reload');
});

test('bundle panel groups addons by category and opens settings from a cog', (t) => {
  const w = load(t, 'wavez-all.user.js').window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const heads = [...w.document.querySelectorAll('#wt [data-addons] .wt-sec')].map((e) => e.textContent);
  assert.deepEqual(heads, ['Automation', 'Chat', 'Music', 'Moderation', 'Panel']);
  assert.equal(w.document.querySelector('#wt [data-group="addonset"]'), null, 'no separate addon settings section');
  const row = [...w.document.querySelectorAll('#wt .wt-arow')].find((r) => /Translate/.test(r.textContent));
  const cog = row.querySelector('.wt-cog');
  const box = w.document.querySelector('#wt [data-aset-for="' + cog.dataset.cog + '"]');
  assert.equal(box.hidden, true, 'settings start closed');
  cog.click();
  assert.equal(box.hidden, false, 'cog opens them');
  assert.equal(cog.getAttribute('aria-expanded'), 'true');
  assert.ok(box.querySelector('[data-aset$=":TARGET_LANG"]'), 'translate settings inside its own box');
  const plain = [...w.document.querySelectorAll('#wt .wt-arow')].find((r) => /Chat Pop-out/.test(r.textContent));
  assert.equal(plain.querySelector('button.wt-cog'), null, 'no cog when there is nothing to set');
});

test('bundle panel saves addon settings typed by their defaults', (t) => {
  const w = load(t, 'wavez-all.user.js').window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(w.document.querySelectorAll('#wt [data-aset]').length, 18, 'one control per addon setting');
  const set = (name, value) => {
    const el = [...w.document.querySelectorAll('#wt [data-aset]')].find((e) => e.dataset.aset.endsWith(':' + name));
    el.value = value;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
  set('IDLE_MINUTES', '12');
  set('REGIONS', 'GB, ie');
  set('PLAYLIST', 'Mix');
  assert.equal(w.localStorage.getItem('wavez-tools:auto-idle:IDLE_MINUTES'), '12');
  assert.equal(w.localStorage.getItem('wavez-tools:region-check:REGIONS'), '["GB","ie"]');
  assert.equal(w.localStorage.getItem('wavez-tools:auto-grab:PLAYLIST'), '"Mix"');
  [...w.document.querySelectorAll('#wt button[data-aset]')].find((e) => e.dataset.aset.endsWith(':COLOR_NAME')).click();
  assert.equal(w.localStorage.getItem('wavez-tools:new-users:COLOR_NAME'), 'true');
});

test('bundle addons read a saved setting over their default', (t) => {
  const dom = load(t, 'wavez-all.user.js', {
    html: '<!DOCTYPE html><body><img id="pic" src="https://i.imgur.com/abc.png"></body>',
    before(w) { w.localStorage.setItem('wavez-tools:imgur', 'on'); w.localStorage.setItem('wavez-tools:imgur:ALTSITE', JSON.stringify('https://rimgo.example')); }
  });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.equal(dom.window.document.getElementById('pic').getAttribute('src'), 'https://rimgo.example/abc.png');
});

test('bundle with the panel switched off still runs addons and keeps the menu fallback', (t) => {
  const menu = [];
  const w = load(t, 'wavez-all.user.js', { before(w) { w.localStorage.setItem('wavez-tools:panel', 'off'); w.localStorage.setItem('wavez-tools:imgur', 'on'); w.GM_registerMenuCommand = (label) => menu.push(label); } }).window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  assert.equal(w.document.getElementById('wt'), null, 'panel is off, so no panel');
  assert.ok(menu.includes('\u2715 Show Panel UI'), 'menu can switch the panel back on');
  assert.ok(menu.includes('\u2713 Imgur Fix'), 'addons stay in the menu');
  assert.ok(menu.includes('\u2713 Auto Woot'), 'auto woot has a menu entry');
});

test('bundle with the panel switched off still auto woots, and the menu entry switches it', async (t) => {
  const menu = {};
  const w = load(t, 'wavez-all.user.js', { before(w) { w.localStorage.setItem('wavez-tools:panel', 'off'); w.localStorage.setItem('wavez-tools', JSON.stringify({ voteDelay: 'instant' })); w.GM_registerMenuCommand = (label, fn) => { menu[label] = fn; }; } }).window;
  const votes = [];
  w.WavezFM = { version: '1', room: { getState: () => ({ playback: { playbackKey: 'k1', trackId: 't1' }, votes: { trackId: 't1', canVote: true, clientVote: null }, queue: { isCurrentDj: false, isJoined: false }, currentUser: { id: 'me' }, users: [] }), subscribe: () => {} }, actions: { vote: (v) => { votes.push(v); return { ok: true }; } } };
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(votes, ['woot'], 'wooted with no panel on screen');
  assert.equal(w.document.getElementById('wt'), null);
  try { menu['\u2713 Auto Woot'](); } catch (e) {}
  assert.equal(JSON.parse(w.localStorage.getItem('wavez-tools')).autowoot, false, 'menu entry switches auto woot off');
});

test('bundle starts with every addon off apart from the panel', (t) => {
  const w = load(t, 'wavez-all.user.js').window;
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const on = [...w.document.querySelectorAll('#wt [data-addon][aria-checked="true"]')].map((r) => r.textContent.trim());
  assert.deepEqual(on, ['Show Panel UI']);
});
