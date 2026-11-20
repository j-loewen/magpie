import type { PageMetadata } from '../extract';
import { isObj, text, type Obj } from './helpers';

/*
 * Articles on any site: news sites describe them as NewsArticle (or Article, BlogPosting, …)
 * with author and date, but almost never say how long they are. The words of the article's
 * paragraphs are counted here and added as wordCount, so the facts line can show a reading
 * time. A long articleBody in the JSON-LD (some sites embed the whole text) is replaced by its
 * word count rather than stored.
 */

const ARTICLE = /^(\w*NewsArticle|Article|BlogPosting|TechArticle|Report)$/;
/** Fewer words are a teaser (paywall, live blog shell) rather than the article. */
const MIN_WORDS = 200;

const isArticle = (o: unknown): o is Obj => isObj(o) && [o['@type']].flat().some((t) => ARTICLE.test(String(t)));
const countWords = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Words in the paragraphs of the page's <article> (or of the whole page if it has none). */
export function articleWords(html: string): number {
  const articles = [...html.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map((m) => m[0]);
  // The longest <article> is the story; others are teasers for related stories.
  const region = articles.sort((a, b) => b.length - a.length)[0] ?? html;
  let words = 0;
  for (const m of region.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) words += countWords(text(m[1] ?? ''));
  return words;
}

export function enrichArticle(html: string, md: PageMetadata): PageMetadata {
  const index = md.jsonLd.findIndex(isArticle);
  if (index < 0) return md;
  const { articleBody, ...item } = md.jsonLd[index] as Obj;
  const counted = item.wordCount === undefined ? (typeof articleBody === 'string' ? countWords(text(articleBody)) : articleWords(html)) : undefined;
  const enriched: Obj = { ...item, ...(counted !== undefined && counted >= MIN_WORDS && { wordCount: counted }) };
  return { ...md, jsonLd: md.jsonLd.map((o, i) => (i === index ? enriched : o)) };
}
