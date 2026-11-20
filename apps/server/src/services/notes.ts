import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { applyNoteOrder, type CreateNoteInput, type NoteDto, type NoteSort, type NoteSummaryDto, type PatchNoteInput, type Permission, type SaveNoteInput } from '@notes/shared';
import { getNoteType, missingForSave, NoteContentError, upgradeContent, validateContent, type NoteTypeDef } from '@notes/note-types';
import type { Db } from '../db';
import { noteShares, notes, users, type NoteRow } from '../db/schema';
import { hooksFor } from '../note-hooks';
import { badRequest, conflict, forbidden } from '../lib/errors';
import { getFolderView } from './folder-views';
import { folderPermission, getFolderFor, getNoteFor, notePermission, type Viewer } from './access';

/** Start of a note's text for cards (grid cards show 3 lines, masonry cards up to 10). */
const EXCERPT_LENGTH = 500;
const excerptOf = (text: string) => text.slice(0, EXCERPT_LENGTH * 2).replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LENGTH);

const displayName = (db: Db, id: string | null) =>
  id ? db.select({ name: users.displayName }).from(users).where(eq(users.id, id)).get()?.name : undefined;

export function toNoteDto(db: Db, viewer: Viewer, row: NoteRow, permission?: Permission): NoteDto {
  const perm = permission ?? notePermission(db, viewer, row) ?? 'view';
  const meta = hooksFor(db, row.type)?.loadMeta?.([row.id]).get(row.id);
  // Someone who only got this note (not its folder) must not learn about the owner's folders.
  const folderVisible =
    perm === 'owner' || (row.folderId !== null && folderPermission(db, viewer, { id: row.folderId, ownerId: row.ownerId }) !== null);
  const base = {
    ...(meta !== undefined && { meta }),
    id: row.id,
    folderId: folderVisible ? row.folderId : null,
    type: row.type,
    title: row.title,
    pinned: row.pinned,
    icon: row.icon,
    color: row.color,
    version: row.version,
    permission: perm,
    shareCount: perm === 'owner' ? db.select({ n: sql<number>`count(*)` }).from(noteShares).where(eq(noteShares.noteId, row.id)).get()!.n : 0,
    ownerName: displayName(db, row.ownerId) ?? '',
    ...(row.updatedBy && row.updatedBy !== viewer.id && { updatedByName: displayName(db, row.updatedBy) }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  const def = getNoteType(row.type);
  if (!def) return { ...base, typeVersion: row.typeVersion, content: row.content, readOnlyReason: 'unknown-type' };
  if (row.typeVersion > def.version) {
    return { ...base, typeVersion: row.typeVersion, content: row.content, readOnlyReason: 'newer-version' };
  }
  try {
    // Old content is upgraded on read; it is written back in the new shape on the next save.
    return { ...base, typeVersion: def.version, content: upgradeContent(def, row.content, row.typeVersion) };
  } catch {
    return { ...base, typeVersion: row.typeVersion, content: row.content, readOnlyReason: 'invalid-content' };
  }
}

function requireType(type: string): NoteTypeDef<unknown> {
  const def = getNoteType(type);
  if (!def) throw badRequest(`Unknown note type "${type}"`);
  return def;
}

function checkContent(def: NoteTypeDef<unknown>, content: unknown) {
  try {
    return validateContent(def, content);
  } catch (err) {
    if (err instanceof NoteContentError) throw badRequest(err.message);
    throw err;
  }
}

/** A note needs a name (and whatever its type requires, e.g. a link's address) to be saved. */
function requireComplete(def: NoteTypeDef<unknown>, title: string, content: unknown) {
  const missing = missingForSave(def, title, content);
  if (missing) throw badRequest(missing);
}

export function runAfterSave(db: Db, row: NoteRow) {
  try {
    hooksFor(db, row.type)?.afterSave?.(row);
  } catch (err) {
    console.error(`afterSave hook for ${row.type} failed`, err);
  }
}

/** Searchable text = the type's own text plus anything the server keeps for it (e.g. fetched page title). */
function searchTextFor(db: Db, def: NoteTypeDef<unknown>, noteId: string, content: unknown) {
  const extra = hooksFor(db, def.id)?.extraSearchText?.(noteId);
  return extra ? `${def.toSearchText(content)}\n${extra}` : def.toSearchText(content);
}

/** Recompute a note's search text after server-side data changed. Does not touch version or updatedAt. */
export function refreshSearchText(db: Db, noteId: string) {
  const row = db.select().from(notes).where(eq(notes.id, noteId)).get();
  const def = row && getNoteType(row.type);
  if (!row || !def) return;
  try {
    const content = upgradeContent(def, row.content, row.typeVersion);
    db.update(notes).set({ searchText: searchTextFor(db, def, noteId, content) }).where(eq(notes.id, noteId)).run();
  } catch {
    // Unreadable content: leave the index as it is.
  }
}

const SORT = {
  updated: [desc(notes.updatedAt)],
  created: [desc(notes.createdAt)],
  title: [asc(sql`${notes.title} COLLATE NOCASE`), desc(notes.updatedAt)],
  // Oldest first; the viewer's own order goes on top of that (notes not in it come last).
  manual: [asc(notes.createdAt)],
} as const;

/** Server meta for a list of notes, one batch query per note type. */
export function loadMetaFor(db: Db, rows: { id: string; type: string }[]) {
  const out = new Map<string, unknown>();
  const byType = new Map<string, string[]>();
  for (const r of rows) byType.set(r.type, [...(byType.get(r.type) ?? []), r.id]);
  for (const [type, ids] of byType) {
    for (const [id, m] of hooksFor(db, type)?.loadMeta?.(ids) ?? []) out.set(id, m);
  }
  return out;
}

/** Notes directly in a folder (or the viewer's own top level when folderId is null). */
export function listNotes(db: Db, viewer: Viewer, folderId: string | null, sort: NoteSort = 'updated'): NoteSummaryDto[] {
  const folder = folderId ? getFolderFor(db, viewer, folderId, 'read') : null;
  const rows = db
    .select({
      id: notes.id,
      folderId: notes.folderId,
      ownerId: notes.ownerId,
      type: notes.type,
      title: notes.title,
      excerpt: sql<string>`substr(${notes.searchText}, 1, ${EXCERPT_LENGTH * 2})`,
      pinned: notes.pinned,
      icon: notes.icon,
      color: notes.color,
      updatedBy: notes.updatedBy,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(
      and(folderId ? eq(notes.folderId, folderId) : and(isNull(notes.folderId), eq(notes.ownerId, viewer.id)), isNull(notes.deletedAt)),
    )
    .orderBy(desc(notes.pinned), ...SORT[sort])
    .all();

  const ids = rows.map((r) => r.id);
  const meta = loadMetaFor(db, rows);
  const isOwner = !folder || folder.permission === 'owner';
  // Shares on single notes: as owner, how many people each note is shared with; otherwise my own share.
  const shareRows = ids.length ? db.select().from(noteShares).where(inArray(noteShares.noteId, ids)).all() : [];
  const shareCount = new Map<string, number>();
  const myShare = new Map<string, Permission>();
  for (const s of shareRows) {
    shareCount.set(s.noteId, (shareCount.get(s.noteId) ?? 0) + 1);
    if (s.userId === viewer.id) myShare.set(s.noteId, s.permission);
  }
  const names = new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.flatMap((r) => [r.ownerId, r.updatedBy ?? r.ownerId]))].concat(viewer.id)))
      .all()
      .map((u) => [u.id, u.name]),
  );

  const list: NoteSummaryDto[] = rows.map(({ ownerId, updatedBy, ...n }) => ({
    ...n,
    excerpt: excerptOf(n.excerpt),
    permission: isOwner ? 'owner' : (myShare.get(n.id) ?? folder!.permission),
    shareCount: isOwner ? (shareCount.get(n.id) ?? 0) : 0,
    ownerName: names.get(ownerId) ?? '',
    ...(updatedBy && updatedBy !== viewer.id && { updatedByName: names.get(updatedBy) }),
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    ...(meta.has(n.id) && { meta: meta.get(n.id) }),
  }));
  return sort === 'manual' ? applyNoteOrder(list, getFolderView(db, viewer, folderId).noteOrder) : list;
}

