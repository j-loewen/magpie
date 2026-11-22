import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import type { LinkMetaDto } from '@notes/shared';
import { decodeHtml, extractMetadata } from '../src/links/extract';
import { isPrivateAddress, safeFetch } from '../src/links/safe-fetch';
import { FlareSolverr, looksBlocked } from '../src/links/flaresolverr';
import { client, makeApp } from './helpers';

const PAGE = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <title>Fallback &amp; title</title>
  <meta name="description" content="Plain description">
  <meta property="og:title" content="Best Pancakes">
  <meta property="og:description" content="Fluffy &quot;American&quot; pancakes">
  <meta property="og:image" content="/img.png">
  <meta property="og:site_name" content="Test Kitchen">
  <meta property="og:type" content="article">
  <link rel="icon" href="/favicon.png" sizes="16x16">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="canonical" href="https://example.test/pancakes">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"Test Kitchen"},
      {"@type":"Recipe","name":"Pancakes","recipeYield":"4","totalTime":"PT20M","image":["https://cdn.test/p.jpg"]}
    ]}
  </script>
  <script type="application/ld+json">{ not valid json </script>
</head><body><h1>Pancakes</h1></body></html>`;

describe('extractMetadata', () => {
  it('prefers OpenGraph, resolves relative URLs, flattens JSON-LD and ranks icons', () => {
    const md = extractMetadata(PAGE, 'https://example.test/recipes/1');
    expect(md).toMatchObject({
      title: 'Best Pancakes',
      description: 'Fluffy "American" pancakes',
      siteName: 'Test Kitchen',
      ogType: 'article',
      image: 'https://example.test/img.png',
      canonicalUrl: 'https://example.test/pancakes',
    });
    expect(md.icons[0]).toBe('https://example.test/icon.svg'); // SVG first
    expect(md.icons.at(-1)).toBe('https://example.test/favicon.ico'); // fallback last
    expect(md.jsonLd.map((o) => (o as { '@type': string })['@type'])).toEqual(['WebSite', 'Recipe']);
  });

  it('falls back to JSON-LD and <title> when OpenGraph is missing', () => {
    const html = `<title>  Only   a title </title><script type="application/ld+json">
      {"@type":"Product","name":"Widget","description":"A fine widget","image":{"url":"w.png"}}</script>`;
    const md = extractMetadata(html, 'https://shop.test/p/1');
    expect(md.title).toBe('Widget');
    expect(md.description).toBe('A fine widget');
    expect(md.image).toBe('https://shop.test/p/w.png');
    expect(extractMetadata('<title>  Only   a title </title>', 'https://x.test/').title).toBe('Only a title');
  });

  it('ignores non-http image URLs', () => {
    const md = extractMetadata('<meta property="og:image" content="javascript:alert(1)">', 'https://x.test/');
    expect(md.image).toBeUndefined();
  });

  it('decodes legacy charsets', () => {
    const latin1 = Buffer.from('<meta charset="iso-8859-1"><title>Caf\xe9</title>', 'latin1');
    expect(extractMetadata(decodeHtml(latin1, 'text/html'), 'https://x.test/').title).toBe('Café');
  });
});

describe('SSRF protection', () => {
  it('classifies private and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.50', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:192.168.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses private hosts by name and by literal IP', async () => {
    await expect(safeFetch('http://127.0.0.1:1/', { allowPrivate: false, maxBytes: 1000 })).rejects.toThrow(/private/);
    await expect(safeFetch('http://localhost:1/', { allowPrivate: false, maxBytes: 1000 })).rejects.toThrow(/private/);
    await expect(safeFetch('ftp://example.com/', { allowPrivate: false, maxBytes: 1000 })).rejects.toThrow(/http/);
  });
});

// ---- Integration: a local web server stands in for the internet -------------------------

let site: http.Server;
let base: string;
let hits: string[] = [];
/** /flaky answers like a site whose bot protection kicks in later (HTTP 403) while this is true. */
let flakyBlocked = false;
const FLAKY = '<title>Flaky page</title><meta name="description" content="Was there"><meta property="og:image" content="/img.png">';
/** Blocked shop page whose address names the product. */
const SHOP_PATH = '/shop/WD-Red-Plus-Hard-drive/30LWQC75P0D4';

beforeAll(async () => {
  const png = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#e8590c' } }).png().toBuffer();
  // About 20 KB that inflate to more than 20 MB.
  const bomb = zlib.gzipSync(`<title>Bomb</title>${'x'.repeat(20 * 1024 * 1024)}`);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><script>alert(1)</script><rect width="32" height="32" fill="teal"/></svg>';
  site = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    const send = (status: number, type: string, body: string | Buffer, headers: http.OutgoingHttpHeaders = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };
    switch (req.url) {
      case '/page':
        return send(200, 'text/html; charset=utf-8', PAGE);
      case '/other':
        return send(200, 'text/html', '<title>Other page</title>');
      case '/moved':
        return send(301, 'text/plain', '', { location: '/page' });
      case '/img.png':
      case '/photo.png':
        return send(200, 'image/png', png);
      case '/icon.svg':
        return send(200, 'image/svg+xml', svg);
      case '/huge':
        return send(200, 'text/html', `<title>Huge</title>${'x'.repeat(5 * 1024 * 1024)}`);
      // Compressed whatever the request accepts, as Amazon does.
      case '/gzip':
        return send(200, 'text/html', zlib.gzipSync('<title>Gzipped page</title>'), { 'content-encoding': 'gzip' });
      case '/br':
        return send(200, 'text/html', zlib.brotliCompressSync('<title>Brotli page</title>'), { 'content-encoding': 'br' });
      case '/deflate':
        return send(200, 'text/html', zlib.deflateSync('<title>Deflated page</title>'), { 'content-encoding': 'deflate' });
      case '/deflate-raw':
        return send(200, 'text/html', zlib.deflateRawSync('<title>Raw deflate page</title>'), { 'content-encoding': 'deflate' });
      case '/gzip-bomb':
        return send(200, 'text/html', bomb, { 'content-encoding': 'gzip' });
      case '/gzip-bad':
        return send(200, 'text/html', 'this is not gzip', { 'content-encoding': 'gzip' });
      case '/flaky':
        return flakyBlocked ? send(403, 'text/html', '<title>Access Denied</title>') : send(200, 'text/html', FLAKY);
      case SHOP_PATH:
        return send(403, 'text/html', '<title>Access Denied</title>');
      case '/blocked':
        return send(403, 'text/html', '<title>Access Denied</title>');
      case '/captcha':
        return send(200, 'text/html', '<title>Amazon.ca</title><form action="/errors/validateCaptcha"></form>');
      case '/shop':
        // A shop page that builds its product data in the browser.
        return send(200, 'text/html', '<title>Plain shop page</title><meta property="og:type" content="product">');
      case '/challenge':
        return send(200, 'text/html', '<title>Just a moment...</title>');
      case '/drop':
        // Bot protection that cuts the connection instead of answering (e.g. CBC).
        return req.socket.destroy();
      case '/aws':
        // AWS WAF JavaScript challenge (IMDb): HTTP 202, empty title.
        return send(202, 'text/html', AWS_CHALLENGE);
      case '/loop':
        return send(302, 'text/plain', '', { location: '/loop' });
      default:
        return send(404, 'text/plain', 'not found');
    }
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});
afterAll(() => site.close());

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
  hits = [];
});

async function setup(env: Record<string, string> = { LINK_PREVIEW_ALLOW_LAN: 'true' }) {
  ({ app } = await makeApp(env));
  const alice = client(app);
  await alice.register('alice');
  return alice;
}

type Note = { id: string; version: number; meta?: LinkMetaDto };
const createLink = async (c: ReturnType<typeof client>, url: string) =>
  (await c.post('/api/notes', { type: 'link', title: 'Link', content: { url, description: '' } })).json() as Note;
const settled = async (c: ReturnType<typeof client>, id: string) => {
  await app.linkPreviews.idle();
  return (await c.get(`/api/notes/${id}`)).json() as Note;
};

describe('link previews', () => {
  it('fetches title, description, JSON-LD, a WebP thumbnail and a PNG favicon', async () => {
    const alice = await setup();
    const note = await createLink(alice, `${base}/moved`);
    expect(note.meta?.status).toBe('pending');

    const { meta } = await settled(alice, note.id);
    expect(meta).toMatchObject({
      status: 'ok',
      url: `${base}/moved`,
      finalUrl: `${base}/page`,
      title: 'Best Pancakes',
      siteName: 'Test Kitchen',
      ogType: 'article',
      contentType: 'text/html',
    });
    expect(meta?.jsonLd).toHaveLength(2);

    const image = await alice.get(meta!.imageUrl!);
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/webp');
    const { width } = await sharp(image.rawPayload).metadata();
    expect(width).toBe(960); // resized from 1600

    // The SVG favicon is rasterised: no user-supplied SVG is ever served.
    const icon = await alice.get(meta!.faviconUrl!);
    expect(icon.headers['content-type']).toBe('image/png');
    expect(icon.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('makes fetched page text searchable and lists previews in folder listings', async () => {
    const alice = await setup();
    const note = await createLink(alice, `${base}/page`);
    await settled(alice, note.id);
    expect((await alice.get('/api/search?q=pancakes')).json()).toHaveLength(1);
    const [listed] = (await alice.get('/api/notes')).json();
    expect(listed.meta).toMatchObject({ status: 'ok', title: 'Best Pancakes' });
  });

  it('uses the link itself as preview when it points to an image', async () => {
    const alice = await setup();
    const note = await createLink(alice, `${base}/photo.png`);
    const { meta } = await settled(alice, note.id);
    expect(meta).toMatchObject({ status: 'ok', contentType: 'image/png' });
    expect(meta?.imageUrl).toBeTruthy();
  });

  it('records errors, refetches when the URL changes, and refuses to save without a URL', async () => {
    const alice = await setup();
    let note = await createLink(alice, `${base}/missing`);
    note = await settled(alice, note.id);
    expect(note.meta).toMatchObject({ status: 'error', error: 'The site answered with HTTP 404' });

    await alice.put(`/api/notes/${note.id}`, { title: 'T', content: { url: `${base}/other`, description: '' }, version: note.version });
    note = await settled(alice, note.id);
    expect(note.meta).toMatchObject({ status: 'ok', title: 'Other page' });

    // A link note needs its web address (and every note a name); the preview stays as it was.
    const noUrl = await alice.put(`/api/notes/${note.id}`, { title: 'T', content: { url: '', description: 'x' }, version: note.version });
    expect(noUrl.statusCode).toBe(400);
    expect(noUrl.json().message).toBe('Enter a web address');
    const noName = await alice.put(`/api/notes/${note.id}`, { title: ' ', content: { url: `${base}/other`, description: '' }, version: note.version });
    expect(noName.json().message).toBe('Enter a name');
    note = await settled(alice, note.id);
    expect(note.meta).toMatchObject({ status: 'ok', title: 'Other page' });
  });

  it('looks up the page title for a new link, and the preview then reuses the page', async () => {
    const alice = await setup();
    expect((await alice.post('/api/links/title', { url: `${base}/other` })).json()).toEqual({ title: 'Other page' });
    expect((await alice.post('/api/links/title', { url: `${base}/missing` })).json()).toEqual({});
    expect((await alice.post('/api/links/title', { url: 'ftp://example.com' })).statusCode).toBe(400);
    const fetched = hits.filter((h) => h === '/other').length;

    // Without a name or a web address, nothing is created.
    expect((await alice.post('/api/notes', { type: 'link', content: { url: `${base}/other`, description: '' } })).json().message).toBe('Enter a name');
    expect((await alice.post('/api/notes', { type: 'link', title: 'Other page' })).json().message).toBe('Enter a web address');

    const note = await createLink(alice, `${base}/other`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Other page' });
    expect(hits.filter((h) => h === '/other').length).toBe(fetched);
  });

  it('does not refetch when only the description changes; refresh-meta forces it', async () => {
    const alice = await setup();
    let note = await createLink(alice, `${base}/other`);
    note = await settled(alice, note.id);
    const before = hits.filter((h) => h === '/other').length;

    await alice.put(`/api/notes/${note.id}`, { title: 'T', content: { url: `${base}/other`, description: 'my notes' }, version: note.version });
    await settled(alice, note.id);
    expect(hits.filter((h) => h === '/other').length).toBe(before);

    const refreshed = await alice.post(`/api/notes/${note.id}/refresh-meta`);
    expect(refreshed.json().status).toBe('pending');
    await settled(alice, note.id);
    expect(hits.filter((h) => h === '/other').length).toBe(before + 1);
  });

  it('reads at most 4 MB of a page and still extracts what it got', async () => {
    const alice = await setup();
    const note = await createLink(alice, `${base}/huge`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Huge' });
  });

  it('decodes compressed pages, also when the site compresses without being asked', async () => {
    const alice = await setup();
    for (const [path, title] of [
      ['/gzip', 'Gzipped page'],
      ['/br', 'Brotli page'],
      ['/deflate', 'Deflated page'],
      ['/deflate-raw', 'Raw deflate page'],
    ]) {
      const note = await createLink(alice, `${base}${path}`);
      expect((await settled(alice, note.id)).meta, path).toMatchObject({ status: 'ok', title });
    }
  });

  it('applies the size limit to the decompressed page, and reports broken compression', async () => {
    const page = await safeFetch(`${base}/gzip-bomb`, { allowPrivate: true, maxBytes: 1024 * 1024 });
    expect(page).toMatchObject({ status: 200, truncated: true });
    expect(page.body.length).toBe(1024 * 1024);

    const alice = await setup();
    let note = await createLink(alice, `${base}/gzip-bomb`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Bomb' });
    note = await createLink(alice, `${base}/gzip-bad`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'error', error: 'Could not load the page: invalid compressed data' });
  });

  it('keeps the preview when a refresh fails', async () => {
    const alice = await setup();
    flakyBlocked = false;
    const note = await createLink(alice, `${base}/flaky`);
    const before = (await settled(alice, note.id)).meta!;
    expect(before).toMatchObject({ status: 'ok', title: 'Flaky page', description: 'Was there' });
    expect(before.imageUrl).toBeDefined();
    expect(before.error).toBeUndefined();

    flakyBlocked = true;
    await alice.post(`/api/notes/${note.id}/refresh-meta`);
    const after = (await settled(alice, note.id)).meta!;
    expect(after).toEqual({ ...before, error: 'The site answered with HTTP 403' });
    // The image file was kept, not deleted.
    expect((await alice.get(after.imageUrl!)).statusCode).toBe(200);

    flakyBlocked = false;
    await alice.post(`/api/notes/${note.id}/refresh-meta`);
    expect((await settled(alice, note.id)).meta?.error).toBeUndefined();
  });

  it('builds a partial preview from the address when the site blocks the page', async () => {
    const alice = await setup();
    const url = `${base}${SHOP_PATH}`;
    expect((await alice.post('/api/links/title', { url })).json()).toEqual({ title: 'WD Red Plus Hard drive' });
    const note = await createLink(alice, url);
    const { meta } = await settled(alice, note.id);
    expect(meta).toMatchObject({ status: 'ok', title: 'WD Red Plus Hard drive', siteName: '127.0.0.1', error: 'The site answered with HTTP 403' });
    expect(meta?.description).toBeUndefined();
    // Not for pages that are simply missing.
    const missing = await createLink(alice, `${base}/missing-page-name`);
    expect((await settled(alice, missing.id)).meta).toMatchObject({ status: 'error', error: 'The site answered with HTTP 404' });
  });

  it('stops redirect loops', async () => {
    const alice = await setup();
    const note = await createLink(alice, `${base}/loop`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'error', error: 'Too many redirects' });
  });

  it('blocks private addresses by default', async () => {
    const alice = await setup({});
    const note = await createLink(alice, `${base}/page`);
    const { meta } = await settled(alice, note.id);
    expect(meta).toMatchObject({ status: 'error' });
    expect(meta?.error).toMatch(/private network/);
    expect(hits).toEqual([]);
  });

  it('reports previews as disabled when LINK_PREVIEWS=false', async () => {
    const alice = await setup({ LINK_PREVIEWS: 'false' });
    const note = await createLink(alice, `${base}/page`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'disabled', url: `${base}/page` });
    expect(hits).toEqual([]);
  });

  it('only lets users who can read the note load its images', async () => {
    const alice = await setup();
    const bob = client(app);
    await bob.register('bob');
    const note = await createLink(alice, `${base}/page`);
    const { meta } = await settled(alice, note.id);
    expect((await bob.get(meta!.imageUrl!)).statusCode).toBe(404);
    expect((await client(app).get(meta!.imageUrl!)).statusCode).toBe(401);
    expect((await bob.post(`/api/notes/${note.id}/refresh-meta`)).statusCode).toBe(404);
  });
});

// ---- FlareSolverr fallback ---------------------------------------------------------------

const AWS_CHALLENGE = `<html><head><title></title><script>window.awsWafCookieDomainList = ['imdb.com'];</script></head>
<body><div id="challenge-container"></div><script>AwsWafIntegration.getToken().then(() => window.location.reload(true));</script></body></html>`;
const SOLVED = '<html><head><title>Shop</title><script type="application/ld+json">{"@type":"Product","name":"Solved product","image":"/img.png"}</script></head></html>';
let solver: http.Server;
let solverUrl: string;
let solverCalls: { cmd: string; url: string; waitInSeconds?: number }[] = [];
/** `aws`: like FlareSolverr with an AWS WAF challenge, solved only when told to wait. */
let solverMode: 'ok' | 'error' | 'private-redirect' | 'aws' = 'ok';
beforeAll(async () => {
  solver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const input = JSON.parse(body) as { cmd: string; url: string; waitInSeconds?: number };
      solverCalls.push(input);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (solverMode === 'error') return res.end(JSON.stringify({ status: 'error', message: 'Error solving the challenge' }));
      const url = solverMode === 'private-redirect' ? 'http://192.168.1.10/admin' : input.url;
      const response = solverMode === 'aws' && !input.waitInSeconds ? AWS_CHALLENGE : SOLVED;
      res.end(JSON.stringify({ status: 'ok', message: 'Challenge not detected!', solution: { url, status: 200, headers: {}, response } }));
    });
  });
  await new Promise<void>((r) => solver.listen(0, '127.0.0.1', r));
  solverUrl = `http://127.0.0.1:${(solver.address() as AddressInfo).port}`;
});
afterAll(() => solver.close());
afterEach(() => {
  solverCalls = [];
  solverMode = 'ok';
});

