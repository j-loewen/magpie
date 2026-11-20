import { Parser } from 'htmlparser2';
import { applySiteRules } from './sites';

export interface PageMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  ogType?: string;
  /** Absolute URL of the best preview image. */
  image?: string;
  /** Absolute icon URLs, best first (always ends with /favicon.ico). */
  icons: string[];
  canonicalUrl?: string;
  jsonLd: unknown[];
}

const MAX_JSONLD_BYTES = 200_000;
const clean = (s: string | undefined, max: number) => {
  const v = s?.replace(/\s+/g, ' ').trim();
  return v ? v.slice(0, max) : undefined;
};

function absolute(href: string | undefined, base: string): string | undefined {
  if (!href?.trim()) return undefined;
  try {
    const url = new URL(href.trim(), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** First string found at a JSON-LD value that may be a string, an object with url/name, or an array. */
function ldString(v: unknown, keys = ['url', 'contentUrl', 'name']): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = ldString(item, keys);
      if (s) return s;
    }
  }
  if (isObj(v)) for (const k of keys) if (typeof v[k] === 'string') return v[k] as string;
  return undefined;
}

/** The JSON-LD item that describes the page itself (not the website, organisation or breadcrumbs). */
function mainEntity(items: Obj[]): Obj | undefined {
  const skip = new Set(['WebSite', 'Organization', 'BreadcrumbList', 'SiteNavigationElement', 'WPHeader', 'WPFooter', 'ImageObject', 'Person']);
  const typeOf = (o: Obj) => [o['@type']].flat().map(String);
  return items.find((o) => typeOf(o).some((t) => !skip.has(t))) ?? items[0];
}

export function extractMetadata(html: string, pageUrl: string): PageMetadata {
  const meta = new Map<string, string>(); // first value wins
  const icons: { href: string; rank: number }[] = [];
  const ldBlocks: string[] = [];
  let title = '';
  let inTitle = false;
  let inLd = false;
  let ld = '';
  let canonical: string | undefined;
  let imageSrc: string | undefined;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'title') inTitle = true;
        else if (name === 'meta') {
          const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? '').toLowerCase().trim();
          if (key && attrs.content !== undefined && !meta.has(key)) meta.set(key, attrs.content);
        } else if (name === 'link') {
          const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
          if (rel.includes('canonical')) canonical ??= attrs.href;
          if (rel.includes('image_src')) imageSrc ??= attrs.href;
          if (attrs.href && (rel.includes('icon') || rel.includes('apple-touch-icon'))) {
            const size = Number.parseInt(attrs.sizes ?? '', 10) || (rel.includes('apple-touch-icon') ? 180 : 32);
            const svg = (attrs.type ?? '').includes('svg') || /\.svg(\?|$)/i.test(attrs.href);
            // Prefer SVG, then sizes close to 64px.
            icons.push({ href: attrs.href, rank: svg ? -1 : Math.abs(64 - Math.min(size, 256)) });
          }
        } else if (name === 'script' && (attrs.type ?? '').toLowerCase().includes('ld+json')) {
          inLd = true;
          ld = '';
        }
      },
      ontext(text) {
        if (inTitle) title += text;
        else if (inLd && ld.length < MAX_JSONLD_BYTES) ld += text;
      },
      onclosetag(name) {
        if (name === 'title') inTitle = false;
        else if (name === 'script' && inLd) {
          inLd = false;
          ldBlocks.push(ld);
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(html);
  parser.end();

  // JSON-LD: parse each block, flatten arrays and @graph.
  const jsonLd: Obj[] = [];
  for (const block of ldBlocks) {
    try {
      const parsed: unknown = JSON.parse(block.trim());
      for (const item of [parsed].flat()) {
        if (!isObj(item)) continue;
        if (Array.isArray(item['@graph'])) jsonLd.push(...(item['@graph'] as unknown[]).filter(isObj));
        else jsonLd.push(item);
      }
    } catch {
      // Invalid JSON-LD is common; ignore it.
    }
  }
  const main = mainEntity(jsonLd);
  const site = jsonLd.find((o) => [o['@type']].flat().includes('WebSite'));

  const get = (...keys: string[]) => keys.map((k) => meta.get(k)).find((v) => v?.trim());

  const image =
    absolute(get('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'), pageUrl) ??
    absolute(main ? ldString(main.image ?? main.thumbnailUrl) : undefined, pageUrl) ??
    absolute(imageSrc, pageUrl);

  const iconUrls = icons
    .sort((a, b) => a.rank - b.rank)
    .map((i) => absolute(i.href, pageUrl))
    .filter((u): u is string => Boolean(u));
  const fallbackIcon = absolute('/favicon.ico', pageUrl);
  if (fallbackIcon && !iconUrls.includes(fallbackIcon)) iconUrls.push(fallbackIcon);

  return applySiteRules(html, pageUrl, {
    title: clean(
      get('og:title', 'twitter:title') ??
        (main ? ldString(main.headline ?? main.name, []) : undefined) ??
        title,
      500,
    ),
    description: clean(
      get('og:description', 'twitter:description', 'description') ??
        (main && typeof main.description === 'string' ? main.description : undefined),
      2000,
    ),
    siteName: clean(
      get('og:site_name', 'application-name') ??
        (site ? ldString(site.name, []) : undefined) ??
        (main ? ldString(main.publisher, ['name']) : undefined),
      200,
    ),
    ogType: clean(get('og:type'), 100),
    image,
    icons: iconUrls.slice(0, 4),
    canonicalUrl: absolute(canonical ?? get('og:url'), pageUrl),
    jsonLd,
  });
}

/** Decodes an HTML response using the charset from the header or a <meta charset>, defaulting to UTF-8. */
export function decodeHtml(body: Buffer, contentType: string): string {
  const fromHeader = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  const head = body.subarray(0, 4096).toString('latin1');
  const fromMeta =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // Unknown charset label: try the next one.
    }
  }
  return body.toString('utf8');
}
