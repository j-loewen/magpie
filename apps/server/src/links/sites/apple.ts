import type { PageMetadata } from '../extract';
import { embeddedNumber, embeddedString, isObj, metaContent, type Obj, type SiteRule } from './helpers';

/*
 * Apple Music and Apple Podcasts: complete JSON-LD, but titles like "Breathe (In the Air) by Pink
 * Floyd on Apple Music" and descriptions that are only a summary line. The plain name is in
 * apple:title.
 */

/**
 * Apple Music's JSON-LD is complete (artist, album, songs with lengths, genres), but the titles
 * read "Breathe (In the Air) by Pink Floyd on Apple Music" and the description ("Album · 1973 ·
 * 10 Songs") only repeats the facts. The plain name is in apple:title; the release type (Album,
 * Single, EP) is added to the album from the description.
 */
function appleMusic(html: string, _url: URL, md: PageMetadata): PageMetadata {
  const index = md.jsonLd.findIndex((o) => isObj(o) && [o['@type']].flat().some((t) => t === 'MusicAlbum' || t === 'MusicComposition' || t === 'MusicRecording'));
  if (index < 0) {
    // Artists, playlists, …: only the name and site name are tidied ("Pink Floyd on Apple Music").
    return { ...md, title: metaContent(html, 'apple:title') ?? md.title?.replace(/ on Apple Music$/i, ''), siteName: 'Apple Music' };
  }
  const item = md.jsonLd[index] as Obj;
  const releaseType = /^(album|single|ep|compilation)\b/i.exec(md.description ?? '')?.[1];
  const enriched: Obj =
    [item['@type']].flat().includes('MusicAlbum') && item.albumReleaseType === undefined && releaseType ? { ...item, albumReleaseType: releaseType } : item;
  const name = metaContent(html, 'apple:title') ?? (typeof item.name === 'string' ? item.name.trim() : undefined);
  return {
    ...md,
    title: name || md.title,
    description: undefined,
    siteName: 'Apple Music',
    jsonLd: md.jsonLd.map((o, i) => (i === index ? enriched : o)),
  };
}

/**
 * Apple Podcasts: shows are a CreativeWorkSeries (marked as PodcastSeries here), with the
 * publisher and episode count only in the page's embedded data ("provider", "trackCount").
 * The og:description is a summary line ("Podcast Episode · The Daily · November 18 · 26m");
 * the JSON-LD description is the real one.
 */
function applePodcasts(html: string, _url: URL, md: PageMetadata): PageMetadata {
  const index = md.jsonLd.findIndex((o) => isObj(o) && [o['@type']].flat().some((t) => t === 'PodcastEpisode' || t === 'CreativeWorkSeries' || t === 'PodcastSeries'));
  if (index < 0) return md;
  const item = md.jsonLd[index] as Obj;
  let enriched = item;
  if (![item['@type']].flat().includes('PodcastEpisode')) {
    const provider = embeddedString(html, 'provider');
    const episodes = embeddedNumber(html, 'trackCount');
    enriched = {
      ...item,
      '@type': [...new Set([...[item['@type']].flat(), 'PodcastSeries'])],
      ...(item.author === undefined && provider && { author: { '@type': 'Organization', name: provider } }),
      ...(item.numberOfEpisodes === undefined && episodes && { numberOfEpisodes: episodes }),
    };
  }
  const description = typeof item.description === 'string' ? item.description.replace(/\s+/g, ' ').trim().slice(0, 2000) : undefined;
  return {
    ...md,
    title: metaContent(html, 'apple:title') ?? md.title,
    description: description || md.description,
    jsonLd: md.jsonLd.map((o, i) => (i === index ? enriched : o)),
  };
}

export const appleMusicRule: SiteRule = { host: /^music\.apple\.com$/i, apply: appleMusic };
export const applePodcastsRule: SiteRule = { host: /^podcasts\.apple\.com$/i, apply: applePodcasts };
