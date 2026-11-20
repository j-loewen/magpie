import { escapeAttribute, escapeText } from 'entities';

/*
 * Reddit no longer serves its pages to link-preview clients (they get an empty placeholder, and
 * a browser gets a captcha). Its official oEmbed endpoint still describes posts: title, author
 * and subreddit, no image.
 */

const REDDIT = /(^|\.)reddit\.com$/i;

/** "/r/canada/comments/1xyre73/some_title/" and "/user/name/comments/…": a post or comment link. */
const POST_PATH = /^\/(?:(r|u|user)\/([^/]+)\/)?comments\/[a-z0-9]+(?:\/|$)/i;

/** The post as https://www.reddit.com/… without query (tracking) parameters, or undefined. */
export function redditPostUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  if (!REDDIT.test(url.hostname) || !POST_PATH.test(url.pathname)) return undefined;
  // old., new., np., m. and www. all show the same post.
  return `https://www.reddit.com${url.pathname}`;
}

export const redditOembedUrl = (postUrl: string) => `https://www.reddit.com/oembed?url=${encodeURIComponent(postUrl)}`;

interface Oembed {
  title?: unknown;
  author_name?: unknown;
}

/**
 * A minimal HTML page with OpenGraph tags built from the oEmbed answer, so the post goes through
 * the same metadata extraction as any other page. Undefined if the answer has no title.
 */
export function redditPageFromOembed(json: unknown, postUrl: string): string | undefined {
  const data = (typeof json === 'object' && json !== null ? json : {}) as Oembed;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title) return undefined;
  const author = typeof data.author_name === 'string' && data.author_name.trim() ? data.author_name.trim() : undefined;
  const m = POST_PATH.exec(new URL(postUrl).pathname);
  const sub = m?.[1]?.toLowerCase() === 'r' ? m[2] : undefined;
  const description = [author && `u/${author}`, sub && `r/${sub}`].filter(Boolean).join(' in ');
  const meta = (property: string, content: string | undefined) =>
    content ? `<meta property="${property}" content="${escapeAttribute(content)}">` : '';
  return [
    '<!doctype html><html><head>',
    `<title>${escapeText(title)}</title>`,
    meta('og:title', title),
    meta('og:description', description || undefined),
    meta('og:site_name', 'Reddit'),
    meta('og:type', 'article'),
    meta('og:url', postUrl),
    '<link rel="icon" href="https://www.redditstatic.com/shreddit/assets/favicon/64x64.png" sizes="64x64">',
    '</head></html>',
  ].join('');
}
