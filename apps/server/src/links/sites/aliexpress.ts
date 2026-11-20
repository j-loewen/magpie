import type { PageMetadata } from '../extract';
import { isObj, type Obj, type SiteRule } from './helpers';

/** "… Solid State Drive - AliExpress 7": the suffix is the site's category id, not part of the name. */
const stripAliSuffix = (s: string) => s.replace(/\s*[-|]\s*AliExpress(\s+\d+)?\s*$/i, '');

/**
 * AliExpress builds its product data in the browser: the plain HTML has the name and image,
 * a rendered page (FlareSolverr, see needsBrowser) also a JSON-LD Product with price and rating.
 */
function aliexpress(_html: string, _url: URL, md: PageMetadata): PageMetadata {
  const jsonLd = md.jsonLd.map((o) => (isObj(o) && typeof o.name === 'string' ? { ...o, name: stripAliSuffix(o.name) } : o));
  const product = jsonLd.find((o): o is Obj => isObj(o) && [o['@type']].flat().includes('Product'));
  // The meta description is the same slogan on every page.
  const generic = !md.description || /smarter shopping, better living/i.test(md.description);
  const productDescription = typeof product?.description === 'string' ? product.description.replace(/\s+/g, ' ').trim().slice(0, 2000) : undefined;
  return {
    ...md,
    title: md.title && stripAliSuffix(md.title),
    description: generic ? productDescription || undefined : md.description,
    siteName: 'AliExpress',
    jsonLd,
  };
}

export const aliexpressRule: SiteRule = { host: /(^|\.)aliexpress\.[a-z.]+$/i, apply: aliexpress };
