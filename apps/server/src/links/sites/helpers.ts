import { decodeHTML } from 'entities';
import type { PageMetadata } from '../extract';

/** A site rule: improves the generic metadata of pages on the hosts it matches. */
export interface SiteRule {
  host: RegExp;
  apply(html: string, url: URL, md: PageMetadata): PageMetadata;
}

export type Obj = Record<string, unknown>;
export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A name made from the words in a page's address ("/en/ip/WD-Red-Plus-Hard-drive/30LWQC75P0D4"
 * → "WD Red Plus Hard drive"), for pages that refuse to be fetched. Shops and blogs put the
 * product or article name in the path; IDs, locales ("en-ca") and short paths are skipped.
 * Undefined if no part of the path reads like a name.
 */
export function titleFromUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  // The name is usually the last such segment (often followed by an ID).
  for (const raw of url.pathname.split('/').filter(Boolean).reverse()) {
    let segment = raw;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      // Keep the segment as it is.
    }
    segment = segment.replace(/\.(s?html?|php|aspx?|jsp)$/i, '');
    const words = segment.split(/[-_+\s]+/).filter(Boolean);
    if (words.length < 3 || words.filter((w) => /^\p{L}{2,}$/u.test(w)).length < 2) continue;
    const name = words.join(' ').slice(0, 200).trim();
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return undefined;
}

/** Plain text of a piece of markup (tags removed, entities decoded, whitespace collapsed). */
export const text = (html: string) => decodeHTML(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Attribute value of a tag (entities decoded). */
export function attr(tag: string | undefined, name: string): string | undefined {
  if (!tag) return undefined;
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeHTML(m[2] ?? m[3] ?? '') : undefined;
}

/** The opening tag of the element with this id. */
export const tagWithId = (html: string, id: string) => new RegExp(`<[a-z][^>]*\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'i').exec(html)?.[0];

/** Markup starting at the element with this id (a window large enough for nested content). */
export function regionOf(html: string, id: string, size = 6000): string | undefined {
  const m = new RegExp(`\\sid\\s*=\\s*["']${id}["']`, 'i').exec(html);
  return m ? html.slice(m.index, m.index + size) : undefined;
}

/** content of <meta name|property="…">, entities decoded. */
export const metaContent = (html: string, name: string) =>
  attr(new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${name.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i').exec(html)?.[0], 'content')?.trim() || undefined;

/** A string value from data embedded in the page as JSON ("category":"Film \u0026 Animation"). */
export function embeddedString(html: string, key: string): string | undefined {
  const raw = new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`).exec(html)?.[1];
  if (raw === undefined) return undefined;
  try {
    return (JSON.parse(`"${raw}"`) as string).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** An object from data embedded in the page as JSON ("sidebarAboutData":{…}), nested objects included. */
export function embeddedObject(html: string, key: string): Obj | undefined {
  const at = html.indexOf(`"${key}":{`);
  if (at < 0) return undefined;
  const start = at + key.length + 3;
  // Find the matching closing brace, skipping braces inside strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length && i < start + 200_000; i++) {
    const c = html[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        const value: unknown = JSON.parse(html.slice(start, i + 1));
        return isObj(value) ? value : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** A number from data embedded in the page as JSON ("trackCount":549). */
export const embeddedNumber = (html: string, key: string) => {
  const m = new RegExp(`"${key}":(\\d+)`).exec(html);
  return m ? Number(m[1]) : undefined;
};
