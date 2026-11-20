import type { PageMetadata } from '../extract';
import { isObj, type Obj, type SiteRule } from './helpers';

const MEDIA_TYPES = new Set(['Movie', 'TVSeries', 'TVMiniSeries', 'TVEpisode', 'TVSeason', 'VideoGame', 'CreativeWork']);

/**
 * IMDb's og:title packs rating and genres into the name ("Project Hail Mary (2026) ⭐ 8.2 |
 * Adventure, Comedy") and og:description holds only "2h 36m | PG". The JSON-LD has the plain
 * name and the plot; rating and genres are shown from it as page facts.
 */
function imdb(_html: string, _url: URL, md: PageMetadata): PageMetadata {
  const main = md.jsonLd.find((o): o is Obj => isObj(o) && [o['@type']].flat().some((t) => MEDIA_TYPES.has(String(t))));
  const name = typeof main?.name === 'string' ? main.name.trim() : undefined;
  const date = [main?.datePublished, main?.startDate].find((d): d is string => typeof d === 'string');
  const year = date ? /^\d{4}/.exec(date)?.[0] : undefined;
  const plot = typeof main?.description === 'string' ? main.description.replace(/\s+/g, ' ').trim().slice(0, 2000) : undefined;
  return {
    ...md,
    title: name ? (year ? `${name} (${year})` : name) : md.title?.replace(/\s*⭐.*$/u, ''),
    description: plot || md.description,
    siteName: 'IMDb',
  };
}

export const imdbRule: SiteRule = { host: /(^|\.)imdb\.com$/i, apply: imdb };
