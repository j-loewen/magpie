import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { canEdit, type Permission } from '@notes/shared';
import type { Db } from '../db';
import { folders, noteShares, notes, type FolderRow, type NoteRow } from '../db/schema';
import { forbidden, notFound } from '../lib/errors';

/** read: see it · write: change content, create inside, move within · manage: delete, share (owner only). */
export type Access = 'read' | 'write' | 'manage';

/** Who is asking: the user, and whether their private folders are unlocked in this session. */
export interface Viewer {
  id: string;
  unlocked: boolean;
}

/*
 * The single place that decides who may touch a folder or note. Every route goes through these
 * functions.
 * - The owner can do everything. Others need a share: on the note itself, or on the note's folder
 *   or any folder above it (the nearest one counts). A share on the note wins over folder shares.
 * - Folders the viewer marked private, and everything below them, are invisible until unlocked.
 * No access at all is reported as 404, so the API never reveals that a hidden item exists.
 */

/**
 * Hidden folder ids for this viewer: their private folders and all descendants, trashed ones
 * included. Empty while unlocked.
 */
export function hiddenFolderIds(db: Db, viewer: Viewer): Set<string> {
  if (viewer.unlocked) return new Set();
  const rows = db.$client
    .prepare(
      `WITH RECURSIVE hidden(id) AS (
         SELECT folder_id FROM folder_private WHERE user_id = ?
         UNION SELECT f.id FROM folders f JOIN hidden h ON f.parent_id = h.id
       ) SELECT id FROM hidden`,
    )
    .all(viewer.id) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** SQL CTE `hidden(id)`, binding @viewerId and @unlocked. */
export const HIDDEN_FOLDERS_SQL = `hidden(id) AS (
    SELECT folder_id FROM folder_private WHERE user_id = @viewerId AND @unlocked = 0
    UNION SELECT f.id FROM folders f JOIN hidden h ON f.parent_id = h.id
  )`;
/** SQL CTE `shared_tree(id)`: folders shared with @viewerId and everything below them. */
export const SHARED_TREE_SQL = `shared_tree(id) AS (
    SELECT folder_id FROM folder_shares WHERE user_id = @viewerId
    UNION SELECT f.id FROM folders f JOIN shared_tree s ON f.parent_id = s.id
  )`;
export const viewerParams = (viewer: Viewer) => ({ viewerId: viewer.id, unlocked: viewer.unlocked ? 1 : 0 });

/** Permission on a folder: owner, or the share on the nearest folder at or above it. */
export function folderPermission(db: Db, viewer: Viewer, folder: Pick<FolderRow, 'id' | 'ownerId'>): Permission | null {
  if (folder.ownerId === viewer.id) return 'owner';
  const row = db.$client
    .prepare(
      `WITH RECURSIVE up(id, parent_id, depth) AS (
         SELECT id, parent_id, 0 FROM folders WHERE id = ?
         UNION ALL SELECT f.id, f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id
       )
       SELECT s.permission FROM up JOIN folder_shares s ON s.folder_id = up.id AND s.user_id = ?
       ORDER BY up.depth LIMIT 1`,
    )
    .get(folder.id, viewer.id) as { permission: Permission } | undefined;
  return row?.permission ?? null;
}

/** Permission on a note: owner, a share on the note itself, or its folder's permission. */
export function notePermission(db: Db, viewer: Viewer, note: Pick<NoteRow, 'id' | 'ownerId' | 'folderId'>): Permission | null {
  if (note.ownerId === viewer.id) return 'owner';
  const direct = db
    .select({ permission: noteShares.permission })
    .from(noteShares)
    .where(and(eq(noteShares.noteId, note.id), eq(noteShares.userId, viewer.id)))
    .get();
  if (direct) return direct.permission;
  if (!note.folderId) return null;
  const folder = db.select({ id: folders.id, ownerId: folders.ownerId }).from(folders).where(eq(folders.id, note.folderId)).get();
  return folder ? folderPermission(db, viewer, folder) : null;
}

function check(permission: Permission | null, access: Access, what: 'folder' | 'note') {
  if (!permission) throw notFound(what === 'folder' ? 'Folder not found' : 'Note not found');
  if (access === 'write' && !canEdit(permission)) throw forbidden(`You can only view this ${what}`);
  if (access === 'manage' && permission !== 'owner') throw forbidden(`Only the owner of this ${what} can do that`);
}

export function getFolderFor(db: Db, viewer: Viewer, folderId: string, access: Access): FolderRow & { permission: Permission } {
  const row = db.select().from(folders).where(and(eq(folders.id, folderId), isNull(folders.deletedAt))).get();
  const permission = row && !hiddenFolderIds(db, viewer).has(row.id) ? folderPermission(db, viewer, row) : null;
  check(permission, access, 'folder');
  return { ...row!, permission: permission! };
}

export function getNoteFor(db: Db, viewer: Viewer, noteId: string, access: Access): NoteRow & { permission: Permission } {
  const row = db.select().from(notes).where(and(eq(notes.id, noteId), isNull(notes.deletedAt))).get();
  const hidden = row?.folderId ? hiddenFolderIds(db, viewer).has(row.folderId) : false;
  const permission = row && !hidden ? notePermission(db, viewer, row) : null;
  check(permission, access, 'note');
  return { ...row!, permission: permission! };
}

/** Trash is personal: only the owner sees, restores or purges trashed items (private ones only when unlocked). */
export function getTrashedFolderFor(db: Db, viewer: Viewer, folderId: string): FolderRow {
  const row = db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.ownerId, viewer.id), isNotNull(folders.deletedAt)))
    .get();
  if (!row || hiddenFolderIds(db, viewer).has(row.id)) throw notFound('Folder not found in trash');
  return row;
}

export function getTrashedNoteFor(db: Db, viewer: Viewer, noteId: string): NoteRow {
  const row = db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.ownerId, viewer.id), isNotNull(notes.deletedAt)))
    .get();
  if (!row || (row.folderId && hiddenFolderIds(db, viewer).has(row.folderId))) throw notFound('Note not found in trash');
  return row;
}
