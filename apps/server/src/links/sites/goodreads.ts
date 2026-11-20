import { decodeHTML } from 'entities';
import type { PageMetadata } from '../extract';
import { isObj, text, type Obj, type SiteRule } from './helpers';

/**
 * Goodreads' Book JSON-LD has authors, pages and rating, but not when the book came out or its
 * genres. Both are on the page ("First published September 21, 1937", genre buttons) and are
 * added to the Book item, so the facts line can show them.
 */
function goodreads(html: string, _url: URL, md: PageMetadata): PageMetadata {
  const index = md.jsonLd.findIndex((o) => isObj(o) && [o['@type']].flat().includes('Book'));
  if (index < 0) return md;
  const book = md.jsonLd[index] as Obj;
  const published = /data-testid\s*=\s*["']publicationInfo["'][^>]*>([^<]+)</i.exec(html)?.[1];
  const year = published ? /\b(\d{4})\b/.exec(decodeHTML(published))?.[1] : undefined;
  const genresRegion = /data-testid\s*=\s*["']genresList["'][\s\S]{0,4000}/i.exec(html)?.[0];
  const genres = genresRegion
    ? [...genresRegion.matchAll(/class\s*=\s*["']Button__labelItem["'][^>]*>([^<]+)</gi)].map((m) => text(m[1] ?? '')).filter((g) => g && !/^\.\.\.|more$/i.test(g))
    : [];
  const enriched: Obj = {
    ...book,
    ...(book.datePublished === undefined && year && { datePublished: year }),
    ...(book.genre === undefined && genres.length > 0 && { genre: genres.slice(0, 5) }),
  };
  return { ...md, jsonLd: md.jsonLd.map((o, i) => (i === index ? enriched : o)) };
}

export const goodreadsRule: SiteRule = { host: /(^|\.)goodreads\.com$/i, apply: goodreads };
