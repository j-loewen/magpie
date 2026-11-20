import type { PageMetadata } from '../extract';
import { attr, embeddedString, isObj, type Obj, type SiteRule } from './helpers';

/** userInteractionCount of the microdata block for this action (WatchAction, LikeAction). */
function interactionCount(html: string, action: string): number | undefined {
  const m = new RegExp(`itemprop="interactionType"\\s+content="https?://schema\\.org/${action}"\\s*/?>\\s*<meta\\s+itemprop="userInteractionCount"\\s+content="(\\d+)"`, 'i').exec(html);
  return m ? Number(m[1]) : undefined;
}

/**
 * YouTube's VideoObject JSON-LD has only name, thumbnail and upload date. Length, channel,
 * views, likes and category are in the page's microdata and player data; they are added to it.
 */
function youtube(html: string, _url: URL, md: PageMetadata): PageMetadata {
  const index = md.jsonLd.findIndex((o) => isObj(o) && [o['@type']].flat().includes('VideoObject'));
  if (index < 0) return md;
  const video = md.jsonLd[index] as Obj;
  const duration = attr(/<meta[^>]+itemprop="duration"[^>]*>/i.exec(html)?.[0], 'content');
  // The channel: the first name inside the author block.
  const channelTag = /itemprop="author"[\s\S]{0,400}?(<link[^>]+itemprop="name"[^>]*>)/i.exec(html)?.[1];
  const channel = attr(channelTag, 'content')?.trim() || embeddedString(html, 'ownerChannelName');
  const viewsRaw = embeddedString(html, 'viewCount');
  const views = viewsRaw && /^\d+$/.test(viewsRaw) ? Number(viewsRaw) : interactionCount(html, 'WatchAction');
  const likes = interactionCount(html, 'LikeAction');
  const category = embeddedString(html, 'category');
  const stats = [
    ...(views !== undefined ? [{ '@type': 'InteractionCounter', interactionType: 'https://schema.org/WatchAction', userInteractionCount: views }] : []),
    ...(likes !== undefined ? [{ '@type': 'InteractionCounter', interactionType: 'https://schema.org/LikeAction', userInteractionCount: likes }] : []),
  ];
  const enriched: Obj = {
    ...video,
    ...(video.duration === undefined && duration && { duration }),
    ...(video.author === undefined && channel && { author: { '@type': 'Person', name: channel } }),
    ...(video.interactionStatistic === undefined && stats.length > 0 && { interactionStatistic: stats }),
    ...(video.genre === undefined && category && { genre: category }),
  };
  return { ...md, jsonLd: md.jsonLd.map((o, i) => (i === index ? enriched : o)) };
}

export const youtubeRule: SiteRule = { host: /(^|\.)youtube\.com$/i, apply: youtube };
