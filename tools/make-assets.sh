#!/usr/bin/env bash
#
# Package the assets bundled with the extension: assets.json, the ruleset
# recipes kept in this repo, and a fresh copy of each third-party hosts file
# (used until the first remote update succeeds).

set -euo pipefail

DES=$1/assets

printf "*** Packaging assets in $DES... "

rm -rf $DES
mkdir -p $DES

cp    ./assets/assets.json $DES/
cp -R ./assets/umatrix     $DES/

# A bundled copy is only a fallback until the first remote update, so a
# source being unreachable at build time is not fatal.
fetch() {
    mkdir -p "$(dirname "$DES/thirdparties/$2")"
    if ! curl -fsSL --retry 3 --max-time 60 -o "$DES/thirdparties/$2" "$1"; then
        rm -f "$DES/thirdparties/$2"
        echo >&2 "warning: could not fetch $1"
    fi
}

fetch 'https://publicsuffix.org/list/public_suffix_list.dat' \
      'publicsuffix.org/list/public_suffix_list.dat'
fetch 'https://someonewhocares.org/hosts/hosts' \
      'someonewhocares.org/hosts/hosts.txt'
fetch 'https://winhelp2002.mvps.org/hosts.txt' \
      'winhelp2002.mvps.org/hosts.txt'
fetch 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=1&mimetype=plaintext' \
      'pgl.yoyo.org/as/serverlist'

echo "done."
