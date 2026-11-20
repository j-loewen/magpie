import { parseHttpUrl } from '@notes/note-types';

/** What the share sheet passes (manifest `share_target` params). */
export type ShareTargetSearch = { title?: string; text?: string; url?: string };

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;

/** First web address in a piece of text, without trailing punctuation. */
function findUrl(text: string | undefined): string | undefined {
  const match = text && URL_IN_TEXT.exec(text)?.[0].replace(/[).,;:!?\]]+$/, '');
  return match && parseHttpUrl(match) ? match : undefined;
}

/**
 * Decides what to make of a share: a link note when it contains a web address (most apps put
 * it in `text`, not `url`), otherwise a text note. The note is created in Home and saves as soon
 * as it has a name (for links, the page title is looked up when none was shared).
 */
export function planShare(shared: ShareTargetSearch): { type: 'link' | 'text'; title?: string; url?: string; text?: string } {
  const title = shared.title?.trim() || undefined;
  const text = shared.text?.trim() || undefined;
  const url = (shared.url && parseHttpUrl(shared.url) ? shared.url.trim() : undefined) ?? findUrl(text) ?? findUrl(title);
  if (url) {
    // Whatever else came with the address ("Look at this: https://…") becomes the description.
    // Separators left around the removed address ("Look at this: ", " - ", a final ".") go too.
    const rest = text?.replace(url, '').replace(/^[\s:|.,;–—-]+|[\s:|.,;–—-]+$/g, '');
    const cleanTitle = title && title !== url ? title : undefined;
    return { type: 'link', url, title: cleanTitle, text: rest && rest !== cleanTitle ? rest : undefined };
  }
  const firstLine = text?.split('\n')[0]?.trim().slice(0, 120);
  return { type: 'text', title: title ?? firstLine, text };
}
