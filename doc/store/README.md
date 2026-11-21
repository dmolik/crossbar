# Store listings

Text and images for the Chrome Web Store and addons.mozilla.org (AMO) listings. Regenerate the screenshots with `./tools/make-chromium.sh && (cd tests && npm run screenshots)`. The icon source is `src/img/icon.svg`; regenerate the PNGs with `cd tests && npm run icons`.

- Icon: `src/img/icon_128.png`
- Screenshots (1280×800): `screenshots/1-popup.png`, `screenshots/2-logger.png`, `screenshots/3-rules.png`
- Chrome Web Store small promo tile (440×280): `screenshots/promo-440x280.png`
- Privacy policy: <https://github.com/dmolik/crossbar/blob/master/PRIVACY.md>
- Homepage: <https://github.com/dmolik/crossbar>
- Support: <https://github.com/dmolik/crossbar/issues>
- Category: Privacy & Security (AMO: `privacy-security`)
- License: GPLv3 (AMO only offers `GPL-3.0-only`, see `amo-metadata.json`)

## Name

Crossbar

## Summary

Chrome (132 characters at most):

> Point-and-click, matrix-based firewall: decide which sites each page may connect to, and what they may load. A fork of uMatrix.

AMO (250 characters at most): see `summary` in `amo-metadata.json`.

## Description

> **For advanced users.**
>
> Crossbar is a point-and-click, matrix-based firewall. For each site you visit, a matrix shows every other site the page tries to reach, and the kind of content it asks for: cookies, CSS, images, media, scripts, XHR/fetch, frames and others. One click on a cell, row or column allows or blocks it.
>
> - See every remote connection a page attempts, whether it was allowed or blocked.
> - Rules are scoped: block a site everywhere except on its own pages, or allow a CDN only on the site that needs it.
> - Precedence logic: allow a whole page with one click, and narrower rules still win.
> - Out of the box it blocks third-party scripts, frames and XHR while allowing first-party content, CSS and images. Switch to allow-all/block-exceptionally with a single click if you prefer.
> - Bundled hosts files (Dan Pollock's, MVPS, Peter Lowe's) block known ad, tracking and malware hostnames everywhere. Each can be turned off, and you can add your own.
> - Cookie blocking, referrer removal for third-party requests, blocking of inline scripts and web workers, and HTTPS-strict mode, all per scope.
> - A logger shows every request and how it was handled, which is what you need to un-break sites.
> - Temporary rules for experimenting, and permanent rules you commit when happy. Rules import and export as plain text.
>
> Sites will break: Crossbar works in block-by-default mode, and you decide what to allow. If that sounds like work, this extension is not for you.
>
> Crossbar is a maintained fork of uMatrix by Raymond Hill, which was discontinued in 2021. On Chrome it uses Manifest V3. Backups made with uMatrix restore as is: see https://github.com/dmolik/crossbar/blob/master/doc/README.md.
>
> Crossbar collects no data. Free software under the GPLv3: https://github.com/dmolik/crossbar

## Chrome Web Store: privacy practices tab

**Single purpose**

> Crossbar blocks or allows the network requests web pages make, according to rules the user sets in a source-site × destination-site × request-type matrix.

**Permission justifications**

| Permission | Justification |
|---|---|
| `declarativeNetRequest` | Enforces the user's rules: blocks requests, redirects blocked pages to an explanation page, removes cookies and third-party `Referer` headers, and adds CSP headers that block inline scripts and workers when the user's rules say so. |
| `webRequest` | Observes requests (without blocking them) to show the user what each page tried to load in the popup matrix and the logger, so they can write rules. |
| Host permissions (`<all_urls>`) | Rules apply to any site the user visits, and the content scripts that report blocked inline scripts and fill the popup need to run on every page. |
| `scripting` | Inserts the stylesheets that collapse the placeholders of blocked elements, and loads a helper content script into a page when it needs one. |
| `tabs` | Associates requests with the tab and page that made them, so rules use the right scope and the popup shows the right page. |
| `webNavigation` | Tracks navigations, including within frames, to know which page a request belongs to. |
| `cookies` | Lets the user see the cookies blocked sites set, and optionally delete those cookies. |
| `browsingData` | Clears the browser cache on an interval the user chooses, to defeat cache-based tracking (off by default). |
| `privacy` | Lets the user prevent WebRTC from leaking their local IP address, and turn off hyperlink auditing and link prefetching, from the settings page. |
| `storage` | Stores the user's rules and settings. |
| `unlimitedStorage` | Caches the hosts files (tens of thousands of hostnames) and compiled rules locally. |

**Remote code**: No. All code ships in the package; downloaded hosts files and recipes are data, never executed.

**Data usage**: collects none of the listed categories. Certify all three statements (no selling, no use unrelated to the single purpose, no creditworthiness use).

## AMO

Submitted from CI (see `.github/workflows/publish.yml`), with `amo-metadata.json` for the first version. AMO also asks for the source code, because the package contains `.wasm` files: CI uploads `git archive` of the tag.

## Setting up publishing

Publishing runs from `.github/workflows/publish.yml` once these repository secrets exist (Settings → Secrets and variables → Actions).

**AMO**
1. Sign in at <https://addons.mozilla.org/developers/> and accept the developer agreement.
2. Create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
3. Add the secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
4. Run the Publish workflow by hand with the tag and *First AMO submission* checked. This creates the listing; add the screenshots and the description on AMO afterwards. Later releases go through without the checkbox.

**Chrome Web Store**
1. Register at <https://chrome.google.com/webstore/devconsole> (one-time fee).
2. Create the item by uploading a zip with `manifest.json` at its root: `./tools/make-chromium.sh && (cd dist/build/crossbar.chromium && zip -qr ../crossbar-cws.zip .)`.
3. Fill the store listing and privacy practices tabs from this file, and submit it for review.
4. For later releases, create OAuth credentials for the Chrome Web Store API (see <https://github.com/fregante/chrome-webstore-upload-keys>), then add the secrets `CWS_EXTENSION_ID`, `CWS_PUBLISHER_ID`, `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`.

After that, publishing a draft release that CI created submits it to both stores.
