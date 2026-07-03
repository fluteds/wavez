#!/usr/bin/env sh
# Copy the wavez userscripts from the sibling userscripts repo into ./userscripts.
set -e
cd "$(dirname "$0")"
src=../userscripts/wavez
for s in wavez-translate wavez-open-in-spotify wavez-sidebar wavez-imgur wavez-auto-woot; do
  cp "$src/$s.user.js" userscripts/
done
echo "synced $(ls userscripts | wc -l | tr -d ' ') scripts from $src"
