import { decodeHTML } from 'entities';
import type { PageMetadata } from '../extract';
import { attr, regionOf, tagWithId, text, type Obj, type SiteRule } from './helpers';

/*
 * Amazon has no JSON-LD or og: tags: name, image, price, rating and the "About this item" bullet
 * points are read from the page itself, and a Product is added for the facts line.
 */

const AMAZON = /(^|\.)amazon\.(com|ca|de|fr|it|es|nl|se|pl|in|sg|ae|sa|eg|co\.uk|co\.jp|com\.au|com\.mx|com\.br|com\.tr|com\.be)$/i;
const AMAZON_CURRENCY: Record<string, string> = {
  com: 'USD', ca: 'CAD', de: 'EUR', fr: 'EUR', it: 'EUR', es: 'EUR', nl: 'EUR', 'com.be': 'EUR', se: 'SEK', pl: 'PLN',
  in: 'INR', sg: 'SGD', ae: 'AED', sa: 'SAR', eg: 'EGP', 'co.uk': 'GBP', 'co.jp': 'JPY', 'com.au': 'AUD',
  'com.mx': 'MXN', 'com.br': 'BRL', 'com.tr': 'TRY',
};

const amazonAsin = (url: URL) => /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url.pathname + '/')?.[1]?.toUpperCase();

/** "CDN$ 1,234.56", "1.234,56 €" → 1234.56 */
export function parsePrice(raw: string): number | undefined {
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return undefined;
  // The last separator followed by one or two digits is the decimal separator.
  const m = /^(.*?)[.,](\d{1,2})$/.exec(digits);
  const whole = (m ? m[1]! : digits).replace(/[.,]/g, '');
  const value = Number(m ? `${whole}.${m[2]}` : whole);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Largest image of Amazon's data-a-dynamic-image attribute ({"url": [width, height], …}). */
function largestDynamicImage(json: string | undefined): string | undefined {
  if (!json) return undefined;
  try {
    const sizes = JSON.parse(json) as Record<string, [number, number]>;
    return Object.entries(sizes).sort(([, a], [, b]) => b[0] * b[1] - a[0] * a[1])[0]?.[0];
  } catch {
    return undefined;
  }
}

function amazon(html: string, url: URL, md: PageMetadata): PageMetadata {
  const tld = AMAZON.exec(url.hostname)?.[2]?.toLowerCase() ?? 'com';
  const titleTag = /<span[^>]*\sid\s*=\s*["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1];
  const name = titleTag ? text(titleTag) : undefined;

  const imgTag = tagWithId(html, 'landingImage') ?? tagWithId(html, 'imgBlkFront') ?? tagWithId(html, 'ebooksImgBlkFront');
  const image =
    attr(imgTag, 'data-old-hires')?.trim() || largestDynamicImage(attr(imgTag, 'data-a-dynamic-image')) || attr(imgTag, 'src');

  let price: number | undefined;
  for (const id of ['corePriceDisplay_desktop_feature_div', 'corePrice_feature_div', 'corePrice_desktop', 'apex_desktop', 'price_inside_buybox', 'priceblock_ourprice', 'kindle-price']) {
    const region = regionOf(html, id);
    const raw = region && (/class\s*=\s*["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>([^<]+)</i.exec(region)?.[1] ?? />\s*([^<]*\d[^<]*)</.exec(region)?.[1]);
    price = raw ? parsePrice(decodeHTML(raw)) : undefined;
    if (price) break;
  }

  const ratingRaw = attr(tagWithId(html, 'acrPopover'), 'title') ?? /a-icon-alt["'][^>]*>([^<]*)</i.exec(regionOf(html, 'averageCustomerReviews') ?? '')?.[1];
  const rating = ratingRaw ? Number(/(\d[.,]\d)/.exec(ratingRaw)?.[1]?.replace(',', '.')) : NaN;
  const reviewsRaw = /\sid\s*=\s*["']acrCustomerReviewText["'][^>]*>([^<]+)</i.exec(html)?.[1];
  const reviews = reviewsRaw ? Number(reviewsRaw.replace(/\D/g, '')) : NaN;

  // The first few "About this item" bullet points read better than Amazon's generic meta description.
  const bulletsRegion = regionOf(html, 'feature-bullets', 20_000);
  const bullets = bulletsRegion
    ? [...bulletsRegion.matchAll(/<span[^>]*class\s*=\s*["'][^"']*a-list-item[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
        .map((m) => text(m[1] ?? ''))
        .filter((b) => b.length > 3)
        .slice(0, 3)
    : [];

  const asin = amazonAsin(url);
  const product: Obj = {
    '@type': 'Product',
    ...(name && { name }),
    ...(image && { image }),
    ...(asin && { sku: asin }),
    ...(price && { offers: { '@type': 'Offer', price, priceCurrency: AMAZON_CURRENCY[tld] ?? 'USD' } }),
    ...(Number.isFinite(rating) && rating > 0 && {
      aggregateRating: { '@type': 'AggregateRating', ratingValue: rating, ...(Number.isFinite(reviews) && reviews > 0 && { reviewCount: reviews }) },
    }),
  };
  const hasProduct = md.jsonLd.some((o) => [(o as Obj)['@type']].flat().includes('Product'));

  return {
    ...md,
    title: name ?? md.title?.replace(/^Amazon\.[a-z.]+\s*:\s*/i, ''),
    description: bullets.length ? bullets.join(' · ').slice(0, 2000) : md.description,
    siteName: md.siteName && !/^amazon$/i.test(md.siteName) ? md.siteName : `Amazon.${tld}`,
    image: image && /^https?:\/\//.test(image) ? image : md.image,
    jsonLd: !hasProduct && name ? [...md.jsonLd, product] : md.jsonLd,
  };
}

export const amazonRule: SiteRule = { host: AMAZON, apply: amazon };
