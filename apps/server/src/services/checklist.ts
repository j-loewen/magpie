import { inArray } from 'drizzle-orm';
import type { Db } from '../db';
import { notes } from '../db/schema';
import type { NoteTypeHooks } from '../note-hooks';

/** Checklists: progress (done / total) for cards. */
export function checklistHooks(db: Db): NoteTypeHooks {
  return {
    loadMeta: (ids) => {
      const out = new Map<string, unknown>();
      if (!ids.length) return out;
      for (const row of db.select({ id: notes.id, content: notes.content }).from(notes).where(inArray(notes.id, ids)).all()) {
        const items = (row.content as { items?: unknown } | null)?.items;
        if (!Array.isArray(items)) continue;
        out.set(row.id, { total: items.length, done: items.filter((i) => (i as { done?: unknown } | null)?.done === true).length });
      }
      return out;
    },
  };
}
