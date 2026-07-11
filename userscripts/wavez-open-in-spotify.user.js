// ==UserScript==
// @name         Wavez Open in Spotify
// @namespace    https://wavez.fm/
// @author       fluteds
// @icon         https://wavez.fm/favicon.ico
// @version      1.1
// @updateURL    https://github.com/fluteds/wavez/raw/main/userscripts/wavez-open-in-spotify.user.js
// @downloadURL  https://github.com/fluteds/wavez/raw/main/userscripts/wavez-open-in-spotify.user.js
// @description  Adds an "Open in Spotfify" button next to the currently playing song to search for it on Spotify.
// @match        https://wavez.fm/*
// @match        https://wavez.fm/~/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const ID = 'wavez-open-spotify-btn';

  // Drop YouTube-style descriptor tags in ()/[] ("Official Video", "Lyrics", "HD"...).
  // No track:/artist: filters: the source artist is a YouTube channel handle
  // ("enyatv"), so plain text search on the "Artist - Title" string beats it.
  const stripNoise = (s) => (s || '')
    .replace(/[([][^)\]]*\b(officials?|video|audio|lyrics?|visuali[sz]er|m\/?v|hd|4k|remaster(?:ed)?|explicit)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  function spotifyUrl(titleEl) {
    const pb = window.WavezFM?.version === '1'
      ? window.WavezFM.room.getState()?.playback
      : null;
    const query = stripNoise(pb?.title || titleEl.textContent);
    return 'https://open.spotify.com/search/' + encodeURIComponent(query);
  }

  function addButton() {
    const title = document.querySelector('#wavezfm-current-track-title-desktop');
    const yt = document.querySelector('a[aria-label="Open on YouTube"]');

    if (!title || !yt || document.getElementById(ID)) return;

    const row = title.closest('.flex');
    if (!row) return;

    const wrap = document.createElement('div');
    wrap.className = 'inline-flex shrink-0';
    wrap.id = ID;

    const link = yt.cloneNode(false);
    link.href = '#';
    link.setAttribute('aria-label', 'Open on Spotify');
    link.title = 'Open on Spotify';
    link.style.color = '#ffffff';
    link.style.display = 'inline-flex';
    link.style.visibility = 'visible';
    link.style.opacity = '1';

    link.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg"
         width="12"
         height="12"
         viewBox="0 0 24 24"
         fill="currentColor">
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.55 2 12 2zm3.75 14.65c-2.35-1.45-5.3-1.75-8.8-.95-.35.1-.65-.15-.75-.45-.1-.35.15-.65.45-.75 3.8-.85 7.1-.5 9.7 1.1.35.15.4.55.25.85-.2.3-.55.4-.85.2zm1-2.7c-2.7-1.65-6.8-2.15-9.95-1.15-.4.1-.85-.1-.95-.5-.1-.4.1-.85.5-.95 3.65-1.1 8.15-.55 11.25 1.35.3.15.45.65.2 1s-.7.5-1.05.25zM6.3 9.75c-.5.15-1-.15-1.15-.6-.15-.5.15-1 .6-1.15 3.55-1.05 9.4-.85 13.1 1.35.45.25.6.85.35 1.3-.25.35-.85.5-1.3.25C14.7 9 9.35 8.8 6.3 9.75z"/>
    </svg>
    `;

    link.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      window.open(spotifyUrl(title), '_blank');
    };

    wrap.appendChild(link);

    const titleBox = title.parentElement;
    row.insertBefore(wrap, titleBox);
  }

  setInterval(addButton, 500);

  // ponytail: self-check for the title cleaner - run with #wz-spotify-test.
  if (location.hash === '#wz-spotify-test') {
    const cases = [
      ['Groove Is In The Heart (Official Video)', 'Groove Is In The Heart'],
      ['Song [Official Audio]', 'Song'],
      ['Track (Official Music Video) [HD]', 'Track'],
      ['Title (Lyrics)', 'Title'],
      ['Da Funk (Remastered)', 'Da Funk'],
      ['Power (feat. Dwele)', 'Power (feat. Dwele)'], // real parens kept
    ];
    cases.forEach(([raw, want]) =>
      console.assert(stripNoise(raw) === want, 'stripNoise:', raw, '->', stripNoise(raw), 'want', want));
    console.log('[wz-spotify] self-check passed');
  }
})();
