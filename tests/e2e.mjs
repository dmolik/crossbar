// End-to-end tests of the Chromium (Manifest V3) build: load the unpacked
// extension in Chrome for Testing, browse a local test site, and check what
// actually reached the server.
//
//   ./tools/make-chromium.sh && (cd tests && npm ci && npm test)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(
    here,
    process.argv[2] || '../dist/build/crossbar.chromium'
);
const PORT = 8642;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A hostname from a bundled hosts file, so it is in the ubiquitous blocklist.
const blocklisted = (( ) => {
    const file = path.join(
        extensionPath,
        'assets/thirdparties/pgl.yoyo.org/as/serverlist'
    );
    const text = fs.readFileSync(file, 'utf8');
    const match = /^127\.0\.0\.1\s+([a-z0-9.-]+\.[a-z]+)\s*$/m.exec(text);
    assert.ok(match, 'no hostname found in bundled hosts file');
    return match[1];
})();

const { server, log } = await startServer({ port: PORT, blocklisted });

const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ extensionPath ],
    args: [
        // Only the test site resolves, everything else (including remote
        // asset updates) fails, so the bundled assets are used.
        `--host-resolver-rules=MAP *.test 127.0.0.1:${PORT}, MAP ${blocklisted} 127.0.0.1:${PORT}, MAP * ~NOTFOUND`,
        '--no-first-run',
        // GitHub's Ubuntu runners don't allow the user namespaces the
        // sandbox needs.
        ...(process.env.CI ? [ '--no-sandbox' ] : []),
    ],
});

const swErrors = [];
let sw;

const isServiceWorker = t =>
    t.type() === 'service_worker' && t.url().endsWith('/js/sw.js');

const attachServiceWorker = async function(predicate = isServiceWorker) {
    const target = await browser.waitForTarget(predicate, { timeout: 30000 });
    sw = await target.worker();
    // After a restart, the target may be reported before the worker is
    // reachable.
    for ( let i = 0; i < 100; i++ ) {
        if ( await sw.evaluate(( ) => true).catch(( ) => false) ) { break; }
        await sleep(100);
        sw = await target.worker();
    }
    sw.on('console', msg => {
        if ( msg.type() === 'error' ) { swErrors.push(msg.text()); }
    });
    sw.client.on('Runtime.exceptionThrown', ev => {
        swErrors.push(ev.exceptionDetails.exception?.description || ev.exceptionDetails.text);
    });
    // Ready once boot completed and the rules are in place.
    for ( let i = 0; i < 300; i++ ) {
        const ready = await sw.evaluate(async ( ) => {
            if ( typeof Crossbar === 'undefined' || Crossbar.dnr === undefined ) { return false; }
            if ( Crossbar.dnr.isIdle() === false ) { return false; }
            const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
            return dynamic.length !== 0;
        }).catch(( ) => false);
        if ( ready ) { return target; }
        await sleep(100);
    }
    const state = await sw.evaluate(async ( ) => ({
        booted: typeof Crossbar !== 'undefined' && Crossbar.temporaryMatrixLoaded,
        idle: typeof Crossbar !== 'undefined' && Crossbar.dnr?.isIdle(),
        session: (await chrome.declarativeNetRequest.getSessionRules()).length,
        dynamic: (await chrome.declarativeNetRequest.getDynamicRules()).length,
    })).catch(ex => ex.message);
    throw new Error(
        `extension did not become ready: ${JSON.stringify(state)}\n` +
        swErrors.join('\n')
    );
};

const results = [];
const test = async function(name, fn) {
    try {
        await fn();
        results.push([ name, true ]);
        console.log(`ok - ${name}`);
    } catch (ex) {
        results.push([ name, false ]);
        console.log(`not ok - ${name}\n  ${ex.stack.split('\n').join('\n  ')}`);
    }
};

// Navigate, then let subresources and the fetch() settle.
const visit = async function(page, url) {
    const mark = log.length;
    await page.goto(url, { waitUntil: 'load' }).catch(( ) => {});
    await sleep(300);
    return log.slice(mark);
};

