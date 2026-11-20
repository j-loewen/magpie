import type { PageMetadata } from '../extract';
import { isObj, type Obj, type SiteRule } from './helpers';

/*
 * Walmart (walmart.ca, walmart.com): product pages have complete schema.org Product data (price,
 * rating), but titles end in "- Walmart.ca" and the description is a sales line ("Buy … from
 * Walmart Canada. Shop for more … at Walmart.ca"). The pages are behind PerimeterX's "press and
 * hold" check, so they usually arrive through FlareSolverr.
 */

/** Walmart's generic product description: says nothing the title does not. */
const SALES_LINE = /^Buy .+ (?:from|at) Walmart/i;

function walmart(_html: string, _url: URL, md: PageMetadata): PageMetadata {
  const product = md.jsonLd.find((o): o is Obj => isObj(o) && [o['@type']].flat().some((t) => t === 'Product' || t === 'ProductGroup'));
  const name = typeof product?.name === 'string' ? product.name.replace(/\s+/g, ' ').trim() : '';
  const own = typeof product?.description === 'string' ? product.description.replace(/\s+/g, ' ').trim() : '';
  // The product's own description, unless it only repeats the name.
  const description = md.description && SALES_LINE.test(md.description) ? (own && own.toLowerCase() !== name.toLowerCase() ? own : undefined) : md.description;
  return {
    ...md,
    title: name || md.title?.replace(/\s+-\s+Walmart\.(ca|com)$/i, ''),
    description,
    siteName: 'Walmart',
  };
}

export const walmartRule: SiteRule = { host: /(^|\.)walmart\.(com|ca)$/i, apply: walmart };
