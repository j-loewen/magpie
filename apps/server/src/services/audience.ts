import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { noteShares, notes } from '../db/schema';

/*
 * Who can see a folder or note: its owner plus everyone it is shared with (directly, or through
 * a folder above it). Used to decide who gets live-refresh events; trashed items count too, so
 * people notice when something disappears.
 */

export function folderAudience(db: Db, folderId: string | null | undefined): Set<string> {
  if (!folderId) return new Set();
  const rows = db.$client
    .prepare(
      `WITH RECURSIVE up(id, parent_id) AS (
         SELECT id, parent_id FROM folders WHERE id = @id
         UNION ALL SELECT f.id, f.parent_id FROM folders f JOIN up ON f.id = up.parent_id
       )
       SELECT owner_id AS userId FROM folders WHERE id = @id
       UNION SELECT user_id FROM folder_shares WHERE folder_id IN (SELECT id FROM up)`,
    )
    .all({ id: folderId }) as { userId: string }[];
  return new Set(rows.map((r) => r.userId));
}

export function noteAudience(db: Db, noteId: string | null | undefined): Set<string> {
  if (!noteId) return new Set();
  const note = db.select({ ownerId: notes.ownerId, folderId: notes.folderId }).from(notes).where(eq(notes.id, noteId)).get();
  if (!note) return new Set();
  const users = folderAudience(db, note.folderId);
  users.add(note.ownerId);
  for (const s of db.select({ userId: noteShares.userId }).from(noteShares).where(eq(noteShares.noteId, noteId)).all()) users.add(s.userId);
  return users;
}

export const union = (...sets: Iterable<string>[]) => new Set(sets.flatMap((s) => [...s]));
