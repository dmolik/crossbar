// Smoke tests of the Firefox (Manifest V2) build: the extension is installed
// temporarily in the given Firefox through WebDriver BiDi, and the test
// server doubles as a proxy for the test hostnames.
//
//   ./tools/make-firefox.sh && (cd tests && FIREFOX=/path/to/firefox npm run test:firefox)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, process.argv[2] || '../dist/build/uMatrix.firefox');
const PORT = 8643;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const blocklisted = (( ) => {
    const text = fs.readFileSync(
        path.join(extensionPath, 'assets/thirdparties/pgl.yoyo.org/as/serverlist'),
        'utf8'
    );
    return /^127\.0\.0\.1\s+([a-z0-9.-]+\.[a-z]+)\s*$/m.exec(text)[1];
})();

const { server, log } = await startServer({ port: PORT, blocklisted });

const browser = await puppeteer.launch({
    browser: 'firefox',
    executablePath: process.env.FIREFOX,
    headless: true,
    // Needed to inspect the extension page a blocked document is replaced with.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    extraPrefsFirefox: {
        'network.proxy.type': 1,
        'network.proxy.http': '127.0.0.1',
        'network.proxy.http_port': PORT,
        'network.proxy.allow_hijacking_localhost': true,
        'dom.security.https_first': false,
        'dom.security.https_only_mode': false,
    },
});

const results = [];
const test = async function(name, fn) {
    try {
        await fn();
        results.push(true);
        console.log(`ok - ${name}`);
    } catch (ex) {
        results.push(false);
        console.log(`not ok - ${name}\n  ${ex.stack.split('\n').join('\n  ')}`);
    }
};

const visit = async function(page, url) {
    const mark = log.length;
    await page.goto(url, { waitUntil: 'load' }).catch(( ) => {});
    await sleep(500);
    return log.slice(mark);
};

const requested = (entries, host, pathname) =>
    entries.find(e => e.host === host && (pathname === undefined || e.path === pathname));

try {
    await browser.installExtension(extensionPath);
    const page = await browser.newPage();

    // Wait for the hosts files to be loaded: the blocklisted image stops
    // being requested.
    let entries;
    for ( let i = 0; i < 60; i++ ) {
        entries = await visit(page, 'http://site.test/page');
        if ( requested(entries, 'site.test') && !requested(entries, blocklisted) ) { break; }
        await sleep(500);
    }

    await test('default ruleset: first-party allowed, third-party scripts, frames, fetches blocked', async ( ) => {
        const flags = await page.evaluate(( ) => ({
            inline: window.inlineRan === true,
            firstParty: window.firstPartyRan === true,
            thirdParty: window.thirdPartyRan === true,
        }));
        assert.deepEqual(flags, { inline: true, firstParty: true, thirdParty: false });
        assert.ok(!requested(entries, 'cdn.other.test'));
        assert.ok(requested(entries, 'css.other.test'));
        assert.ok(requested(entries, 'img.other.test'));
        assert.ok(!requested(entries, 'frame.other.test'));
        assert.ok(!requested(entries, 'api.other.test'));
    });

    await test('hosts file blocklist: subresource blocked', async ( ) => {
        assert.ok(!requested(entries, blocklisted));
    });

    await test('third-party referrer spoofed', async ( ) => {
        assert.equal(requested(entries, 'img.other.test', '/image.png').referer, 'http://img.other.test/');
    });

    await test('hosts file blocklist: document blocked', async ( ) => {
        const entries = await visit(page, `http://${blocklisted}/page`);
        assert.ok(!requested(entries, blocklisted));
        // The tab is navigated to the page asynchronously.
        let href = '';
        for ( let i = 0; i < 20; i++ ) {
            href = await page.evaluate(( ) => location.href).catch(ex => ex.message);
            if ( href.startsWith('moz-extension:') ) { break; }
            await sleep(250);
        }
        assert.match(href, /^moz-extension:\/\/[^/]+\/main-blocked\.html\?details=/);
    });
} finally {
    await browser.close();
    server.close();
}

const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
