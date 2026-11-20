import type { PageMetadata } from '../extract';
import { aliexpressRule } from './aliexpress';
import { amazonRule } from './amazon';
import { enrichArticle } from './article';
import { appleMusicRule, applePodcastsRule } from './apple';
import { githubRule } from './github';
import { goodreadsRule } from './goodreads';
import type { SiteRule } from './helpers';
import { imdbRule } from './imdb';
import { spotifyRule } from './spotify';
import { walmartRule } from './walmart';
import { wikipediaRule } from './wikipedia';
import { youtubeRule } from './youtube';

/*
 * Site rules: some big sites put little or nothing into standard metadata (OpenGraph, JSON-LD).
 * A rule reads such a site's own page markup and fills the gaps (cleaner names, data for the
 * facts line on link cards). Rules only add or improve information; they never remove what the
 * generic extraction found. One file per site; article.ts applies to articles on every site.
 * reddit.ts and stackexchange.ts are different: Reddit posts and Stack Overflow questions are not
 * fetched as pages at all but read through the sites' APIs (see LinkPreviews.fetchPage). GitHub repositories get a few more
 * facts from GitHub's API once the page is read (see LinkPreviews.process).
 */

export { parsePrice } from './amazon';
export { githubApiUrl, withGitHubApi } from './github';
export { redditOembedUrl, redditPageFromOembed, redditPostUrl } from './reddit';
export { stackExchangeApiUrl, stackExchangePage, stackExchangeQuestion } from './stackexchange';

const RULES: SiteRule[] = [amazonRule, aliexpressRule, imdbRule, goodreadsRule, youtubeRule, spotifyRule, appleMusicRule, applePodcastsRule, wikipediaRule, githubRule, walmartRule];

/** Improve generic metadata with what we know about specific sites. */
export function applySiteRules(html: string, pageUrl: string, md: PageMetadata): PageMetadata {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return md;
  }
  const rule = RULES.find((r) => r.host.test(url.hostname));
  // Articles on any site get a word count (for the reading time on link cards).
  return enrichArticle(html, rule ? rule.apply(html, url, md) : md);
}

/**
 * Shop pages that build their product data with JavaScript: the page says it is a product
 * (og:type) but its HTML carries no schema.org Product. A real browser (FlareSolverr, when
 * configured) sees the full page, including price and rating.
 */
export function needsBrowser(html: string): boolean {
  const ogType = /<meta[^>]+property\s*=\s*["']og:type["'][^>]*>/i.exec(html)?.[0];
  if (!ogType || !/\scontent\s*=\s*["'](og:)?product\b/i.test(ogType)) return false;
  return !/["']@type["']\s*:\s*\[?\s*["'](Product|ProductGroup)["']/.test(html);
}
