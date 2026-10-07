#!/usr/bin/env sh
set -e
cd "$(dirname "$0")"
src=../userscripts/wavez
raw=https://raw.githubusercontent.com/fluteds/wavez/main/userscripts
author=fluteds

bundle=userscripts/wavez-all.user.js

features="wavez-translate:translate:off:Chat
wavez-open-in-spotify:spotify:off:Music
wavez-sidebar:chat-toggle:off:Chat
wavez-chat-popout:chat-popout:off:Chat
wavez-imgur:imgur:off:Chat
wavez-scrobble:scrobble:off:Music
wavez-auto-grab:auto-grab:off:Automation
wavez-region-check:region-check:off:Music
wavez-auto-idle:auto-idle:off:Automation
wavez-new-users:new-users:off:Moderation
wavez-sos-alert:sos-alert:off:Moderation
wavez-panel:panel:on:Panel"

for f in userscripts/*.user.js; do f=$(basename "$f" .user.js); [ "$f" = wavez-all ] || [ "$f" = wavez-auto-woot ] || echo "$features" | grep -q "^$f:" || { echo "$f is not in features, so the panel cannot toggle it" >&2; exit 1; }; done

settings="wavez-translate:TARGET_LANG:Language
wavez-translate:DISPLAY_MODE:How it shows:append,replace,hover
wavez-translate:ONLY_NON_TARGET:Skip my language
wavez-translate:MAX_INFLIGHT:Request limit
wavez-imgur:ALTSITE:Proxy:https://imgur.artemislena.eu,https://rimgo.4o1x5.dev,https://rimgo.manerakai.com,https://ri.nadeko.net,https://rimgo.ducks.party
wavez-auto-grab:PLAYLIST:Playlist
wavez-region-check:YT_API_KEY:API key
wavez-region-check:REGIONS:Regions
wavez-auto-idle:IDLE_MINUTES:Idle minutes
wavez-new-users:NEW_DAYS:Days flagged
wavez-new-users:BADGE:Pill text
wavez-new-users:COLOR_NAME:Colour the name
wavez-new-users:COLOR:Colour
wavez-sos-alert:SOS_ACTION:Button watched
wavez-sos-alert:COOLDOWN_SECONDS:Quiet seconds
wavez-sos-alert:VOLUME:Volume
wavez-sos-alert:SOUND_URL:Sound URL"

strip() { perl -ne 'if (!$b) { $b = 1 if m{==/UserScript==}; print; next } next if m{^\s*//}; s{([;{}),\]]) +//(?: .*)?$}{$1}; s{[ \t]+$}{}; print'; }

specs() {
  echo "$settings" | grep "^$1:" | while IFS=: read -r f name slabel opts; do
    dv=$(perl -ne "print \$2 if /^\\s*(var|const) $name = (.*);\\s*\$/" "$src/$1.user.js")
    [ -n "$dv" ] || { echo "setting $name not found in $src/$1.user.js" >&2; exit 1; }
    printf '["%s", "%s", %s, "%s"], ' "$name" "$slabel" "$dv" "$opts"
  done
}

names() { echo "$settings" | grep "^$1:" | cut -d: -f2 | tr '\n' ' '; }

label() { grep -m1 '^// @name' "$src/$1.user.js" | sed 's|^// @name *Wavez *||'; }

swap() { ID=$1 NAMES=$(names "$2") perl -pe 'BEGIN { @n = split " ", $ENV{NAMES} } for my $n (@n) { s/^(\s*(?:var|const) \Q$n\E = )(.*);\s*$/${1}setting("$ENV{ID}", "$n", $2);/ }'; }