describe('FlareSolverr fallback', () => {
  const withSolver = () => setup({ LINK_PREVIEW_ALLOW_LAN: 'true', FLARESOLVERR_URL: solverUrl });

  it('recognises bot protection', () => {
    expect(looksBlocked(403, undefined)).toBe(true);
    expect(looksBlocked(200, '<title>Just a moment...</title>')).toBe(true);
    expect(looksBlocked(200, '<title>Best Pancakes</title>')).toBe(false);
    expect(looksBlocked(404, '<title>Not found</title>')).toBe(false);
  });

  it('fetches pages that refuse plain requests through FlareSolverr', async () => {
    const alice = await withSolver();
    for (const path of ['/blocked', '/challenge']) {
      const note = await createLink(alice, `${base}${path}`);
      const { meta } = await settled(alice, note.id);
      expect(meta).toMatchObject({ status: 'ok', title: 'Solved product' });
      // The preview image is still downloaded directly.
      expect(meta?.imageUrl).toBeDefined();
    }
    expect(solverCalls).toEqual([
      { cmd: 'request.get', url: `${base}/blocked`, maxTimeout: 60000 },
      { cmd: 'request.get', url: `${base}/challenge`, maxTimeout: 60000 },
    ]);
  });

  it('is not used for pages that load normally, or when not configured', async () => {
    let alice = await withSolver();
    let note = await createLink(alice, `${base}/page`);
    expect((await settled(alice, note.id)).meta?.title).toBe('Best Pancakes');
    expect(solverCalls).toHaveLength(0);
    await app.close();

    // Without it, a blocked page gets a partial preview (no name in this address).
    alice = await setup();
    note = await createLink(alice, `${base}/blocked`);
    const { meta } = await settled(alice, note.id);
    expect(meta).toMatchObject({ status: 'ok', siteName: '127.0.0.1', error: 'The site answered with HTTP 403' });
    expect(meta?.title).toBeUndefined();
  });

  it('tries FlareSolverr when the site drops the connection', async () => {
    let alice = await setup();
    let note = await createLink(alice, `${base}/drop`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', error: 'The site closed the connection (it may block link previews)' });
    await app.close();

    alice = await withSolver();
    note = await createLink(alice, `${base}/drop`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Solved product' });
    expect(solverCalls).toHaveLength(1);
  });

  it('renders shop pages without product data in FlareSolverr, but not for the title lookup', async () => {
    const alice = await withSolver();
    expect((await alice.post('/api/links/title', { url: `${base}/shop` })).json()).toEqual({ title: 'Plain shop page' });
    expect(solverCalls).toHaveLength(0);
    const note = await createLink(alice, `${base}/shop`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Solved product' });
    expect(solverCalls).toEqual([{ cmd: 'request.get', url: `${base}/shop`, maxTimeout: 60000 }]);
    // The page itself was fetched once: the preview reused the one from the title lookup.
    expect(hits.filter((h) => h === '/shop')).toHaveLength(1);
  });

  it('keeps the plain page when FlareSolverr fails or is not configured', async () => {
    solverMode = 'error';
    let alice = await withSolver();
    let note = await createLink(alice, `${base}/shop`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Plain shop page' });
    expect(solverCalls).toHaveLength(1);
    await app.close();

    alice = await setup();
    note = await createLink(alice, `${base}/shop`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Plain shop page' });
  });

  it('treats captcha pages as blocked', async () => {
    let alice = await setup();
    let note = await createLink(alice, `${base}/captcha`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', error: 'The site showed a robot check instead of the page' });
    await app.close();

    alice = await withSolver();
    note = await createLink(alice, `${base}/captcha`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Solved product' });
    expect(solverCalls).toHaveLength(1);
  });

  it('gives the browser time for challenges FlareSolverr does not recognise (AWS WAF)', async () => {
    expect(looksBlocked(202, AWS_CHALLENGE)).toBe(true);
    // The real page loads AWS WAF's script too; that alone is not a challenge.
    expect(looksBlocked(200, `<title>Project Hail Mary (2026) - IMDb</title><script>window.awsWafCookieDomainList = ['imdb.com'];</script>`)).toBe(false);
    solverMode = 'aws';
    const alice = await withSolver();
    const note = await createLink(alice, `${base}/aws`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', title: 'Solved product' });
    expect(solverCalls.map((c) => c.waitInSeconds)).toEqual([undefined, 6]);
  });

  it('keeps the original error when FlareSolverr fails', async () => {
    solverMode = 'error';
    const alice = await withSolver();
    const note = await createLink(alice, `${base}/blocked`);
    expect((await settled(alice, note.id)).meta).toMatchObject({ status: 'ok', error: 'The site answered with HTTP 403' });
    expect(solverCalls).toHaveLength(1);
  });

  it('never lets FlareSolverr reach private addresses unless they are allowed', async () => {
    const flare = new FlareSolverr(solverUrl);
    await expect(flare.fetch('http://127.0.0.1:1/', { allowPrivate: false, maxBytes: 1000 })).rejects.toThrow(/private network/);
    expect(solverCalls).toHaveLength(0);
    // A public page that ends up on a LAN address (redirect) is discarded.
    solverMode = 'private-redirect';
    await expect(flare.fetch('http://93.184.216.34/', { allowPrivate: false, maxBytes: 1000 })).rejects.toThrow(/private network/);
    expect(solverCalls).toHaveLength(1);
  });
});
