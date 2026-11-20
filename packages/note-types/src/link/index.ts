import { z } from 'zod';
import { defineNoteType, NoteContentError } from '../define';

export const linkType = defineNoteType({
  id: 'link',
  label: 'Link',
  description: 'Bookmark a web page with preview',
  version: 1,
  schema: z.object({
    /** May be empty or invalid while the user is typing; only valid http(s) URLs are fetched. */
    url: z.string().max(2048),
    /** The user's own notes about the link. */
    description: z.string().max(100_000),
  }),
  createDefault: () => ({ url: '', description: '' }),
  missing: (c) => (parseHttpUrl(c.url) ? undefined : 'Enter a web address'),
  toSearchText: (c) => [c.url, c.description].filter(Boolean).join('\n'),
  toFile: (c, title) => ({
    ext: 'md',
    text: [`# ${title.trim() || c.url || 'Link'}`, c.url && `<${c.url}>`, c.description].filter(Boolean).join('\n\n') + '\n',
  }),
  fromShared: (s) => ({ url: s.url ?? '', description: s.text ?? '' }),
  // Windows internet shortcuts and macOS .webloc files.
  importExtensions: ['url', 'webloc'],
  fromFile: (text, ext) => {
    const raw = ext === 'url' ? /^URL=(.+)$/im.exec(text)?.[1] : /<string>([^<]+)<\/string>/i.exec(text)?.[1];
    const url = raw && parseHttpUrl(raw.replace(/&amp;/g, '&'));
    if (!url) throw new NoteContentError('No web address found');
    return { url: url.toString(), description: '' };
  },
});

export type LinkContent = { url: string; description: string };

/** Returns a normalised http(s) URL, or null if the input is not one. */
export function parseHttpUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