const requested = (entries, host, pathname) =>
    entries.find(e => e.host === host && (pathname === undefined || e.path === pathname));

const pageFlags = page => page.evaluate(( ) => ({
    inline: window.inlineRan === true,
    firstParty: window.firstPartyRan === true,
    thirdParty: window.thirdPartyRan === true,
}));

// Wait for a matrix change to be compiled into rules: changes are debounced
// before being compiled.
const settle = async function() {
    await sleep(200);
    for ( let i = 0; i < 100; i++ ) {
        if ( await sw.evaluate(( ) => Crossbar.dnr.isIdle()) ) { return; }
        await sleep(50);
    }
    throw new Error('rules not updated');
};

try {
    await attachServiceWorker();
    const page = await browser.newPage();

    await test('default ruleset: first-party allowed, third-party scripts, frames, fetches blocked', async ( ) => {
        const entries = await visit(page, 'http://site.test/page');
        const flags = await pageFlags(page);
        assert.equal(flags.inline, true, 'inline script should run');
        assert.equal(flags.firstParty, true, '1st-party script should run');
        assert.equal(flags.thirdParty, false, '3rd-party script should not run');
        assert.ok(requested(entries, 'site.test', '/first-party.js'));
        assert.ok(!requested(entries, 'cdn.other.test'), '3rd-party script must not be requested');
        assert.ok(requested(entries, 'css.other.test'), '3rd-party css is allowed');
        assert.ok(requested(entries, 'img.other.test'), '3rd-party image is allowed');
        assert.ok(!requested(entries, 'frame.other.test'), '3rd-party frame must not be requested');
        assert.ok(!requested(entries, 'api.other.test'), '3rd-party fetch must not be requested');
    });

    await test('hosts file blocklist: subresource blocked', async ( ) => {
        const entries = await visit(page, 'http://site.test/page');
        assert.ok(!requested(entries, blocklisted));
    });

    await test('hosts file blocklist: document redirected to main-blocked page', async ( ) => {
        const entries = await visit(page, `http://${blocklisted}/page?a=1#frag`);
        assert.ok(!requested(entries, blocklisted), 'blocked document must not be requested');
        // Chrome may have upgraded the navigation to https.
        const match = /^chrome-extension:\/\/[a-z]+\/main-blocked\.html#(https?:\/\/.+)$/.exec(page.url());
        assert.ok(match, `landed at ${page.url()}`);
        assert.match(match[1], new RegExp(`^https?://${blocklisted.replace(/\./g, '\\.')}/page\\?a=1#frag$`));
        const shown = await page.$eval('.what', el => el.textContent);
        assert.equal(shown, match[1]);
    });

    await test('third-party referrer removed', async ( ) => {
        const entries = await visit(page, 'http://site.test/page');
        const image = requested(entries, 'img.other.test', '/image.png');
        assert.ok(image);
        assert.equal(image.referer, '');
        const firstParty = requested(entries, 'site.test', '/first-party.js');
        assert.equal(firstParty.referer, 'http://site.test/page');
    });

    await test('cookies: removed from documents and subresources when blocked', async ( ) => {
        await visit(page, 'http://cookie.test/setcookie');
        let entries = await visit(page, 'http://cookie.test/page');
        assert.equal(requested(entries, 'cookie.test', '/page').cookie, 'tracker=1');
        assert.equal(requested(entries, 'cookie.test', '/first-party.js').cookie, 'tracker=1');
        await sw.evaluate(( ) => {
            Crossbar.tMatrix.blacklistCell('cookie.test', 'cookie.test', 'cookie');
        });
        await settle();
        entries = await visit(page, 'http://cookie.test/page');
        assert.equal(requested(entries, 'cookie.test', '/page').cookie, '');
        assert.equal(requested(entries, 'cookie.test', '/first-party.js').cookie, '');
        // Other cookies are left alone.
        await visit(page, 'http://other-cookie.test/setcookie');
        entries = await visit(page, 'http://other-cookie.test/page');
        assert.equal(requested(entries, 'other-cookie.test', '/page').cookie, 'tracker=1');
    });

    await test('temporary rule applies to its scope only', async ( ) => {
        await sw.evaluate(( ) => {
            Crossbar.tMatrix.whitelistCell('site.test', 'cdn.other.test', 'script');
        });
        await settle();
        let entries = await visit(page, 'http://site.test/page');
        assert.ok(requested(entries, 'cdn.other.test'));
        assert.equal((await pageFlags(page)).thirdParty, true);
        // Same tab, other scope.
        entries = await visit(page, 'http://news.test/page');
        assert.ok(!requested(entries, 'cdn.other.test'));
        assert.equal((await pageFlags(page)).thirdParty, false);
    });

    await test('blocked first-party script also blocks inline scripts', async ( ) => {
        await sw.evaluate(( ) => {
            Crossbar.tMatrix.blacklistCell('strict.test', 'strict.test', 'script');
        });
        await settle();
        const entries = await visit(page, 'http://strict.test/page');
        const flags = await pageFlags(page);
        assert.equal(flags.inline, false, 'inline script must not run');
        assert.equal(flags.firstParty, false);
        assert.ok(!requested(entries, 'strict.test', '/first-party.js'));
    });

    await test('popup stats see blocked requests', async ( ) => {
        await visit(page, 'http://site.test/page');
        const stats = await sw.evaluate(async ( ) => {
            const [ tab ] = await chrome.tabs.query({ url: 'http://site.test/*' });
            const pageStore = Crossbar.pageStoreFromTabId(tab.id);
            return {
                blocked: pageStore.perLoadBlockedRequestCount,
                allowed: pageStore.perLoadAllowedRequestCount,
            };
        });
        assert.ok(stats.blocked > 0, `blocked count: ${stats.blocked}`);
        assert.ok(stats.allowed > 0, `allowed count: ${stats.allowed}`);
    });

    // Stopping an extension service worker disconnects puppeteer from Chrome
    // (also with a minimal extension), so the restart is exercised in place:
    // forget the temporary ruleset, then run the boot-time load.
    await test('temporary rules are restored from session storage at boot', async ( ) => {
        const restored = await sw.evaluate(async ( ) => {
            const stored = await chrome.storage.session.get('temporaryMatrix');
            const inStorage = (stored.temporaryMatrix || [])
                .includes('site.test cdn.other.test script allow');
            Crossbar.tMatrix.assign(Crossbar.pMatrix);
            await Crossbar.loadMatrix();
            return {
                inStorage,
                cell: Crossbar.tMatrix.evaluateCell('site.test', 'cdn.other.test', 'script'),
            };
        });
        assert.equal(restored.inStorage, true, 'temporary rule not in session storage');
        assert.equal(restored.cell, 2, 'temporary rule not restored');
        await settle();
        const entries = await visit(page, 'http://site.test/page');
        assert.ok(requested(entries, 'cdn.other.test'));
    });

    await test('recipe files written for uMatrix are accepted', async ( ) => {
        const names = await sw.evaluate(( ) => {
            for ( const name of [ 'uMatrix', 'Crossbar' ] ) {
                Crossbar.recipeManager.fromString(
                    `! ${name}: Ruleset recipes 1.0\n! Maintainer: test\n\n` +
                    `${name} recipe\n\t${name.toLowerCase()}.test *\n\t\t_ cdn.other.test script\n\n`
                );
            }
            const fetch = src => new Promise(resolve => {
                Crossbar.recipeManager.fetch(src, [ 'cdn.other.test' ], resolve);
            });
            return Promise.all([ fetch('umatrix.test'), fetch('crossbar.test') ])
                .then(results => results.flat().map(r => r.name).sort());
        });
        assert.deepEqual(names, [ 'Crossbar recipe', 'uMatrix recipe' ]);
    });

    await test('no errors in service worker', async ( ) => {
        assert.deepEqual(swErrors, []);
    });
} finally {
    await browser.close();
    server.close();
}

const failed = results.filter(([ , ok ]) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
