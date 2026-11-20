import type { PageMetadata } from '../extract';
import { embeddedObject, isObj, text, type Obj, type SiteRule } from './helpers';

/*
 * GitHub repositories: no JSON-LD, titles like "GitHub - react/react: The library for web and
 * native user interfaces." and a description that ends in "Contribute to react/react development
 * by creating an account on GitHub.". The page's embedded data ("sidebarAboutData") has the
 * repository's description, stars, forks, license, topics and whether it is archived; they become
 * a schema.org SoftwareSourceCode item for the facts line. The language and the last push are not
 * in the page; they come from GitHub's API (see withGitHubApi).
 */

const isRepoItem = (o: unknown): o is Obj => isObj(o) && [o['@type']].flat().includes('SoftwareSourceCode');

const counter = (type: string, count: unknown) =>
  typeof count === 'number' ? [{ '@type': 'InteractionCounter', interactionType: `https://schema.org/${type}`, userInteractionCount: count }] : [];

/**
 * The description as shown on GitHub: emoji codes (":rocket:") are already turned into emoji;
 * GitHub's own image emoji (":atom:") are left out.
 */
function repoDescription(about: Obj): string {
  const formatted = typeof about.formattedDescription === 'string' ? about.formattedDescription : undefined;
  const plain = formatted !== undefined ? text(formatted.replace(/<img\b[^>]*>/gi, '')) : typeof about.description === 'string' ? about.description : '';
  return plain.replace(/\s+/g, ' ').trim();
}

function github(html: string, _url: URL, md: PageMetadata): PageMetadata {
  const about = embeddedObject(html, 'sidebarAboutData');
  if (!about || typeof about.ownerLogin !== 'string' || typeof about.repoName !== 'string') {
    return { ...md, siteName: 'GitHub' };
  }
  const nwo = `${about.ownerLogin}/${about.repoName}`;
  const repo = isObj(about.repo) ? about.repo : {};
  const license = isObj(repo.license) ? repo.license : undefined;
  const description = repoDescription(about);
  const topics = Array.isArray(about.topics) ? about.topics.map((t) => (isObj(t) ? t.name : undefined)).filter((t): t is string => typeof t === 'string') : [];
  const item: Obj = {
    '@type': 'SoftwareSourceCode',
    name: nwo,
    codeRepository: `https://github.com/${nwo}`,
    ...(description && { description }),
    ...(typeof about.website === 'string' && about.website && { url: about.website }),
    // "NOASSERTION": a license GitHub could not identify ("Other").
    ...(license && typeof license.spdxId === 'string' && license.spdxId !== 'NOASSERTION' && { license: license.spdxId }),
    ...(topics.length > 0 && { keywords: topics }),
    // Stars (people who like it) and forks (copies people made to work on).
    interactionStatistic: [...counter('LikeAction', about.stargazerCount), ...counter('ShareAction', about.forksCount)],
    ...(repo.isArchived === true && { creativeWorkStatus: 'Archived' }),
  };
  return {
    ...md,
    title: nwo,
    // The repository's own description, without GitHub's "Contribute to … on GitHub." line.
    description: description || undefined,
    siteName: 'GitHub',
    jsonLd: [...md.jsonLd, item],
  };
}

export const githubRule: SiteRule = { host: /^(www\.)?github\.com$/i, apply: github };

/** GitHub API address of the repository a page's metadata describes, if any. */
export function githubApiUrl(md: PageMetadata): string | undefined {
  const repo = md.jsonLd.find(isRepoItem);
  const nwo = typeof repo?.codeRepository === 'string' ? /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)$/.exec(repo.codeRepository)?.[1] : undefined;
  return nwo ? `https://api.github.com/repos/${nwo}` : undefined;
}

/** Adds what GitHub's API knows and the page does not: the main language and the last push. */
export function withGitHubApi(md: PageMetadata, api: unknown): PageMetadata {
  if (!isObj(api)) return md;
  return {
    ...md,
    jsonLd: md.jsonLd.map((o) =>
      isRepoItem(o)
        ? {
            ...o,
            ...(typeof api.language === 'string' && api.language && { programmingLanguage: api.language }),
            ...(typeof api.pushed_at === 'string' && { dateModified: api.pushed_at }),
          }
        : o,
    ),
  };
}
