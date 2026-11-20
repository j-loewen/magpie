import type { PageMetadata } from '../extract';
import { isObj, metaContent, type Obj, type SiteRule } from './helpers';

/** A JSON-LD description without the site's "Listen to … on Spotify." lead-in. */
const withoutSpotifyLead = (v: unknown) =>
  typeof v === 'string' ? v.replace(/^Listen to (?:this episode from )?.+? on Spotify\.\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 2000) || undefined : undefined;

/**
 * Spotify podcasts. Episodes: JSON-LD has name and date; the show and length are in the
 * og:description ("The Joe Rogan Experience · Episode") and music:duration. Shows: the host is
 * in the JSON-LD. The description becomes the episode's or show's own summary.
 */
function spotifyPodcast(html: string, md: PageMetadata): PageMetadata | undefined {
  const index = md.jsonLd.findIndex((o) => isObj(o) && [o['@type']].flat().some((t) => t === 'PodcastEpisode' || t === 'PodcastSeries'));
  if (index < 0) return undefined;
  const item = md.jsonLd[index] as Obj;
  let enriched = item;
  if ([item['@type']].flat().includes('PodcastEpisode')) {
    const show = /^(.+?) · Episode$/.exec(md.description ?? '')?.[1]?.trim();
    const seconds = Number(metaContent(html, 'music:duration'));
    enriched = {
      ...item,
      ...(item.partOfSeries === undefined && show && { partOfSeries: { '@type': 'PodcastSeries', name: show } }),
      ...(item.duration === undefined && seconds > 0 && { duration: `PT${Math.round(seconds)}S` }),
    };
  }
  return {
    ...md,
    description: withoutSpotifyLead(item.description) ?? md.description,
    jsonLd: md.jsonLd.map((o, i) => (i === index ? enriched : o)),
  };
}

/**
 * Spotify's JSON-LD names the song or album and its release date. Artist, album, length,
 * release type and number of songs are in its music:* meta tags and the og:description
 * ("Rick Astley · Whenever You Need Somebody · Song · 1987", "Rick Astley · single · 1987 · 10 songs").
 * They are added to the JSON-LD item; the description, which only repeated them, is dropped.
 */
function spotify(html: string, _url: URL, md: PageMetadata): PageMetadata {
  const podcast = spotifyPodcast(html, md);
  if (podcast) return podcast;
  const index = md.jsonLd.findIndex((o) => isObj(o) && [o['@type']].flat().some((t) => t === 'MusicRecording' || t === 'MusicAlbum'));
  if (index < 0) return md;
  const item = md.jsonLd[index] as Obj;
  const parts = (md.description ?? '').split(' · ').map((p) => p.trim());
  const artistName = metaContent(html, 'music:musician_description') ?? parts[0];
  const artist = artistName ? { byArtist: { '@type': 'MusicGroup', name: artistName } } : {};
  let enriched: Obj;
  if ([item['@type']].flat().includes('MusicRecording')) {
    const seconds = Number(metaContent(html, 'music:duration'));
    // "Artist · Album · Song · Year": the album is the part before "Song".
    const songAt = parts.findIndex((p) => /^song$/i.test(p));
    const album = songAt > 1 ? parts[songAt - 1] : undefined;
    enriched = {
      ...item,
      ...(item.byArtist === undefined && artist),
      ...(item.inAlbum === undefined && album && { inAlbum: { '@type': 'MusicAlbum', name: album } }),
      ...(item.duration === undefined && seconds > 0 && { duration: `PT${Math.round(seconds)}S` }),
    };
  } else {
    // "Artist · single · 1987 · 10 songs"
    const releaseType = parts.find((p) => /^(album|single|ep|compilation)$/i.test(p));
    const songs = Number(/^(\d+) songs?$/i.exec(parts.find((p) => /songs?$/i.test(p)) ?? '')?.[1]) || (html.match(/<meta[^>]+name="music:song"/gi)?.length ?? 0);
    enriched = {
      ...item,
      ...(item.byArtist === undefined && artist),
      ...(item.albumReleaseType === undefined && releaseType && { albumReleaseType: releaseType }),
      ...(item.numTracks === undefined && songs > 0 && { numTracks: songs }),
    };
  }
  const name = typeof item.name === 'string' ? item.name.trim() : undefined;
  return {
    ...md,
    // Album pages are titled "Listen to <album> - Single by <artist> | Spotify".
    title: name || md.title,
    description: artistName ? undefined : md.description,
    jsonLd: md.jsonLd.map((o, i) => (i === index ? enriched : o)),
  };
}

export const spotifyRule: SiteRule = { host: /(^|\.)spotify\.com$/i, apply: spotify };
