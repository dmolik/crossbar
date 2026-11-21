# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Crossbar is a matrix-based (source hostname × destination hostname × request type) firewall browser extension, written in plain JavaScript with no bundler or transpiler. The extension itself has no npm dependencies (only `tests/` does). License: GPLv3. It is the `dmolik/crossbar` fork of the archived `gorhill/uMatrix`, renamed: the Chromium build is Manifest V3, and the Firefox build is still Manifest V2.

## Build

Builds are shell scripts that copy files into `dist/build/` (git-ignored):

```sh
./tools/make-chromium.sh          # -> dist/build/crossbar.chromium/ (unpacked, load in chrome://extensions)
./tools/make-firefox.sh           # -> dist/build/crossbar.firefox/  (load via about:debugging)
./tools/make-chromium.sh all      # also zip the package
./tools/make-firefox.sh <tag>     # versioned package, e.g. crossbar_<tag>.firefox.xpi (what CI does on tags)
./tools/make-clean.sh
```

- `tools/make-assets.sh` (called by the build) copies `assets/assets.json` and the recipes in `assets/crossbar/`, and downloads a fresh copy of each third-party hosts file. A failed download only prints a warning, because the bundled copy is just a fallback until the first remote update.
- For Chromium, `tools/make-mv3-sw.py` turns the built `background.html` into `js/sw.js` (an `importScripts` list), then deletes `background.html`. Never edit `sw.js` by hand.
- The extension version comes from `dist/version`; `tools/make-*-meta.py` writes it into the built `manifest.json`. The Firefox meta script strips `sidebar_action` unless the version is a beta/rc (`x.y.z(b|rc)…`).
- Lint: `npx jshint@2.13.6 --config .jshintrc src/js/*.js platform/chromium/*.js platform/firefox/*.js`. Lint the Firefox package with `npx web-ext@8 lint -s dist/build/crossbar.firefox`.
- End-to-end tests (`tests/`, Puppeteer): `cd tests && npm ci && npm test` runs against the Chromium build in Chrome for Testing. `npm run test:firefox` runs a smaller suite against the Firefox build (set `FIREFOX=` to a Firefox binary, or install one with `npx puppeteer browsers install firefox`). Build first. There is no way to run a single test: each suite is one script, and the tests in it run in sequence and depend on earlier state. `tests/server.mjs` is the fake multi-host site, and the browser maps `*.test` to it.
- CI (`.github/workflows/ci.yml`) runs lint, both builds, `web-ext lint` and both e2e suites. Pushing a tag creates a draft GitHub release with the packages.
- `src/js/wasm/*.wasm` are compiled from the adjacent `.wat` with `wat2wasm hntrie.wat -o hntrie.wasm` (run inside that directory). Rebuild the `.wasm` whenever the `.wat` changes.

## Architecture

**Platform layer (`platform/`)**: The build overlays platform files onto `src/js/`. Chromium supplies the full `vAPI` abstraction (`vapi.js`, `vapi-common.js`, `vapi-background.js`, `vapi-client.js`, `vapi-webrequest.js`, `webext.js`) plus its `manifest.json`. The Firefox build copies the Chromium files first, then overwrites `webext.js`, `vapi-webrequest.js`, and `manifest.json` with Firefox versions. Code in `src/` must go through `vAPI`/`webext` instead of calling `chrome.*` directly. Because these files only exist in `src/js/` after a build, you must edit them in `platform/`.

**Background**: `src/background.html` loads scripts in a fixed order, and **that order is the dependency graph** (there are no modules). `background.js` defines the global `Crossbar` singleton (aliased as `xb` inside files). It is a top-level `const`, not `self.Crossbar`. Later scripts attach to it (`Crossbar.Matrix = (( ) => {…})()`, etc.), and `start.js` runs last to boot. When you add a background script, add it to `background.html` in the right position; the MV3 service worker is generated from it.

The same background code runs in a Firefox background page and in a Chromium service worker:
- Don't use `window`, `document`, `XMLHttpRequest`, DOM images or canvas, or synchronous `localStorage`. Use `self.addEventListener`/`self.dispatchEvent` for the internal events (`matrixRulesetChange`, `webextFlavor`).
- `vAPI.localStorage` is an in-memory mirror in the service worker, and `start.js` awaits `vAPI.localStorage.start()` before the first read.
- `vAPI.mv3` says which mode the code is running in.
- The service worker can be killed at any time. `tMatrix` is mirrored to `chrome.storage.session` (`storage.js` `loadTemporaryMatrix`), and boot rebuilds everything else.

