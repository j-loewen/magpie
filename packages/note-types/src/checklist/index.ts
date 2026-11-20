import { z } from 'zod';
import { defineNoteType } from '../define';

export const MAX_INDENT = 3;

const itemSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().max(10_000),
  done: z.boolean(),
  /** Nesting level, 0 = top level. */
  indent: z.number().int().min(0).max(MAX_INDENT).optional(),
});

export type ChecklistItem = z.infer<typeof itemSchema>;
export type ChecklistContent = { items: ChecklistItem[] };

export const newItemId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Checked items are marked ☑ in the search text; the card preview and progress read them back. */
export const CHECKED = '☑';
export const UNCHECKED = '☐';

/** "- [ ] item" lines (any list marker, optionally indented). */
const TASK_LINE = /^(\s*)(?:[-*+]|\d+[.)])?\s*\[([ xX])\]\s?(.*)$/;

/** Parse pasted or imported lines into items. Markdown task markers are understood, other lines become open items. */
export function parseChecklistLines(text: string): ChecklistItem[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const task = TASK_LINE.exec(line);
      const leading = (task ? task[1] : /^\s*/.exec(line)?.[0]) ?? '';
      const indentWidth = leading.replace(/\t/g, '  ').length;
      const text = task ? (task[3] ?? '') : line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '');
      return {
        id: newItemId(),
        text: text.trim(),
        done: task ? task[2]?.toLowerCase() === 'x' : false,
        indent: Math.min(MAX_INDENT, Math.floor(indentWidth / 2)),
      };
    });
}

export const checklistType = defineNoteType({
  id: 'checklist',
  label: 'Checklist',
  description: 'To-do or shopping list with checkboxes',
  version: 1,
  schema: z.object({ items: z.array(itemSchema).max(5000) }),
  createDefault: () => ({ items: [] }),
  toSearchText: (c) => c.items.map((i) => `${i.done ? CHECKED : UNCHECKED} ${i.text}`).join('\n'),
  toFile: (c) => ({
    ext: 'md',
    text: c.items.map((i) => `${'  '.repeat(i.indent ?? 0)}- [${i.done ? 'x' : ' '}] ${i.text.replace(/\n/g, ' ')}`).join('\n') + '\n',
  }),
});