wrap() {
  awk '{ print } /==\/UserScript==/ { exit }'
  echo
  echo '(function () {'
  echo "  var KEY = 'wavez-tools:';"
  echo "  var SPEC = { id: '$1', label: '$(label "$2")', cat: '$(echo "$features" | grep "^$2:" | cut -d: -f4)', settings: [$(s=$(specs "$2"); echo "${s%, }")] };"
  echo '  function setting(id, name, dflt) { try { var v = localStorage.getItem(KEY + id + ":" + name); return v === null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }'
  echo "  function announce() { document.dispatchEvent(new CustomEvent('wavez-tools:addon', { detail: JSON.stringify(SPEC) })); }"
  echo "  document.addEventListener('wavez-tools:ping', announce);"
  echo '  announce();'
  echo "  if (localStorage.getItem(KEY + SPEC.id) === 'off') return;"
  awk '/==\/UserScript==/ { body = 1; next } body' "$3" | swap "$1" "$2" | sed 's|^\(.\)|  \1|'
  echo '})();'
}

bump() { echo "$1" | awk -F. '{ $NF = $NF + 1; print }' OFS=.; }

n=0
for dest in userscripts/*.user.js; do
  name=$(basename "$dest")
  [ "$dest" = "$bundle" ] && continue
  if [ ! -f "$src/$name" ]; then
    echo "  keep (no source): $name"
    continue
  fi

  awk -v url="$raw/$name" -v author="$author" '
    /^\/\/ @(author|updateURL|downloadURL)/ { next }
    { print }
    /^\/\/ @namespace/ { printf "// @author       %s\n", author }
    /^\/\/ @version/ {
      printf "// @updateURL    %s\n", url
      printf "// @downloadURL  %s\n", url
    }
  ' "$src/$name" | strip > "$dest.tmp"
  file=${name%.user.js}
  id=$(echo "$features" | grep "^$file:" | grep -v '^wavez-panel:' | cut -d: -f2)
  if [ -n "$id" ]; then
    wrap "$id" "$file" "$dest.tmp" < "$dest.tmp" > "$dest.wrap"
    mv "$dest.wrap" "$dest.tmp"
  fi

  sv=$(grep -m1 '^// @version' "$src/$name" | awk '{print $3}')
  dv=$(grep -m1 '^// @version' "$dest" 2>/dev/null | awk '{print $3}')

  if [ "$sv" != "$dv" ] && [ "$(printf '%s\n%s\n' "$sv" "$dv" | sort -V | tail -1)" = "$sv" ]; then
    nv=$sv
  elif [ -f "$dest" ] && diff -q -I '^// @version' "$dest.tmp" "$dest" >/dev/null; then
    rm "$dest.tmp"
    continue
  else
    nv=$(bump "${dv:-$sv}")
  fi
  sed "s|^// @version .*|// @version      $nv|" "$dest.tmp" > "$dest"
  rm "$dest.tmp"
  echo "  $name ${dv:-new} -> $nv"
  n=$((n + 1))
done
echo "synced $n changed script(s) from $src"

sources=$(ls userscripts/*.user.js | grep -vF "$bundle")
grants=$(grep -h '^// @grant' $sources | grep -v 'grant *none' | awk '{print $3}' | sort -u | grep -v '^GM_registerMenuCommand$')
connects=$(grep -h '^// @connect' $sources | awk '{print $3}' | sort -u)

{
  echo '// ==UserScript=='
  echo '// @name         Wavez Tools'
  echo '// @namespace    https://wavez.fm/'
  echo "// @author       $author"
  echo '// @icon         https://wavez.fm/favicon.ico'
  echo "// @version      PENDING"
  echo "// @updateURL    $raw/$(basename "$bundle")"
  echo "// @downloadURL  $raw/$(basename "$bundle")"
  echo '// @description  Every Wavez userscript in one install, switched on and off from the Wavez Tools panel (Alt+T) or the userscript manager menu.'
  echo '// @match        https://wavez.fm/~/*'
  echo '// @grant        GM_registerMenuCommand'
  echo "$grants" | sed 's|^|// @grant        |'
  echo "$connects" | sed 's|^|// @connect      |'
  echo '// @run-at       document-start'
  echo '// ==/UserScript=='
  echo
  echo '// GENERATED by sync-scripts.sh. Edit the individual scripts, not this file.'
  echo
  echo "(function () {"
  echo "  'use strict';"
  echo
  echo '  // Taking a @grant sandboxes us, and the page-context scripts below reach for'
  echo '  // page globals (window.WavezFM). Hand them the real window so they still work.'
  echo '  var PAGE = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;'
  echo
  echo '  var KEY = "wavez-tools:";'
  echo '  function on(id, dflt) { return (localStorage.getItem(KEY + id) || dflt) === "on"; }'
  echo
  echo '  // A saved panel value wins over the constant the script ships with.'
  echo '  function setting(id, name, dflt) { try { var v = localStorage.getItem(KEY + id + ":" + name); return v === null ? dflt : JSON.parse(v); } catch (e) { return dflt; } }'
  echo
  echo '  // Each addon is a row in the panel (wavez-panel reads ADDONS) and a menu entry as the fallback.'
  echo '  var ADDONS = [];'
  echo '  function menu(id, label, dflt, cat, settings) {'
  echo '    var isOn = on(id, dflt);'
  echo '    var list = settings.map(function (s) { return { name: s[0], label: s[1], dflt: s[2], opts: s[3] ? s[3].split(",") : null, value: setting(id, s[0], s[2]) }; });'
  echo '    var entry = { label: label, cat: cat, on: isOn, flip: function () { entry.on = !entry.on; localStorage.setItem(KEY + id, entry.on ? "on" : "off"); }, settings: list, save: function (name, v) { localStorage.setItem(KEY + id + ":" + name, JSON.stringify(v)); } };'
  echo '    ADDONS.push(entry);'
  echo '    // The panel shows a reload reminder; the menu has no UI, so it reloads to show the change.'
  echo '    if (typeof GM_registerMenuCommand === "function") GM_registerMenuCommand((isOn ? "✓ " : "✕ ") + label, function () { entry.flip(); location.reload(); });'
  echo '    return isOn;'
  echo '  }'
  echo
  echo '  // We start at document-start for Imgur; scripts written for document-idle wait for the DOM.'
  echo '  function ready(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { fn(PAGE); }, { once: true }); else fn(PAGE); }'
  echo

  echo "$features" | while IFS=: read -r file id dflt cat; do
    specs=$(specs "$file")
    gate="if (menu('$id', '$(label "$file")', '$dflt', '$cat', [${specs%, }])) "
    [ "$id" = panel ] && gate="menu('$id', 'Show Panel UI', '$dflt', '$cat', []); "
    if grep -q '^// @run-at *document-idle' "$src/$file.user.js"; then open="ready(function (window) {"; close="});"; else open="(function (window) {"; close="})(PAGE);"; fi
    echo "  $gate$open"
    strip < "$src/$file.user.js" | awk '/==\/UserScript==/ { body = 1; next } body' | swap "$id" "$file" | sed 's|^\(.\)|    \1|'
    echo "  $close"
    echo
  done

  echo "})();"
} > "$bundle.tmp"

if [ -f "$bundle" ] && diff -q -I '^// @version' "$bundle.tmp" "$bundle" >/dev/null; then
  rm "$bundle.tmp"
  echo "unchanged $(basename "$bundle")"
else
  bv=$(grep -m1 '^// @version' "$bundle" 2>/dev/null | awk '{print $3}')
  nv=$(date +%Y.%m.%d)
  [ "$nv" != "$bv" ] && [ "$(printf '%s\n%s\n' "$nv" "$bv" | sort -V | tail -1)" = "$nv" ] || nv=$(bump "$bv")
  sed "s|^// @version .*|// @version      $nv|" "$bundle.tmp" > "$bundle"
  rm "$bundle.tmp"
  echo "built $(basename "$bundle") $bv -> $nv ($(echo "$features" | wc -l | tr -d ' ') features, $(wc -l < "$bundle" | tr -d ' ') lines)"
fi