export function getNote(db: Db, viewer: Viewer, id: string) {
  const row = getNoteFor(db, viewer, id, 'read');
  return toNoteDto(db, viewer, row, row.permission);
}

export function createNote(db: Db, viewer: Viewer, input: CreateNoteInput): NoteDto {
  const def = requireType(input.type);
  const folderId = input.folderId ?? null;
  // Notes belong to the owner of the folder they are created in (also when an editor creates them).
  const ownerId = folderId ? getFolderFor(db, viewer, folderId, 'write').ownerId : viewer.id;
  const content = input.content === undefined ? def.createDefault() : checkContent(def, input.content);
  requireComplete(def, input.title ?? '', content);
  const id = input.id ?? crypto.randomUUID();
  // Any note with this id (also someone else's, or one in the trash) blocks it; the client then loads that note.
  if (input.id && db.select({ id: notes.id }).from(notes).where(eq(notes.id, input.id)).get()) {
    throw conflict('A note with this id already exists');
  }
  const row = db
    .insert(notes)
    .values({
      id,
      ownerId,
      folderId,
      type: def.id,
      typeVersion: def.version,
      title: input.title ?? '',
      content,
      searchText: searchTextFor(db, def, id, content),
      updatedBy: viewer.id,
    })
    .returning()
    .get();
  runAfterSave(db, row);
  return toNoteDto(db, viewer, row);
}

