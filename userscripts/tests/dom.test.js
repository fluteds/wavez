// jsdom fixture tests. load each userscript into a fake wavez.fm DOM and check the selectors still hit.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SCRIPTS = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(SCRIPTS, name), 'utf8');

// run a userscript in a jsdom window. outside-only gives window.eval so its bare globals resolve.
function load(file, { html = '<!DOCTYPE html><body></body>', hash = '', before, throwOnAssert = false } = {}) {
  const dom = new JSDOM(html, { url: 'https://wavez.fm/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // mute the load logs. console.assert throws when we ask, so a self-check failure still surfaces.
  w.console = Object.assign(Object.create(w.console), {
    log() {}, warn() {}, error() {}, table() {}, info() {},
    assert(cond, ...m) { if (throwOnAssert && !cond) throw new assert.AssertionError({ message: 'self-check: ' + m.join(' ') }); }
  });
  if (before) before(w);
  w.eval(read(file));
  return dom;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

// run each script's #...-test assert block too (vote/grab/region/title logic)
for (const [file, hash] of [
  ['wavez-region-check.user.js', '#wz-region-test'],
  ['wavez-auto-woot.user.js', '#wz-woot-test'],
  ['wavez-auto-grab.user.js', '#wz-grab-test'],
  ['wavez-open-in-spotify.user.js', '#wz-spotify-test']
]) {
  test(`self-check: ${file}`, () => {
    const dom = load(file, { hash, throwOnAssert: true });
    dom.window.close();
  });
}

// region check: toolbar anchor
test('region-check adds its button next to the Create playlist button', () => {
  const dom = load('wavez-region-check.user.js', {
    html: '<!DOCTYPE html><body><div class="flex"><div><button aria-label="Create playlist"></button></div></div></body>'
  });
  assert.ok(dom.window.document.getElementById('wz-region-btn'), 'no globe button, toolbar() anchor stale');
  dom.window.close();
});

// region check: row tagging from saved flags
test('region-check pills a playlist row whose title matches a saved flag', () => {
  const dom = load('wavez-region-check.user.js', {
    html: '<!DOCTYPE html><body><div id="row"><span>Some Locked Track</span></div></body>',
    before(w) {
      w.localStorage.setItem('wavez-region-flags-v1', JSON.stringify({ regions: 'US,CA', titles: { 'some locked track': 1 } }));
    }
  });
  const pill = dom.window.document.querySelector('#row .wz-region-flag');
  assert.ok(pill, 'no pill, markRows title matching broke');
  assert.match(pill.textContent, /US\/CA only/);
  dom.window.close();
});

// region check: survives client-side nav. the toolbar only shows once react mounts the playlist view.
test('region-check re-adds its button after client-side navigation', async () => {
  const dom = load('wavez-region-check.user.js'); // empty body, no toolbar yet
  assert.equal(dom.window.document.getElementById('wz-region-btn'), null, 'button should not exist before the toolbar renders');
  dom.window.document.body.innerHTML = '<div class="flex"><div><button aria-label="Create playlist"></button></div></div>';
  await tick(300); // observer debounced 200ms
  assert.ok(dom.window.document.getElementById('wz-region-btn'), 'button not re-added after nav, observer/anchor stale');
  dom.window.close();
});

// imgur: rewrite to the rimgo mirror
test('imgur rewrites an imgur src to the rimgo mirror', () => {
  const dom = load('wavez-imgur.user.js', {
    html: '<!DOCTYPE html><body><img id="pic" src="https://i.imgur.com/abc.png"></body>'
  });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  assert.equal(dom.window.document.getElementById('pic').getAttribute('src'), 'https://rimgo.vern.cc/abc.png');
  dom.window.close();
});

// translate: message selector + append render
test('translate renders a translation for a chat message', async () => {
  const dom = load('wavez-translate.user.js', {
    html: '<!DOCTYPE html><body><div id="chat"><div class="wavezfm-chat-text-size-md">Hola mundo</div></div></body>',
    before(w) {
      // fake google translate, resolves sync
      w.GM_xmlhttpRequest = ({ onload }) => onload({ responseText: JSON.stringify([['Hello world', 'es']]) });
    }
  });
  await tick(50);
  const t = dom.window.document.querySelector('.wz-translation');
  assert.ok(t, 'no translation node, MSG_SELECTOR missed the message');
  assert.equal(t.textContent, 'Hello world');
  dom.window.close();
});

// spotify: current-track anchor
test('spotify adds its button next to the now-playing YouTube link', async () => {
  const dom = load('wavez-open-in-spotify.user.js', {
    html: '<!DOCTYPE html><body><div class="flex"><div><span id="wavezfm-current-track-title-desktop">A Song</span></div><a aria-label="Open on YouTube" href="#"></a></div></body>'
  });
  await tick(700); // addButton runs on a 500ms interval
  assert.ok(dom.window.document.getElementById('wavez-open-spotify-btn'), 'spotify button not injected, title/YouTube anchor stale');
  dom.window.close();
});

// sidebar: chat rail anchor
test('sidebar adds its toggle once the chat rail exists', async () => {
  const dom = load('wavez-sidebar.user.js', {
    html: '<!DOCTYPE html><body><div data-room-desktop-rail="true">chat</div></body>'
  });
  await tick(700); // init polls every 500ms
  assert.ok(dom.window.document.getElementById('wavez-chat-rail-toggle'), 'chat toggle not injected, rail selector stale');
  dom.window.close();
});

// auto-woot: votes a new track via the bridge
test('auto-woot woots a votable new track through the WavezFM bridge', async () => {
  const voted = [];
  const dom = load('wavez-auto-woot.user.js', {
    before(w) {
      w.localStorage.setItem('wavez-autowoot', 'on');
      w.WavezFM = {
        version: '1',
        room: { subscribe() {}, getState: () => ({ playback: { playbackKey: 'k1' }, votes: { canVote: true, clientVote: null } }) },
        actions: { vote: (v) => { voted.push(v); return { ok: true }; } }
      };
    }
  });
  await tick(700); // bridge-wait polls every 500ms
  assert.deepEqual(voted, ['woot']);
  dom.window.close();
});
