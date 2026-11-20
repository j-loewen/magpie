import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { CreateFolderInput, FolderDto, Permission, UpdateFolderInput } from '@notes/shared';
import type { Db } from '../db';
import { folderPrivate, folders, notes, userPrivacy } from '../db/schema';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { getFolderFor, hiddenFolderIds, SHARED_TREE_SQL, viewerParams, type Viewer } from './access';

/** Ids of a folder and all its descendants (trashed ones included). */
export function subtreeFolderIds(db: Db, rootId: string): string[] {
  const rows = db.$client
    .prepare(
      `WITH RECURSIVE t(id) AS (
         SELECT ? UNION ALL SELECT f.id FROM folders f JOIN t ON f.parent_id = t.id
       ) SELECT id FROM t`,
    )
    .all(rootId) as { id: string }[];
  return rows.map((r) => r.id);
}

interface FolderQueryRow {
  id: string;
  parentId: string | null;
  name: string;
  ownerId: string;
  ownerName: string;
  noteCount: number;
  shareCount: number;
  direct: Permission | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Every active folder the viewer can reach: their own, plus folders shared with them and
 * everything below those. Hidden (private) folders are included; callers filter them.
 */
function reachableFolders(db: Db, viewer: Viewer): FolderDto[] {
  const rows = db.$client
    .prepare(
      `WITH RECURSIVE ${SHARED_TREE_SQL}
       SELECT f.id, f.parent_id AS parentId, f.name, f.owner_id AS ownerId, u.display_name AS ownerName,
              (SELECT count(*) FROM notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL) AS noteCount,
              CASE WHEN f.owner_id = @viewerId
                   THEN (SELECT count(*) FROM folder_shares s WHERE s.folder_id = f.id) ELSE 0 END AS shareCount,
              (SELECT permission FROM folder_shares s WHERE s.folder_id = f.id AND s.user_id = @viewerId) AS direct,
              f.created_at AS createdAt, f.updated_at AS updatedAt
         FROM folders f JOIN users u ON u.id = f.owner_id
        WHERE f.deleted_at IS NULL AND (f.owner_id = @viewerId OR f.id IN (SELECT id FROM shared_tree))
        ORDER BY f.name COLLATE NOCASE`,
    )
    .all(viewerParams(viewer)) as FolderQueryRow[];

  const privateIds = new Set(
    db.select({ id: folderPrivate.folderId }).from(folderPrivate).where(eq(folderPrivate.userId, viewer.id)).all().map((r) => r.id),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Permission of a shared folder = the share on the nearest folder at or above it.
  const permissionOf = (row: FolderQueryRow): Permission => {
    if (row.ownerId === viewer.id) return 'owner';
    for (let r: FolderQueryRow | undefined = row; r; r = r.parentId ? byId.get(r.parentId) : undefined) {
      if (r.direct) return r.direct;
    }
    return 'view';
  };

  return rows.map((r) => ({
    id: r.id,
    // A shared folder whose parent the viewer cannot see is shown as a top-level shared folder.
    parentId: r.parentId && byId.has(r.parentId) ? r.parentId : null,
    name: r.name,
    noteCount: r.noteCount,
    isPrivate: privateIds.has(r.id),
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    permission: permissionOf(r),
    shareCount: r.shareCount,
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
  }));
}

/** Folders the viewer can see right now (private ones only while unlocked). */
export function listFolders(db: Db, viewer: Viewer): FolderDto[] {
  const hidden = hiddenFolderIds(db, viewer);
  return reachableFolders(db, viewer).filter((f) => !hidden.has(f.id));
}

function toDto(db: Db, viewer: Viewer, id: string): FolderDto {
  const dto = reachableFolders(db, viewer).find((f) => f.id === id);
  if (!dto) throw new Error('Folder vanished');
  return dto;
}

export function createFolder(db: Db, viewer: Viewer, input: CreateFolderInput): FolderDto {
  const parentId = input.parentId ?? null;
  // Subfolders belong to the owner of the folder they are created in (also when an editor creates them).
  const ownerId = parentId ? getFolderFor(db, viewer, parentId, 'write').ownerId : viewer.id;
  const id = crypto.randomUUID();
  db.insert(folders).values({ id, ownerId, parentId, name: input.name }).run();
  return toDto(db, viewer, id);
}

export function updateFolder(db: Db, viewer: Viewer, id: string, input: UpdateFolderInput): FolderDto {
  const changesFolder = input.name !== undefined || input.parentId !== undefined;
  // Marking private is personal and needs only read access; renaming and moving need write access.
  const folder = getFolderFor(db, viewer, id, changesFolder ? 'write' : 'read');
  const patch: Partial<typeof folders.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.parentId !== undefined && input.parentId !== folder.parentId) {
    if (input.parentId === null) {
      if (folder.permission !== 'owner') throw forbidden('Only the owner can move this folder to the top level');
    } else {
      const target = getFolderFor(db, viewer, input.parentId, 'write');
      if (target.ownerId !== folder.ownerId) throw badRequest('Folders can only be moved within the same owner’s folders');
      if (subtreeFolderIds(db, id).includes(input.parentId)) {
        throw badRequest('A folder cannot be moved into itself or one of its subfolders');
      }
    }
    patch.parentId = input.parentId;
  }
  db.transaction((tx) => {
    if (changesFolder) tx.update(folders).set(patch).where(eq(folders.id, id)).run();
    if (input.private === true) {
      if (!tx.select().from(userPrivacy).where(eq(userPrivacy.userId, viewer.id)).get()) {
        throw badRequest('Set a PIN or password for private folders first');
      }
      tx.insert(folderPrivate).values({ userId: viewer.id, folderId: id }).onConflictDoNothing().run();
    } else if (input.private === false) {
      tx.delete(folderPrivate).where(and(eq(folderPrivate.userId, viewer.id), eq(folderPrivate.folderId, id))).run();
    }
  });
  // Returned even if the folder just became hidden; the client drops it on its next refresh.
  return toDto(db, viewer, id);
}

/** Moves a folder, its subfolders and all their notes to the trash with one shared timestamp. Owner only. */
export function trashFolder(db: Db, viewer: Viewer, id: string) {
  getFolderFor(db, viewer, id, 'manage');
  const ids = subtreeFolderIds(db, id);
  // Never trash content the user cannot currently see.
  const hidden = hiddenFolderIds(db, viewer);
  if (ids.some((f) => hidden.has(f))) throw conflict('Unlock private folders to delete this folder');
  const deletedAt = new Date();
  db.transaction((tx) => {
    tx.update(folders).set({ deletedAt }).where(and(inArray(folders.id, ids), isNull(folders.deletedAt))).run();
    tx.update(notes).set({ deletedAt }).where(and(inArray(notes.folderId, ids), isNull(notes.deletedAt))).run();
  });
}
