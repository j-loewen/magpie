import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { ShareDto, ShareInput, SharedItemDto, UserRefDto } from '@notes/shared';
import type { Db } from '../db';
import { folderShares, folders, noteShares, notes, users } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { getFolderFor, getNoteFor, hiddenFolderIds, type Viewer } from './access';
import { loadMetaFor } from './notes';

type Kind = 'folder' | 'note';

const userRef = { id: users.id, username: users.username, displayName: users.displayName };

/** Everyone else on this server, for the share dialog. */
export function userDirectory(db: Db, viewer: Viewer): UserRefDto[] {
  return db.select(userRef).from(users).where(ne(users.id, viewer.id)).orderBy(asc(sql`${users.displayName} COLLATE NOCASE`)).all();
}

/** Owner only: managing shares requires 'manage' access. */
function ownedItem(db: Db, viewer: Viewer, kind: Kind, id: string) {
  return kind === 'folder' ? getFolderFor(db, viewer, id, 'manage') : getNoteFor(db, viewer, id, 'manage');
}

export function listShares(db: Db, viewer: Viewer, kind: Kind, id: string): ShareDto[] {
  ownedItem(db, viewer, kind, id);
  const table = kind === 'folder' ? folderShares : noteShares;
  const key = kind === 'folder' ? folderShares.folderId : noteShares.noteId;
  return db
    .select({ user: userRef, permission: table.permission, createdAt: table.createdAt })
    .from(table)
    .innerJoin(users, eq(users.id, table.userId))
    .where(eq(key, id))
    .orderBy(asc(sql`${users.displayName} COLLATE NOCASE`))
    .all()
    .map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }));
}

/** Share with a user, or change their permission. */
export function share(db: Db, viewer: Viewer, input: ShareInput): ShareDto[] {
  const item = ownedItem(db, viewer, input.kind, input.id);
  if (input.userId === item.ownerId) throw badRequest('You already own this');
  if (!db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).get()) throw notFound('User not found');
  if (input.kind === 'folder') {
    db.insert(folderShares)
      .values({ folderId: input.id, userId: input.userId, permission: input.permission })
      .onConflictDoUpdate({ target: [folderShares.folderId, folderShares.userId], set: { permission: input.permission } })
      .run();
  } else {
    db.insert(noteShares)
      .values({ noteId: input.id, userId: input.userId, permission: input.permission })
      .onConflictDoUpdate({ target: [noteShares.noteId, noteShares.userId], set: { permission: input.permission } })
      .run();
  }
  return listShares(db, viewer, input.kind, input.id);
}

export function unshare(db: Db, viewer: Viewer, kind: Kind, id: string, userId: string): ShareDto[] {
  ownedItem(db, viewer, kind, id);
  removeShare(db, kind, id, userId);
  return listShares(db, viewer, kind, id);
}

/** A recipient removes something from their "Shared with me". */
export function leaveShare(db: Db, viewer: Viewer, kind: Kind, id: string) {
  if (!removeShare(db, kind, id, viewer.id)) throw notFound('Not shared with you');
}

function removeShare(db: Db, kind: Kind, id: string, userId: string) {
  const res =
    kind === 'folder'
      ? db.delete(folderShares).where(and(eq(folderShares.folderId, id), eq(folderShares.userId, userId))).run()
      : db.delete(noteShares).where(and(eq(noteShares.noteId, id), eq(noteShares.userId, userId))).run();
  return res.changes > 0;
}

/** Folders and notes other users shared directly with the viewer (not trashed, not hidden). */
export function sharedWithMe(db: Db, viewer: Viewer): SharedItemDto[] {
  const hidden = hiddenFolderIds(db, viewer);
  const owner = { id: users.id, username: users.username, displayName: users.displayName };

  const folderItems = db
    .select({ id: folders.id, name: folders.name, owner, permission: folderShares.permission, sharedAt: folderShares.createdAt })
    .from(folderShares)
    .innerJoin(folders, eq(folders.id, folderShares.folderId))
    .innerJoin(users, eq(users.id, folders.ownerId))
    .where(and(eq(folderShares.userId, viewer.id), isNull(folders.deletedAt)))
    .all()
    .filter((f) => !hidden.has(f.id))
    .map((f): SharedItemDto => ({ kind: 'folder', ...f, sharedAt: f.sharedAt.toISOString() }));

  const noteRows = db
    .select({
      id: notes.id,
      name: notes.title,
      type: notes.type,
      icon: notes.icon,
      color: notes.color,
      folderId: notes.folderId,
      excerpt: sql<string>`substr(${notes.searchText}, 1, 300)`,
      owner,
      permission: noteShares.permission,
      sharedAt: noteShares.createdAt,
    })
    .from(noteShares)
    .innerJoin(notes, eq(notes.id, noteShares.noteId))
    .innerJoin(users, eq(users.id, notes.ownerId))
    .where(and(eq(noteShares.userId, viewer.id), isNull(notes.deletedAt)))
    .all()
    .filter((n) => !n.folderId || !hidden.has(n.folderId));
  const meta = loadMetaFor(db, noteRows);
  const noteItems = noteRows.map(
    ({ folderId: _f, excerpt, ...n }): SharedItemDto => ({
      kind: 'note',
      ...n,
      excerpt: excerpt.replace(/\s+/g, ' ').trim().slice(0, 200),
      ...(meta.has(n.id) && { meta: meta.get(n.id) }),
      sharedAt: n.sharedAt.toISOString(),
    }),
  );

  return [...folderItems, ...noteItems].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
}