/**
 * Saves title + content. Optimistic locking: the client sends the version it started from; if
 * someone saved in between, nothing is written and a 409 returns the current note.
 */
export function saveNote(db: Db, viewer: Viewer, id: string, input: SaveNoteInput): NoteDto {
  const row = getNoteFor(db, viewer, id, 'write');
  const current = toNoteDto(db, viewer, row, row.permission);
  if (current.readOnlyReason) throw badRequest('This note cannot be edited with this version of the app');
  if (row.version !== input.version) {
    throw conflict('This note was changed somewhere else', { current });
  }
  const def = requireType(row.type);
  const content = checkContent(def, input.content);
  requireComplete(def, input.title, content);
  const updated = db
    .update(notes)
    .set({
      title: input.title,
      content,
      typeVersion: def.version,
      searchText: searchTextFor(db, def, id, content),
      version: row.version + 1,
      updatedAt: new Date(),
      updatedBy: viewer.id,
    })
    .where(and(eq(notes.id, id), eq(notes.version, input.version)))
    .returning()
    .get();
  if (!updated) throw conflict('This note was changed somewhere else', { current: getNote(db, viewer, id) });
  runAfterSave(db, updated);
  return toNoteDto(db, viewer, updated, row.permission);
}

/** Move / pin / icon and colour. Does not touch the content version, so it never conflicts with an open editor. */
export function patchNote(db: Db, viewer: Viewer, id: string, input: PatchNoteInput): NoteDto {
  const note = getNoteFor(db, viewer, id, 'write');
  const patch: Partial<typeof notes.$inferInsert> = {};
  if (input.folderId !== undefined && input.folderId !== note.folderId) {
    if (input.folderId === null) {
      if (note.permission !== 'owner') throw forbidden('Only the owner can move this note to the top level');
    } else {
      const target = getFolderFor(db, viewer, input.folderId, 'write');
      if (target.ownerId !== note.ownerId) throw badRequest('Notes can only be moved within the same owner’s folders');
    }
    patch.folderId = input.folderId;
  }
  if (input.pinned !== undefined) patch.pinned = input.pinned;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.color !== undefined) patch.color = input.color;
  if (Object.keys(patch).length === 0) return toNoteDto(db, viewer, note, note.permission);
  const row = db.update(notes).set(patch).where(eq(notes.id, id)).returning().get()!;
  return toNoteDto(db, viewer, row);
}

/** Owner only: people a note is shared with cannot delete it. */
export function trashNote(db: Db, viewer: Viewer, id: string) {
  getNoteFor(db, viewer, id, 'manage');
  db.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, id)).run();
}
