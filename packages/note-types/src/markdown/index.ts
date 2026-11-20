import { z } from 'zod';
import { defineNoteType } from '../define';

export const markdownType = defineNoteType({
  id: 'markdown',
  label: 'Markdown',
  description: 'Formatted text with live preview',
  version: 1,
  schema: z.object({ markdown: z.string().max(2_000_000) }),
  createDefault: () => ({ markdown: '' }),
  // Drop the most common markup characters so search snippets read like text.
  toSearchText: (c) =>
    c.markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
      .replace(/[*_~`]+/g, ''),
  toFile: (c) => ({ ext: 'md', text: c.markdown }),
  importExtensions: ['md', 'markdown', 'mdown', 'mkd'],
  fromFile: (text) => ({ markdown: text }),
});

export type MarkdownContent = { markdown: string };
