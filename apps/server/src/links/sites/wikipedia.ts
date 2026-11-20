import { decodeHTML } from 'entities';
import type { PageMetadata } from '../extract';
import { isObj, type Obj, type SiteRule } from './helpers';

/*
 * Wikipedia: the JSON-LD names the article and has its short description ("German-born
 * theoretical physicist (1879–1955)", shown as page facts), but the page has no description at
 * all and titles end in "- Wikipedia". The description becomes the article's first paragraph.
 */

const SUPERSCRIPT: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

/**
 * Plain text of a paragraph: footnote markers, pronunciation buttons and formula sources removed,
 * inline tags joined.
 */
function paragraphText(html: string): string {
  const cleaned = html
    .replace(/<sup\b[^>]*\bclass\s*=\s*["'][^"']*\b(reference|noprint)\b[^>]*>[\s\S]*?<\/sup>/gi, '')
    .replace(/<(style|annotation)\b[\s\S]*?<\/\1>/gi, '')
    // Exponents keep reading as such (E = mc², 10⁶ km²).
    .replace(/<sup>(\d+)<\/sup>/gi, (_, d: string) => [...d].map((c) => SUPERSCRIPT[c]).join(''))
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  // "ⓘ" is the label of the audio button after a pronunciation.
  return decodeHTML(cleaned).replace(/\s*ⓘ/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The article's lead paragraph. It names the subject in bold, which tells it apart from what may
 * come first (hatnotes like "For other uses, see …", coordinates, empty paragraphs); without
 * one, the first paragraph of some length.
 */
export function wikipediaLead(html: string): string | undefined {
  const start = html.indexOf('id="mw-content-text"');
  if (start < 0) return undefined;
  // Data attributes (template sources, widget settings) can hold markup of their own.
  const content = html.slice(start).replace(/\sdata-[\w-]+\s*=\s*('[^']*'|"[^"]*")/gi, '');
  const paragraphs = [...content.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .slice(0, 12)
    .map((m) => ({ bold: /<b\b/i.test(m[1] ?? ''), text: paragraphText(m[1] ?? '') }))
    .filter((p) => p.text.length >= 40);
  const lead = paragraphs.find((p) => p.bold) ?? paragraphs[0];
  return lead?.text.slice(0, 2000);
}

function wikipedia(html: string, _url: URL, md: PageMetadata): PageMetadata {
  const article = md.jsonLd.find((o) => isObj(o) && [o['@type']].flat().includes('Article')) as Obj | undefined;
  const name = typeof article?.name === 'string' ? article.name.trim() : undefined;
  return {
    ...md,
    title: name || md.title?.replace(/\s+[-–—]\s+Wikipedia$/i, ''),
    // Only articles: other pages (missing article, search, special pages) have no lead.
    description: md.description || (article ? wikipediaLead(html) : undefined),
    siteName: 'Wikipedia',
  };
}

export const wikipediaRule: SiteRule = { host: /(^|\.)wikipedia\.org$/i, apply: wikipedia };
