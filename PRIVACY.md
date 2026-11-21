# Privacy policy

Crossbar does not collect, transmit, sell or share any personal data, browsing data or usage data. It contains no analytics or telemetry.

## What stays in your browser

To do its job, Crossbar looks at the web requests your browser makes: their URL, type, and the page that made them. It uses them only to decide whether to allow or block each request, and to show you what was blocked in the popup and the logger. This happens entirely inside your browser and is never sent anywhere.

Your rules and settings are stored in your browser's extension storage. The logger keeps a limited number of recent requests in memory only, and drops them when the browser closes or the extension restarts.

## Network requests Crossbar makes

Crossbar downloads, and periodically refreshes, the lists it filters with. These requests carry no information about you or your browsing:

- its asset list and ruleset recipes, from `raw.githubusercontent.com/dmolik/crossbar`
- the Public Suffix List, from `publicsuffix.org`
- the hosts files you enabled, from their publishers (by default `someonewhocares.org`, `winhelp2002.mvps.org` and `pgl.yoyo.org`)
- any other hosts file or recipe URL you add yourself

You can turn off automatic updates in the dashboard.

## Cloud storage

If you choose to use it, the dashboard's cloud storage feature saves your rules or settings to your browser's own sync storage (for example your Google or Firefox account), the same way your browser syncs its own settings. Crossbar never uses it unless you click the cloud buttons.

## Contact

Questions about this policy: <https://github.com/dmolik/crossbar/issues>.
