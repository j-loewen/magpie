import type { PageMetadata } from '../extract';
import { parsePrice } from './amazon';
import { attr, isObj, text, type Obj, type SiteRule } from './helpers';

/*
 * Manitoba Liquor Marts (liquormarts.ca, Drupal Commerce): product pages have no JSON-LD and no
 * og:image or description, only og:type "product" and an upper-case og:title. Name, size, image,
 * price, tasting notes, item number, UPC and category are read from the page markup, and a
 * Product is added for the facts line. The size (each size is its own page) goes into the title.
 */

/** Markup starting at the first element with this class (a window large enough for its content). */
function regionWithClass(html: string, cls: string, size = 3000): string | undefined {
  const m = new RegExp(`class\\s*=\\s*["'][^"']*\\b${cls}\\b[^"']*["']`, 'i').exec(html);
  return m ? html.slice(m.index, m.index + size) : undefined;
}

/** Plain text of a region (which starts inside an opening tag), up to the first `end` tag. */
function textUntil(region: string | undefined, end: string): string | undefined {
  if (!region) return undefined;
  const inner = region.slice(region.indexOf('>') + 1);
  const at = inner.indexOf(end);
  return text(at < 0 ? inner : inner.slice(0, at)) || undefined;
}

function liquormarts(html: string, url: URL, md: PageMetadata): PageMetadata {
  const imageRegion = regionWithClass(html, 'field--name-field-product-image-front');
  const imgTag = imageRegion && /<img\b[^>]*>/i.exec(imageRegion)?.[0];
  // Upper-case in og:title; the product image's alt text has the name as it is written.
  const name = attr(imgTag, 'alt')?.trim() || md.title;
  const imagePath = attr(imgTag, 'data-original') ?? attr(imgTag, 'data-src');
  const image = imagePath ? new URL(imagePath, url).toString() : undefined;

  // "Item # 7246 | UPC 776029701876 | 15 x 355 ml"
  const details = textUntil(regionWithClass(html, 'product_basic_details', 600), '</p>') ?? '';
  const sku = /Item #\s*(\d+)/i.exec(details)?.[1];
  const gtin = /UPC\s*(\d{8,14})/i.exec(details)?.[1];
  const size = /\|\s*([^|]*\d[^|]*\b(?:ml|l|oz)\b)\s*$/i.exec(details)?.[1]?.trim();

  const priceText = textUntil(regionWithClass(html, 'product_price', 200), '</');
  const price = priceText ? parsePrice(priceText) : undefined;
  const notes = textUntil(regionWithClass(html, 'field--name-field-tasting-notes', 4000), '</div>');
  // "Beer > Lager > Pale": links and separators inside one field item.
  const category = textUntil(regionWithClass(html, 'field--name-field-category-type', 1500), '</div>');

  const product: Obj = {
    '@type': 'Product',
    ...(name && { name }),
    ...(image && { image }),
    ...(sku && { sku }),
    ...(gtin && { gtin }),
    ...(size && { size }),
    ...(category && { category }),
    ...(notes && { description: notes }),
    ...(price && { offers: { '@type': 'Offer', price, priceCurrency: 'CAD' } }),
  };
  const hasProduct = md.jsonLd.some((o) => isObj(o) && [o['@type']].flat().includes('Product'));

  return {
    ...md,
    title: name && size ? `${name} (${size})` : name,
    description: md.description ?? notes?.slice(0, 2000),
    image: md.image ?? image,
    jsonLd: !hasProduct && name ? [...md.jsonLd, product] : md.jsonLd,
  };
}

export const liquormartsRule: SiteRule = { host: /(^|\.)liquormarts\.ca$/i, apply: liquormarts };
