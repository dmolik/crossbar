// Store screenshots (1280×800) and promo tile (440×280) of the Chromium
// build, browsing the local test site:
//
//   ./tools/make-chromium.sh && (cd tests && npm run screenshots)
//
// Output goes to doc/store/screenshots/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { startServer } from './server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const extensionPath = path.resolve(here, process.argv[2] || '../dist/build/crossbar.chromium');
const outDir = path.join(repo, 'doc/store/screenshots');
const PORT = 8643;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const blocklisted = (( ) => {
    const text = fs.readFileSync(
        path.join(extensionPath, 'assets/thirdparties/pgl.yoyo.org/as/serverlist'),
        'utf8'
    );
    return /^127\.0\.0\.1\s+([a-z0-9.-]+\.[a-z]+)\s*$/m.exec(text)[1];
})();

const { server } = await startServer({ port: PORT, blocklisted });

const browser = await puppeteer.launch({
    headless: true,
    pipe: true,
    enableExtensions: [ extensionPath ],
    args: [
        `--host-resolver-rules=MAP *.test 127.0.0.1:${PORT}, MAP ${blocklisted} 127.0.0.1:${PORT}, MAP * ~NOTFOUND`,
        '--no-first-run',
        ...(process.env.CI ? [ '--no-sandbox' ] : []),
    ],
});

const iconSVG = fs.readFileSync(path.join(repo, 'src/img/icon.svg'), 'utf8');

// A framed image with a caption, for screenshots of the small popup.
const frame = (width, height, caption, image) => `<!doctype html>
<style>
html, body { margin: 0; height: 100%; }
body {
    background: linear-gradient(135deg, #0f172a, #1e293b);
    color: #e2e8f0;
    font: 16px system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center; gap: 56px;
}
.text { max-width: 420px; }
.text svg { width: 72px; height: 72px; }
h1 { font-size: 44px; margin: 16px 0 12px; color: #fff; }
p { font-size: 20px; line-height: 1.45; margin: 0; color: #cbd5e1; }
img { box-shadow: 0 12px 40px rgba(0,0,0,.5); border-radius: 6px; max-height: ${height - 80}px; }
</style>
<div class="text">${iconSVG}<h1>Crossbar</h1><p>${caption}</p></div>
${image ? `<img src="data:image/png;base64,${image}">` : ''}`;

try {
    fs.mkdirSync(outDir, { recursive: true });

    const target = await browser.waitForTarget(
        t => t.type() === 'service_worker' && t.url().endsWith('/js/sw.js'),
        { timeout: 30000 }
    );
    const sw = await target.worker();
    const extensionOrigin = `chrome-extension://${new URL(target.url()).host}`;
    for ( let i = 0; i < 300; i++ ) {
        const ready = await sw.evaluate(async ( ) =>
            typeof Crossbar !== 'undefined' && Crossbar.dnr !== undefined &&
            Crossbar.dnr.isIdle() &&
            (await chrome.declarativeNetRequest.getDynamicRules()).length !== 0
        ).catch(( ) => false);
        if ( ready ) { break; }
        await sleep(100);
    }

    const shot = async function(name, url, setup) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(url, { waitUntil: 'load' });
        if ( setup ) { await setup(page); }
        await sleep(1000);
        await page.screenshot({ path: path.join(outDir, name) });
        await page.close();
    };

    // The logger only records while it is open.
    const logger = await browser.newPage();
    await logger.setViewport({ width: 1280, height: 800 });
    await logger.goto(`${extensionOrigin}/logger-ui.html`, { waitUntil: 'load' });

    const site = await browser.newPage();
    await site.goto('http://site.test/page', { waitUntil: 'load' });
    await sleep(500);
    const [ tab ] = await sw.evaluate(( ) => chrome.tabs.query({ url: 'http://site.test/*' }));

    // Popup, opened in a tab for that site.
    const popup = await browser.newPage();
    await popup.setViewport({ width: 900, height: 760, deviceScaleFactor: 1 });
    await popup.goto(`${extensionOrigin}/popup.html?tabid=${tab.id}`, { waitUntil: 'load' });
    await sleep(1500);
    const box = await popup.evaluate(( ) => {
        const el = document.body;
        return { width: el.scrollWidth, height: el.scrollHeight };
    });
    const popupImage = await popup.screenshot({
        clip: { x: 0, y: 0, width: Math.min(box.width, 900), height: Math.min(box.height, 760) },
        encoding: 'base64',
    });
    await popup.close();

    const composer = await browser.newPage();
    await composer.setViewport({ width: 1280, height: 800 });
    await composer.setContent(frame(1280, 800,
        'A point-and-click firewall: for each site, choose which other sites it may connect to, and what they may load — cookies, CSS, images, media, scripts, XHR, frames.',
        popupImage
    ));
    await composer.screenshot({ path: path.join(outDir, '1-popup.png') });

    await logger.bringToFront();
    await sleep(1000);
    await logger.screenshot({ path: path.join(outDir, '2-logger.png') });

    await shot('3-rules.png', `${extensionOrigin}/dashboard.html#user-rules`);

    // Chrome Web Store small promo tile.
    await composer.setViewport({ width: 440, height: 280 });
    await composer.setContent(`<!doctype html>
<style>
html, body { margin: 0; height: 100%; }
body {
    background: linear-gradient(135deg, #0f172a, #1e293b); color: #fff;
    font: 16px system-ui, sans-serif;
    display: flex; align-items: center; justify-content: center; gap: 24px;
}
svg { width: 120px; height: 120px; }
h1 { font-size: 40px; margin: 0 0 6px; }
p { margin: 0; color: #cbd5e1; font-size: 17px; }
</style>
${iconSVG}<div><h1>Crossbar</h1><p>Matrix-based firewall</p></div>`);
    await composer.screenshot({ path: path.join(outDir, 'promo-440x280.png') });

    console.log(`screenshots written to ${path.relative(process.cwd(), outDir)}`);
} finally {
    await browser.close();
    server.close();
}
