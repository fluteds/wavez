#!/usr/bin/env sh
# Refresh the published userscripts in ./userscripts from the source repo.
# The published set = whatever already lives in ./userscripts, so adding a
# script is a one-time drop-in here. Scripts with no counterpart in the source
# repo (e.g. wavez-auto-woot, authored here) are left untouched.
set -e
cd "$(dirname "$0")"
src=../userscripts/wavez

n=0
for dest in userscripts/*.user.js; do
  name=$(basename "$dest")
  if [ -f "$src/$name" ]; then
    cp "$src/$name" "$dest"
    n=$((n + 1))
  else
    echo "  keep (no source): $name"
  fi
done
echo "synced $n script(s) from $src"
