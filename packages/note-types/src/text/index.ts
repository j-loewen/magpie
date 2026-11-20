import { z } from 'zod';
import { cleanText, defineNoteType } from '../define';
import { docToMarkdown, docToText, linkParagraph, textToDoc, type RichMark, type RichNode } from './rich';

export type { RichMark, RichNode } from './rich';

/** A Tiptap document (see rich.ts). */
export type TextContent = { doc: RichNode };

const MAX_JSON_LENGTH = 2_000_000;
const MAX_DEPTH = 64;

const markSchema: z.ZodType<RichMark> = z.object({
  type: z.string().min(1).max(64),
  attrs: z.record(z.string(), z.unknown()).optional(),
});

const nodeSchema: z.ZodType<RichNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(64),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(nodeSchema).optional(),
    marks: z.array(markSchema).optional(),
    text: z.string().optional(),
  }),
);

/** Version 1 stored plain text; it is still accepted (e.g. from an open tab of an older app). */
const fromPlain = (value: unknown) =>
  value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string' && !('doc' in value)
    ? { doc: textToDoc((value as { text: string }).text) }
    : value;

/** Reject huge or very deep documents before the recursive schema walks them. */
function checkSize(value: unknown, ctx: z.core.$RefinementCtx) {
  if (JSON.stringify(value ?? null).length > MAX_JSON_LENGTH) {
    return ctx.addIssue({ code: 'custom', message: 'The text is too long' });
  }
  const stack: { node: unknown; depth: number }[] = [{ node: (value as { doc?: unknown } | null)?.doc, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== 'object') continue;
    if (depth > MAX_DEPTH) return ctx.addIssue({ code: 'custom', message: 'The text is nested too deeply' });
    const kids = (node as { content?: unknown }).content;
    if (Array.isArray(kids)) for (const k of kids) stack.push({ node: k, depth: depth + 1 });
  }
}

export const textType = defineNoteType<TextContent>({
  id: 'text',
  label: 'Text',
  description: 'Formatted text',
  version: 2,
  schema: z.preprocess(
    (value, ctx) => {
      const next = fromPlain(value);
      checkSize(next, ctx);
      return next;
    },
    z.object({ doc: nodeSchema.refine((n) => n.type === 'doc', 'Not a text document') }),
  ),
  migrations: { 1: fromPlain },
  createDefault: () => ({ doc: textToDoc('') }),
  toSearchText: (c) => docToText(c.doc),
  toFile: (c) => ({ ext: 'md', text: docToMarkdown(c.doc) }),
  importExtensions: ['txt', 'text', 'log'],
  fromFile: (text) => ({ doc: textToDoc(cleanText(text)) }),
  fromShared: (s) => {
    const blocks = s.text ? textToDoc(s.text).content! : [];
    if (s.url) blocks.push(...(blocks.length ? [{ type: 'paragraph' }] : []), linkParagraph(s.url));
    return { doc: { type: 'doc', content: blocks.length ? blocks : [{ type: 'paragraph' }] } };
  },
});
