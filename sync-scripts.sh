#!/usr/bin/env sh
# Refresh the published userscripts in ./userscripts from the source repo,
# stamping each one with update/download URLs that point back at this repo.
set -e
cd "$(dirname "$0")"
src=../userscripts/wavez
raw=https://github.com/fluteds/wavez/raw/main/userscripts
author=fluteds

n=0
for dest in userscripts/*.user.js; do
  name=$(basename "$dest")
  if [ -f "$src/$name" ]; then
    cp "$src/$name" "$dest"
    n=$((n + 1))
  else
    echo "  keep (no source): $name"
  fi

  # stamp author, and point update/download URLs at this repo
  awk -v url="$raw/$name" -v author="$author" '
    /^\/\/ @(author|updateURL|downloadURL)/ { next }
    { print }
    /^\/\/ @namespace/ { printf "// @author       %s\n", author }
    /^\/\/ @version/ {
      printf "// @updateURL    %s\n", url
      printf "// @downloadURL  %s\n", url
    }
  ' "$dest" > "$dest.tmp" && mv "$dest.tmp" "$dest"
done
echo "synced $n script(s) from $src"
