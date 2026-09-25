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
    html: '<!DOCTYPE html><body><div class="flex"><div><button aria-label="Create playlist"></button></div></div></body>'
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
  dom.window.document.body.innerHTML = '<div class="flex"><div><button aria-label="Create playlist"></button></div></div>';
  await tick(300);
  assert.ok(dom.window.document.getElementById('wz-region-btn'), 'button not re-added after nav, observer/anchor stale');
});

const MIRROR = read('wavez-imgur.user.js').match(/ALTSITE\s*=\s*'([^']+)'/)?.[1];
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
