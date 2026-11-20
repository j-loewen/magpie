/**
 * Rich text documents in Tiptap's JSON shape, and what the server does with them: build one from
 * plain text, and turn one into plain text (search, previews) or Markdown (export). No DOM or
 * Tiptap imports here, so the server can use it.
 */

export interface RichMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: RichMark[];
  text?: string;
}

const paragraph = (text: string): RichNode => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });

/** Plain text as a document: one paragraph per line, so the text looks as it did. */
export function textToDoc(text: string): RichNode {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return { type: 'doc', content: lines.map(paragraph) };
}

/** A paragraph holding a link (for addresses shared from other apps). */
export const linkParagraph = (url: string): RichNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }],
});

const BLOCKS_WITH_TEXT = new Set(['paragraph', 'heading', 'codeBlock']);

/** The document's text: one line per paragraph, heading or list item. */
export function docToText(doc: RichNode): string {
  const lines: string[] = [];
  const inline = (node: RichNode): string =>
    node.type === 'text' ? (node.text ?? '') : node.type === 'hardBreak' ? '\n' : (node.content ?? []).map(inline).join('');
  const block = (node: RichNode) => {
    if (BLOCKS_WITH_TEXT.has(node.type)) lines.push(inline(node));
    else for (const child of node.content ?? []) block(child);
  };
  block(doc);
  return lines.join('\n');
}

// ---- Markdown export ---------------------------------------------------------------------

/** Characters that would otherwise start Markdown formatting. */
const escapeInline = (s: string) => s.replace(/([\\`*_[\]~<])/g, '\\$1');
/** Text at the start of a line that Markdown would read as a heading, quote or list. */
const escapeLineStart = (s: string) => s.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/, '$1\\$2');

const MARK_ORDER = ['link', 'bold', 'italic', 'strike', 'underline', 'code'];

function wrapMark(text: string, mark: RichMark): string {
  switch (mark.type) {
    case 'bold':
      return `**${text}**`;
    case 'italic':
      return `_${text}_`;
    case 'strike':
      return `~~${text}~~`;
    case 'underline':
      return `<u>${text}</u>`;
    case 'link': {
      const href = String(mark.attrs?.href ?? '').replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
      return href ? `[${text}](${href})` : text;
    }
    default:
      return text;
  }
}

function inlineMarkdown(nodes: RichNode[] = []): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') return '\\\n';
      if (node.type !== 'text' || !node.text) return '';
      const marks = [...(node.marks ?? [])].sort((a, b) => MARK_ORDER.indexOf(b.type) - MARK_ORDER.indexOf(a.type));
      const isCode = marks.some((m) => m.type === 'code');
      // Spaces stay outside the markers ("** bold**" is not bold in Markdown).
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.text)!;
      if (!core) return node.text;
      let out = isCode ? `\`${core.includes('`') ? ` ${core} ` : core}\`` : escapeInline(core);
      for (const mark of marks) if (mark.type !== 'code') out = wrapMark(out, mark);
      return lead + out + trail;
    })
    .join('');
}

const indent = (text: string, prefix: string, first = prefix) =>
  text
    .split('\n')
    .map((line, i) => (line ? (i === 0 ? first : prefix) + line : line))
    .join('\n');

function blockMarkdown(node: RichNode): string {
  const children = node.content ?? [];
  switch (node.type) {
    case 'paragraph':
      return escapeLineStart(inlineMarkdown(children));
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
      return `${'#'.repeat(level)} ${inlineMarkdown(children)}`;
    }
    case 'blockquote':
      return blocksMarkdown(children)
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    case 'bulletList':
    case 'orderedList': {
      const start = Number(node.attrs?.start) || 1;
      return children
        .map((item, i) => {
          const marker = node.type === 'bulletList' ? '- ' : `${start + i}. `;
          return indent(blocksMarkdown(item.content ?? [], '\n'), ' '.repeat(marker.length), marker);
        })
        .join('\n');
    }
    case 'codeBlock': {
      const code = children.map((c) => c.text ?? '').join('');
      const fence = code.includes('```') ? '~~~' : '```';
      return `${fence}${String(node.attrs?.language ?? '')}\n${code}\n${fence}`;
    }
    case 'horizontalRule':
      return '---';
    default:
      return blocksMarkdown(children);
  }
}

function blocksMarkdown(nodes: RichNode[], separator = '\n\n'): string {
  return nodes.map(blockMarkdown).join(separator);
}

/** The document as Markdown (formatting Markdown has no syntax for, like underline, as HTML). */
export function docToMarkdown(doc: RichNode): string {
  // Empty paragraphs keep the spacing they add as blank lines, so drop them.
  const blocks = (doc.content ?? []).filter((n) => n.type !== 'paragraph' || n.content?.length);
  const text = blocksMarkdown(blocks);
  return text ? `${text}\n` : '';
}
