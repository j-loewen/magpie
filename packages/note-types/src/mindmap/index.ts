import { z } from 'zod';
import { defineNoteType, NoteContentError } from '../define';

export interface MindNode {
  id: string;
  text: string;
  children: MindNode[];
  /** Children hidden. */
  collapsed?: boolean;
  /** Side of a main branch (children of the root only); assigned when the branch is created. */
  side?: 'left' | 'right';
}
export type MindmapContent = { root: MindNode };

export const MAX_NODES = 5000;
const MAX_DEPTH = 64;

export const newNodeId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const nodeSchema: z.ZodType<MindNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    text: z.string().max(5_000),
    children: z.array(nodeSchema).max(MAX_NODES),
    collapsed: z.boolean().optional(),
    side: z.enum(['left', 'right']).optional(),
  }),
);

/** Reject huge or very deep trees before the recursive schema walks them. */
function checkSize(value: unknown, ctx: z.core.$RefinementCtx) {
  const stack: { node: unknown; depth: number }[] = [{ node: (value as { root?: unknown } | null)?.root, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== 'object') continue;
    if (++count > MAX_NODES) return ctx.addIssue({ code: 'custom', message: `A mind map can have at most ${MAX_NODES} topics` });
    if (depth > MAX_DEPTH) return ctx.addIssue({ code: 'custom', message: 'The mind map is nested too deeply' });
    const kids = (node as { children?: unknown }).children;
    if (Array.isArray(kids)) for (const k of kids) stack.push({ node: k, depth: depth + 1 });
  }
}

export function walk(node: MindNode, visit: (n: MindNode, depth: number) => void, depth = 0) {
  visit(node, depth);
  for (const c of node.children) walk(c, visit, depth + 1);
}

const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();

// ---- OPML / FreeMind import (a tiny tokenizer: both are simple nested XML) ----------------

const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    const lower = e.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
  });

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decodeXml(m[2] ?? m[3] ?? '') : undefined;
}

/** Nested <outline text="…"> (OPML) or <node TEXT="…"> (FreeMind) elements as topics. */
function parseOutline(xml: string, element: string, textAttr: string): MindNode[] {
  const top: MindNode[] = [];
  const stack: MindNode[] = [];
  const re = new RegExp(`<(/?)${element}\\b([^>]*?)(/?)>`, 'gi');
  let count = 0;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const [, closing, attrs, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    if (++count > MAX_NODES) throw new NoteContentError(`A mind map can have at most ${MAX_NODES} topics`);
    const node: MindNode = { id: newNodeId(), text: oneLine(attr(` ${attrs}`, textAttr) ?? attr(` ${attrs}`, 'title') ?? ''), children: [] };
    (stack[stack.length - 1]?.children ?? top).push(node);
    if (!selfClosing && stack.length < MAX_DEPTH) stack.push(node);
  }
  return top;
}

function fromOutlineFile(text: string, ext: string): MindmapContent {
  const nodes = ext === 'mm' ? parseOutline(text, 'node', 'TEXT') : parseOutline(text, 'outline', 'text');
  const [first] = nodes;
  if (!first) throw new NoteContentError('No topics found');
  if (nodes.length === 1) return { root: first };
  const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1];
  return { root: { id: newNodeId(), text: oneLine(decodeXml(title ?? '')) || 'Central idea', children: nodes } };
}

export const mindmapType = defineNoteType({
  id: 'mindmap',
  label: 'Mind map',
  description: 'Ideas as a tree of topics',
  version: 1,
  schema: z.preprocess((value, ctx) => {
    checkSize(value, ctx);
    return value;
  }, z.object({ root: nodeSchema })),
  createDefault: () => ({ root: { id: newNodeId(), text: 'Central idea', children: [] } }),
  toSearchText: (c) => {
    const lines: string[] = [];
    walk(c.root, (n) => n.text.trim() && lines.push(n.text));
    return lines.join('\n');
  },
  // A Markdown outline: readable anywhere, and mind map apps such as XMind and MindNode import it.
  toFile: (c) => {
    const lines = [`# ${oneLine(c.root.text)}`, ''];
    for (const child of c.root.children) {
      walk(child, (n, depth) => lines.push(`${'  '.repeat(depth)}- ${oneLine(n.text)}`));
    }
    return { ext: 'md', text: lines.join('\n') + '\n' };
  },
  importExtensions: ['opml', 'mm'],
  fromFile: fromOutlineFile,
});
