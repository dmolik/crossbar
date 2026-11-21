# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

uMatrix is a matrix-based (source hostname × destination hostname × request type) firewall browser extension for Chromium and Firefox, written in plain JavaScript with no bundler, transpiler, or npm dependencies. License: GPLv3. Issues go to https://github.com/uBlockOrigin/uMatrix-issues (this repo's tracker is read-only).

## Build

There is no package manager or test suite. Builds are shell scripts that copy files into `dist/build/` (git-ignored):

```sh
./tools/make-chromium.sh          # -> dist/build/uMatrix.chromium/ (unpacked, load in chrome://extensions)
./tools/make-firefox.sh           # -> dist/build/uMatrix.firefox/  (load via about:debugging)
./tools/make-chromium.sh all      # also zip the package
./tools/make-firefox.sh <tag>     # versioned package, e.g. uMatrix_<tag>.firefox.xpi (what CI does)
./tools/make-clean.sh
```

- `tools/make-assets.sh` (called by the build) **requires a sibling checkout of `uBlockOrigin/uAssets` at `../uAssets`**; it checks out a pinned commit there, copies third-party host lists and recipes into `<build>/assets/`, then checks `master` back out.
- The extension version comes from `dist/version`; `tools/make-*-meta.py` writes it into the built `manifest.json`. The Firefox meta script strips `sidebar_action` unless the version is a beta/rc (`x.y.z(b|rc)…`).
- Lint with `jshint` using the repo's `.jshintrc` (ES2017, `strict: global`, `undef`/`unused` on; globals `vAPI`, `µMatrix`, `chrome`, `browser`, `self`, `log`, `webext`).
- `src/js/wasm/*.wasm` are compiled from the adjacent `.wat` with `wat2wasm hntrie.wat -o hntrie.wasm` (run inside that directory). Rebuild the `.wasm` whenever the `.wat` changes.

## Architecture

**Platform layer (`platform/`)**: The build overlays platform files onto `src/js/`. Chromium supplies the full `vAPI` abstraction (`vapi.js`, `vapi-common.js`, `vapi-background.js`, `vapi-client.js`, `vapi-webrequest.js`, `webext.js`) plus its `manifest.json`. The Firefox build copies the Chromium files first, then overwrites `webext.js`, `vapi-webrequest.js`, and `manifest.json` with Firefox versions. Code in `src/` must go through `vAPI`/`webext` instead of calling `chrome.*` directly. Because these files only exist in `src/js/` after a build, you must edit them in `platform/`.

**Background page**: `src/background.html` loads scripts in a fixed order, and **that order is the dependency graph** (there are no modules). `background.js` defines the global `µMatrix` singleton (aliased as `µm` inside files). Later scripts attach to it (`µMatrix.Matrix = (( ) => {…})()`, etc.), and `start.js` runs last to boot. When you add a background script, add it to `background.html` in the right position.

Key pieces:
- `matrix.js`: the `Matrix` class, which stores rules as bitmaps keyed by `"srcHostname desHostname"` with 2 bits per request type, plus per-scope switches (`matrix-off`, `referrer-spoof`, `https-strict`, …).
- `httpsb.js`: creates the two live matrices. `µm.pMatrix` is the **permanent** ruleset (persisted by `storage.js` `saveMatrix`/`loadMatrix`). `µm.tMatrix` is the **temporary** ruleset that filtering actually uses. The popup edits `tMatrix`, and "persist"/"revert" (`applyDiffToPermanentMatrix`, etc.) sync the two.
- `traffic.js`: the `webRequest` handlers (`onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`) where blocking, referrer spoofing, and CSP injection happen.
- `tab.js` and `pagestats.js`: tab-to-page-store tracking and per-page request stats. `filtering-context.js` builds the request context.
- `assets.js` and `cachestorage.js`: fetch, cache, and auto-update the hosts files and recipes listed in `assets/assets.json`. `hosts-files.js` is the UI side. `hntrie.js` (with the wasm) is the hostname trie used for blacklist lookups.
- `recipe-manager.js`: ruleset "recipes" from uAssets.
- `messaging.js`: all UI↔background communication. Each UI page has its own `vAPI.messaging.listen({ name: '<channel>', listener })` block, dispatching on `request.what`. To add a message, find the channel block for the calling page (`popup.js`, `contentscript.js`, `cloud-ui.js`, `dashboard`, `loggerUI`, plus the default `vAPI.messaging.setup` handler).

**UI pages**: each `src/*.html` (popup, dashboard tabs, logger, settings, etc.) pairs with `src/js/<name>.js` and uses `udom.js` (a small jQuery-like helper, `uDom`) and `i18n.js`. Content scripts are `contentscript-start.js` (document_start) and `contentscript.js` (document_end), injected into all frames.

**Localization**: strings live in `src/_locales/<lang>/messages.json`. Only edit `en` by hand. Other locales come from Crowdin via `tools/import-crowdin.sh`.

## Code conventions

- Every file begins with `'use strict';` and wraps its contents in an IIFE or block scope. Sections are separated by `/******…/` banner lines. Match this style.
- Third-party libraries are vendored under `src/lib/` (CodeMirror, lz4, publicsuffixlist, punycode, diff). Do not modify them.
