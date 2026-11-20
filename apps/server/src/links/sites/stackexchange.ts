import { decodeHTML, escapeAttribute, escapeText } from 'entities';
import { isObj } from './helpers';

/*
 * Stack Overflow and the other Stack Exchange sites (Super User, Ask Ubuntu, Server Fault,
 * *.stackexchange.com, …) show link-preview clients a Cloudflare challenge. Their public API
 * describes questions completely: votes, answers, accepted answer, views, tags, asker and text.
 * A question becomes a small page built from the API answer (like Reddit posts, see reddit.ts),
 * with the facts as a schema.org QAPage. Without an API key the API allows 300 requests a day.
 */

const HOSTS = /^(?:(?:[a-z]{2}\.)?stackoverflow\.com|superuser\.com|serverfault\.com|askubuntu\.com|mathoverflow\.net|stackapps\.com|(?:[a-z0-9-]+\.){1,2}stackexchange\.com)$/i;

/** "/questions/927358/how-do-i-…" and share links "/q/927358/89904". */
const QUESTION_PATH = /^\/(?:questions|q)\/(\d+)(?:\/|$)/;

export interface StackExchangeQuestion {
  /** The site's domain (also its name in the API), e.g. "stackoverflow.com". */
  site: string;
  id: string;
  /** https://<site>/questions/<id> */
  url: string;
}

/** The Stack Exchange question a link points at, or undefined. */
export function stackExchangeQuestion(input: string): StackExchangeQuestion | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }
  const site = url.hostname.toLowerCase().replace(/^www\./, '');
  const id = QUESTION_PATH.exec(url.pathname)?.[1];
  if (!id || !HOSTS.test(site)) return undefined;
  return { site, id, url: `https://${site}/questions/${id}` };
}

export const stackExchangeApiUrl = (q: StackExchangeQuestion) =>
  `https://api.stackexchange.com/2.3/questions/${q.id}?site=${encodeURIComponent(q.site)}&filter=withbody`;

const SITE_NAMES: Record<string, string> = {
  'stackoverflow.com': 'Stack Overflow',
  'superuser.com': 'Super User',
  'serverfault.com': 'Server Fault',
  'askubuntu.com': 'Ask Ubuntu',
  'mathoverflow.net': 'MathOverflow',
  'stackapps.com': 'Stack Apps',
};

/** "Stack Overflow", "Unix & Linux"-style names are not in the answer; the domain gives a good one. */
function siteName(site: string): string {
  const known = SITE_NAMES[site];
  if (known) return known;
  const so = /^([a-z]{2})\.stackoverflow\.com$/.exec(site);
  if (so) return `Stack Overflow (${so[1]})`;
  const sub = site.replace(/\.stackexchange\.com$/, '').split('.').reverse().join(' ');
  return `${sub.charAt(0).toUpperCase()}${sub.slice(1)} Stack Exchange`;
}

/** The site's short name in Stack Exchange's file paths ("stackoverflow", "math", "ru"). */
const shortName = (site: string) => site.replace(/\.(stackexchange|stackoverflow)\.com$/, '').replace(/\.(com|net)$/, '');

const isoDate = (seconds: unknown) => (typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : undefined);

/** The question's text for the description: prose only (code blocks left out), one paragraph. */
function questionText(body: unknown): string | undefined {
  if (typeof body !== 'string') return undefined;
  const flat = body
    .replace(/<pre\b[\s\S]*?<\/pre>/gi, ' … ')
    // Blocks are separated by a space; inline markup (<code>, <em>, links) joins its text.
    .replace(/<\/?(?:p|li|ul|ol|h\d|blockquote|div|table|tr|td|th)\b[^>]*>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  const prose = decodeHTML(flat).replace(/\s+/g, ' ').replace(/( … ?)+/g, ' … ').replace(/^\s*…\s*|\s*…\s*$/g, '').trim();
  return prose.slice(0, 2000) || undefined;
}

/**
 * A minimal HTML page for the question: OpenGraph tags and a schema.org QAPage with the facts,
 * so it goes through the same metadata extraction as any other page. Undefined if the answer
 * has no such question (deleted, wrong site).
 */
export function stackExchangePage(json: unknown, q: StackExchangeQuestion): string | undefined {
  const item = isObj(json) && Array.isArray(json.items) ? json.items.find(isObj) : undefined;
  // Titles come HTML-escaped ("How do I use &quot;git reset&quot;?").
  const title = typeof item?.title === 'string' ? decodeHTML(item.title).trim() : '';
  if (!item || !title) return undefined;
  const owner = isObj(item.owner) && typeof item.owner.display_name === 'string' ? decodeHTML(item.owner.display_name) : undefined;
  const tags = Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === 'string') : [];
  const description = questionText(item.body);
  const name = siteName(q.site);
  const question = {
    '@type': 'Question',
    name: title,
    ...(description && { text: description }),
    ...(typeof item.answer_count === 'number' && { answerCount: item.answer_count }),
    ...(typeof item.score === 'number' && { upvoteCount: item.score }),
    ...(isoDate(item.creation_date) && { dateCreated: isoDate(item.creation_date) }),
    ...(owner && { author: { '@type': 'Person', name: owner } }),
    ...(tags.length > 0 && { keywords: tags }),
    ...(typeof item.accepted_answer_id === 'number' && { acceptedAnswer: { '@type': 'Answer', url: `https://${q.site}/a/${item.accepted_answer_id}` } }),
    ...(typeof item.view_count === 'number' && {
      interactionStatistic: { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ViewAction', userInteractionCount: item.view_count },
    }),
    // "Duplicate", "Needs more focus", …
    ...(typeof item.closed_reason === 'string' && { creativeWorkStatus: `Closed: ${decodeHTML(item.closed_reason)}` }),
  };
  const ld = { '@context': 'https://schema.org', '@type': 'QAPage', mainEntity: question };
  const meta = (property: string, content: string | undefined) => (content ? `<meta property="${property}" content="${escapeAttribute(content)}">` : '');
  return [
    '<!doctype html><html><head>',
    `<title>${escapeText(title)}</title>`,
    meta('og:title', title),
    meta('og:description', description),
    meta('og:site_name', name),
    meta('og:url', q.url),
    `<link rel="icon" href="https://cdn.sstatic.net/Sites/${shortName(q.site)}/Img/favicon.ico">`,
    // JSON in a script: "</" must not end the script early.
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/<\//g, '<\\/')}</script>`,
    '</head></html>',
  ].join('');
}
