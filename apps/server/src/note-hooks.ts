import type { Db } from './db';
import type { NoteRow } from './db/schema';

/**
 * Server-side behaviour for a note type. Types without server behaviour need no entry.
 * Registered per database (see buildApp), so parallel test apps never share state.
 */
export interface NoteTypeHooks {
  /** Called after a note of this type was created or saved. Must not throw. */
  afterSave?(note: NoteRow): void;
  /** Extra searchable text maintained by the server, e.g. the fetched page title of a link. */
  extraSearchText?(noteId: string): string;
  /** Server data attached to DTOs as `meta` (e.g. link previews), keyed by note id. */
  loadMeta?(noteIds: string[]): Map<string, unknown>;
}

const registry = new WeakMap<Db, Record<string, NoteTypeHooks>>();

export const setNoteHooks = (db: Db, hooks: Record<string, NoteTypeHooks>) => registry.set(db, hooks);
export const hooksFor = (db: Db, type: string): NoteTypeHooks | undefined => registry.get(db)?.[type];
