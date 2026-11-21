#!/usr/bin/env bash
#
# This script assumes a linux environment

set -euo pipefail

echo "*** crossbar.firefox: Creating web store package"
echo "*** crossbar.firefox: Copying files"

BLDIR=dist/build
DES="$BLDIR"/crossbar.firefox
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R ./src/*                               $DES/
cp    platform/chromium/*.js                $DES/js/
cp -R platform/chromium/img/*               $DES/img/
cp    LICENSE.txt                           $DES/

cp    platform/firefox/*.js                 $DES/js/
cp    platform/firefox/manifest.json        $DES/

echo "*** crossbar.firefox: Generating meta..."
python3 tools/make-firefox-meta.py          $DES/

if [ "${1:-}" = all ]; then
    echo "*** crossbar.firefox: Creating package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
elif [ -n "${1:-}" ]; then
    echo "*** crossbar.firefox: Creating versioned package..."
    pushd $DES > /dev/null
    zip ../$(basename $DES).xpi -qr *
    popd > /dev/null
    mv "$BLDIR"/crossbar.firefox.xpi "$BLDIR"/crossbar_"$1".firefox.xpi
fi

echo "*** crossbar.firefox: Package done."
