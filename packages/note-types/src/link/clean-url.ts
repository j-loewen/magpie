/**
 * Removes tracking from links: shop product links are shortened to their canonical form
 * (e.g. Amazon → /dp/<ASIN>), and well-known tracking parameters (utm_*, fbclid, …) are dropped.
 * Returns the input unchanged if it is not an http(s) URL.
 */

const TRACKING = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'igshid', 'igsh', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  'mkt_tok', 'oly_anon_id', 'oly_enc_id', 'rb_clickid', 's_cid', 'vero_conv', 'vero_id', 'wickedid', '_openstat',
  'ref_src', 'ref_url', 'srsltid', '_gl', 'epik', 'spm', 'scm',
]);
const YOUTUBE_TRACKING = new Set(['si', 'feature', 'pp', 'ab_channel', 'embeds_referring_euri', 'source_ve_path']);
const REDDIT_TRACKING = new Set(['share_id', 'mweb_loid', 'rdt', 'correlation_id', 'ref_campaign', 'ref_source']);

const AMAZON = /(^|\.)amazon\.(com|ca|de|fr|it|es|nl|se|pl|in|sg|ae|sa|eg|co\.uk|co\.jp|com\.au|com\.mx|com\.br|com\.tr|com\.be)$/i;
const EBAY = /(^|\.)ebay\.[a-z.]+$/i;
const ALIEXPRESS = /(^|\.)aliexpress\.[a-z.]+$/i;
const WALMART = /(^|\.)walmart\.(com|ca)$/i;
const YOUTUBE = /(^|\.)(youtube\.com|youtu\.be)$/i;
const REDDIT = /(^|\.)reddit\.com$/i;

export function cleanUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return input;
  const host = url.hostname;

  if (AMAZON.test(host)) {
    const asin = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url.pathname + '/')?.[1];
    if (asin) return `https://${host}/dp/${asin.toUpperCase()}`;
  }
  if (EBAY.test(host)) {
    const item = /\/itm\/(?:[^/]+\/)?(\d{9,})/.exec(url.pathname)?.[1];
    if (item) return `https://${host}/itm/${item}`;
  }
  if (ALIEXPRESS.test(host) && /^\/item\/\d+\.html$/.test(url.pathname)) return `https://${host}${url.pathname}`;
  // Walmart products: /ip/<name>/<id> (walmart.ca with /en or /fr first); the query only holds
  // search and delivery filters.
  if (WALMART.test(host) && /^(?:\/(?:en|fr))?\/ip\/(?:[^/]+\/)?[a-z0-9]+\/?$/i.test(url.pathname)) return `https://${host}${url.pathname}`;

  const youtube = YOUTUBE.test(host);
  const reddit = REDDIT.test(host);
  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith('utm_') || TRACKING.has(k) || (youtube && YOUTUBE_TRACKING.has(k)) || (reddit && REDDIT_TRACKING.has(k))) {
      url.searchParams.delete(key);
    }
  }
  // Keep the original text when nothing was removed (URL() would re-encode some characters).
  const cleaned = url.toString().replace(/\?$/, '');
  return url.search === new URL(input.trim()).search ? input.trim() : cleaned;
}