Key pieces:
- `matrix.js`: the `Matrix` class, which stores rules as bitmaps keyed by `"srcHostname desHostname"` with 2 bits per request type, plus per-scope switches (`matrix-off`, `referrer-spoof`, `https-strict`, …).
- `httpsb.js`: creates the two live matrices. `xb.pMatrix` is the **permanent** ruleset (persisted by `storage.js` `saveMatrix`/`loadMatrix`). `xb.tMatrix` is the **temporary** ruleset that filtering actually uses. The popup edits `tMatrix`, and "persist"/"revert" (`applyDiffToPermanentMatrix`, etc.) sync the two.
- `traffic.js`: the `webRequest` handlers. On Firefox (MV2) they block requests, spoof the referrer and inject CSP. On Chromium (MV3) they only observe, feeding the popup stats and the logger.
- `dnr.js` (MV3 only; it is `undefined` otherwise): compiles `tMatrix` into `declarativeNetRequest` rules, which do the enforcement on Chromium. The header comment explains the approach and its known differences from MV2. In short:
  - per-tab session rules (`tabIds`) are regrouped whenever a tab context's `rootHostname` changes (hooks in `tab.js`);
  - each destination that has a rule gets its verdict from `Matrix.evaluateCellZXY`, emitted with a priority based on its label count;
  - top-level documents use global rules, with blocked ones redirected to `main-blocked.html#<url>`;
  - the hosts-file blocklist is stored as dynamic rules (`storage.js` `loadHostsFiles`);
  - header changes (cookie, CSP, referrer removal) are expressed as domain regions, because a DNR `allow` cancels lower-priority `modifyHeaders` rules.

  Any change to how `Matrix` evaluates rules must stay compatible with this compilation, so run the e2e tests.
- `tab.js` and `pagestats.js`: tab-to-page-store tracking and per-page request stats. `filtering-context.js` builds the request context.
- `assets.js` and `cachestorage.js`: fetch, cache, and auto-update the hosts files and recipes listed in `assets/assets.json`. `hosts-files.js` is the UI side. `hntrie.js` (with the wasm) is the hostname trie used for blacklist lookups.
- `recipe-manager.js`: ruleset "recipes" (`assets/crossbar/recipes_en.txt`, updated remotely from this repo's `master`).
- `messaging.js`: all UI↔background communication. Each UI page has its own `vAPI.messaging.listen({ name: '<channel>', listener })` block, dispatching on `request.what`. To add a message, find the channel block for the calling page (`popup.js`, `contentscript.js`, `cloud-ui.js`, `dashboard`, `loggerUI`, plus the default `vAPI.messaging.setup` handler).

**UI pages**: each `src/*.html` (popup, dashboard tabs, logger, settings, etc.) pairs with `src/js/<name>.js` and uses `udom.js` (a small jQuery-like helper, `uDom`) and `i18n.js`. Content scripts are `contentscript-start.js` (document_start) and `contentscript.js` (document_end), injected into all frames.

**Localization**: strings live in `src/_locales/<lang>/messages.json`. Only edit `en` by hand. Other locales come from Crowdin via `tools/import-crowdin.sh`.

## Code conventions

- Every file begins with `'use strict';` and wraps its contents in an IIFE or block scope. Sections are separated by `/******…/` banner lines. Match this style.
- Third-party libraries are vendored under `src/lib/` (CodeMirror, lz4, publicsuffixlist, punycode, diff). Leave them unmodified except for the small, commented Crossbar patches already there. `punycode.js` and `publicsuffixlist.js` are wrapped to load as classic scripts, and the lz4 loaders have a service-worker path fallback. Re-apply these patches when you update a library.

## Compatibility with uMatrix

The project was renamed from uMatrix, and must keep accepting uMatrix data:
- Backup files (`about.js` `validateBackup` doesn't check `app`), rules files, and recipe files with the `! uMatrix: Ruleset recipes` header (`recipe-manager.js`).
- Storage keys never contained the name, so don't rename them. The only renamed store is the cache IndexedDB (`cachestorage.js`, which deletes the legacy `uMatrixCacheStorage`).
- Keep references to gorhill's issues and wiki, copyright lines, and credits as they are.
