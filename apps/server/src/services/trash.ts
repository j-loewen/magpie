import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or } from 'drizzle-orm';
import type { TrashDto } from '@notes/shared';
import type { Db } from '../db';
import { folders, notes } from '../db/schema';
import { getTrashedFolderFor, getTrashedNoteFor, hiddenFolderIds, type Viewer } from './access';
import { subtreeFolderIds } from './folders';

/*
 * Trashing a folder stamps the folder, its subfolders and their notes with the same deletedAt.
 * The trash lists only the top of each such batch; restoring a folder restores exactly the items
 * that were trashed together with it.
 */

export function listTrash(db: Db, viewer: Viewer, retentionDays: number): TrashDto {
  const userId = viewer.id;
  // Private folders (and notes in them) stay out of sight while locked, in the trash too.
  const hidden = hiddenFolderIds(db, viewer);
  const folderRows = db.$client
    .prepare(
      `SELECT f.id, f.name, f.deleted_at AS deletedAt
         FROM folders f LEFT JOIN folders p ON p.id = f.parent_id
        WHERE f.owner_id = ? AND f.deleted_at IS NOT NULL
          AND (p.id IS NULL OR p.deleted_at IS NULL OR p.deleted_at <> f.deleted_at)
        ORDER BY f.deleted_at DESC`,
    )
    .all(userId) as { id: string; name: string; deletedAt: number }[];
  const visibleFolders = folderRows.filter((f) => !hidden.has(f.id));

  const noteRows = db.$client
    .prepare(
      `SELECT n.id, n.title, n.type, n.folder_id AS folderId, n.deleted_at AS deletedAt
         FROM notes n LEFT JOIN folders f ON f.id = n.folder_id
        WHERE n.owner_id = ? AND n.deleted_at IS NOT NULL
          AND (f.id IS NULL OR f.deleted_at IS NULL OR f.deleted_at <> n.deleted_at)
        ORDER BY n.deleted_at DESC`,
    )
    .all(userId) as { id: string; title: string; type: string; folderId: string | null; deletedAt: number }[];
  const visibleNotes = noteRows.filter((n) => !n.folderId || !hidden.has(n.folderId));

  return {
    retentionDays,
    folders: visibleFolders.map((f) => {
      const batch = batchOf(db, f.id, f.deletedAt);
      return {
        id: f.id,
        name: f.name,
        deletedAt: new Date(f.deletedAt).toISOString(),
        folderCount: batch.folderIds.length - 1,
        noteCount: batch.noteCount,
      };
    }),
    notes: visibleNotes.map(({ folderId: _f, ...n }) => ({ ...n, deletedAt: new Date(n.deletedAt).toISOString() })),
  };
}

/** Folders in the subtree that were trashed at the same moment as the root. */
function batchOf(db: Db, rootId: string, deletedAtMs: number) {
  const ids = subtreeFolderIds(db, rootId);
  const deletedAt = new Date(deletedAtMs);
  const folderIds = db
    .select({ id: folders.id })
    .from(folders)
    .where(and(inArray(folders.id, ids), eq(folders.deletedAt, deletedAt)))
    .all()
    .map((r) => r.id);
  const noteCount = db
    .select({ id: notes.id })
    .from(notes)
    .where(and(inArray(notes.folderId, folderIds), eq(notes.deletedAt, deletedAt)))
    .all().length;
  return { folderIds, deletedAt, noteCount };
}

export function restoreFolder(db: Db, viewer: Viewer, id: string) {
  const folder = getTrashedFolderFor(db, viewer, id);
  const { folderIds, deletedAt } = batchOf(db, id, folder.deletedAt!.getTime());
  const parent = folder.parentId ? db.select().from(folders).where(eq(folders.id, folder.parentId)).get() : undefined;
  db.transaction((tx) => {
    tx.update(folders).set({ deletedAt: null }).where(inArray(folders.id, folderIds)).run();
    tx.update(notes)
      .set({ deletedAt: null })
      .where(and(inArray(notes.folderId, folderIds), eq(notes.deletedAt, deletedAt)))
      .run();
    // If the original parent is itself in the trash, restore to the top level.
    if (parent?.deletedAt) tx.update(folders).set({ parentId: null }).where(eq(folders.id, id)).run();
  });
}

export function restoreNote(db: Db, viewer: Viewer, id: string) {
  const note = getTrashedNoteFor(db, viewer, id);
  const folder = note.folderId ? db.select().from(folders).where(eq(folders.id, note.folderId)).get() : undefined;
  db.update(notes)
    .set({ deletedAt: null, ...(folder?.deletedAt && { folderId: null }) })
    .where(eq(notes.id, id))
    .run();
}

export function purgeFolder(db: Db, viewer: Viewer, id: string) {
  getTrashedFolderFor(db, viewer, id);
  db.transaction((tx) => {
    const ids = subtreeFolderIds(db, id);
    tx.delete(notes).where(inArray(notes.folderId, ids)).run();
    tx.delete(folders).where(eq(folders.id, id)).run(); // subfolders cascade
  });
}

export function purgeNote(db: Db, viewer: Viewer, id: string) {
  getTrashedNoteFor(db, viewer, id);
  db.delete(notes).where(eq(notes.id, id)).run();
}

/** Deletes everything in the trash the viewer can see (hidden private items stay). */
export function emptyTrash(db: Db, viewer: Viewer) {
  const hidden = [...hiddenFolderIds(db, viewer)];
  db.transaction((tx) => {
    tx.delete(notes)
      .where(
        and(
          eq(notes.ownerId, viewer.id),
          isNotNull(notes.deletedAt),
          hidden.length ? or(isNull(notes.folderId), notInArray(notes.folderId, hidden)) : undefined,
        ),
      )
      .run();
    tx.delete(folders)
      .where(
        and(eq(folders.ownerId, viewer.id), isNotNull(folders.deletedAt), hidden.length ? notInArray(folders.id, hidden) : undefined),
      )
      .run();
  });
}

/** Permanently removes everything that has been in the trash longer than `days`. */
export function purgeExpiredTrash(db: Db, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  db.transaction((tx) => {
    tx.delete(notes).where(lt(notes.deletedAt, cutoff)).run();
    tx.delete(folders).where(lt(folders.deletedAt, cutoff)).run();
  });
}
