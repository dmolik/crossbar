#!/usr/bin/env bash
#
# This script assumes a linux environment

set -euo pipefail

echo "*** Crossbar(Chromium): Creating package"
echo "*** Crossbar(Chromium): Copying files"

DES=./dist/build/crossbar.chromium
rm -rf $DES
mkdir -p $DES

bash ./tools/make-assets.sh $DES

cp -R ./src/*                           $DES/
cp -R $DES/_locales/nb                  $DES/_locales/no # Chrome store quirk
cp    ./platform/chromium/*.js          $DES/js/
cp -R ./platform/chromium/img/*         $DES/img/
cp    ./platform/chromium/manifest.json $DES/
cp    LICENSE.txt                       $DES/

echo "*** crossbar.chromium: Generating meta..."
python3 tools/make-chromium-meta.py $DES/
python3 tools/make-mv3-sw.py $DES/

if [ "${1:-}" = all ]; then
    echo "*** crossbar.chromium: Creating package..."
    pushd $(dirname $DES/)
    zip crossbar.chromium.zip -qr $(basename $DES/)/*
    popd
elif [ -n "${1:-}" ]; then
    echo "*** crossbar.chromium: Creating versioned package..."
    pushd $(dirname $DES/) > /dev/null
    zip crossbar_"$1".chromium.zip -qr $(basename $DES/)/*
    popd > /dev/null
fi

echo "*** Crossbar(Chromium): Package done."
