// Render src/img/icon.svg to the PNG sizes the manifests use:
//
//   cd tests && npm run icons

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(repo, 'src/img/icon.svg'), 'utf8');

const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
for ( const size of [ 16, 32, 48, 64, 128 ] ) {
    await page.setViewport({ width: size, height: size });
    await page.setContent(
        `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    await page.screenshot({
        path: path.join(repo, `src/img/icon_${size}.png`),
        omitBackground: true,
    });
}
await browser.close();
