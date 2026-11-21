// Test web server: every hostname resolves to it (see --host-resolver-rules
// in e2e.mjs), and it records what each request looked like on arrival.

import http from 'node:http';

const pages = {
    // Exercises each request type against the default ruleset.
    '/page': host => `<!doctype html><title>${host}</title>
<script>window.inlineRan = true;</script>
<script src="http://${host}/first-party.js"></script>
<script src="http://cdn.other.test/third-party.js"></script>
<link rel="stylesheet" href="http://css.other.test/style.css">
<img src="http://img.other.test/image.png">
<img src="http://{BLOCKLISTED}/image.png">
<iframe src="http://frame.other.test/frame"></iframe>
<script>fetch('http://api.other.test/data').catch(() => {});</script>`,
    '/frame': host => `<!doctype html><title>frame ${host}</title>`,
    '/setcookie': host => `<!doctype html><title>cookie ${host}</title>`,
};

export function startServer({ port, blocklisted }) {
    const log = [];
    const server = http.createServer((req, res) => {
        // Requests arrive with an absolute URL when the server is used as a
        // proxy (Firefox).
        const url = new URL(req.url, `http://${req.headers.host}`);
        const host = url.hostname;
        const path = url.pathname;
        log.push({
            host,
            path,
            cookie: req.headers.cookie || '',
            referer: req.headers.referer || '',
        });
        if ( path === '/setcookie' ) {
            res.setHeader('set-cookie', 'tracker=1; Path=/; Max-Age=3600');
        }
        const page = pages[path];
        if ( page !== undefined ) {
            res.setHeader('content-type', 'text/html');
            res.end(page(host).replace('{BLOCKLISTED}', blocklisted));
            return;
        }
        if ( path.endsWith('.js') ) {
            res.setHeader('content-type', 'text/javascript');
            const flag = path === '/first-party.js' ? 'firstPartyRan' : 'thirdPartyRan';
            res.end(`window.${flag} = true;`);
            return;
        }
        if ( path.endsWith('.css') ) {
            res.setHeader('content-type', 'text/css');
            res.end('body { color: black; }');
            return;
        }
        res.setHeader('content-type', path.endsWith('.png') ? 'image/png' : 'text/plain');
        res.end('');
    });
    return new Promise(resolve => {
        server.listen(port, '127.0.0.1', ( ) => resolve({ server, log }));
    });
}
