import type { z } from 'zod';

/**
 * Everything the server and client both need to know about a note type. No React here, so the
 * server can import it.
 *
 * Adding a type: create `src/<type>/index.ts` (this definition) and `src/<type>/client.tsx`
 * (editor), then register both in `src/index.ts` and `src/client.ts`.
 */
export interface NoteTypeDef<C = unknown> {
  /** Stable id stored in the database. Never rename it. */
  id: string;
  label: string;
  description: string;
  /** Bump when the content shape changes, and add a migration from the previous version. */
  version: number;
  schema: z.ZodType<C>;
  createDefault(): C;
  /** `migrations[n]` upgrades content from version n to n + 1. */
  migrations?: Record<number, (content: unknown) => unknown>;
  /** Plain text indexed for full-text search and used for previews. */
  toSearchText(content: C): string;
  /** Readable file for downloads and exports (default: the content as JSON). */
  toFile?(content: C, title: string): ExportedFile;
  /** File extensions (lowercase, without the dot) this type can import. */
  importExtensions?: string[];
  /** Build content from an imported file. Throw NoteContentError if the file is unusable. */
  fromFile?(text: string, ext: string): C;
  /**
   * What the content still needs before the note can be saved, e.g. "Enter a web address"
   * (default: nothing). Every note also needs a name; see `missingForSave`.
   */
  missing?(content: C): string | undefined;
  /** Content for a new note made from something shared from another app (Android share sheet). */
  fromShared?(shared: SharedContent): C;
}

/** What another app shared: a web address and/or text. */
export interface SharedContent {
  url?: string;
  text?: string;
}

/**
 * Why a note cannot be saved yet, or undefined if it can. New notes are only created, and edits
 * only saved, once this passes; the server checks the same.
 */
export function missingForSave<C>(def: NoteTypeDef<C>, title: string, content: C): string | undefined {
  if (!title.trim()) return 'Enter a name';
  return def.missing?.(content);
}

export interface ExportedFile {
  /** Extension without the dot, e.g. "md". */
  ext: string;
  text: string;
}

export const defineNoteType = <C>(def: NoteTypeDef<C>): NoteTypeDef<C> => def;

export class NoteContentError extends Error {}

/** Upgrade stored content to the type's current version, then validate it. */
export function upgradeContent<C>(def: NoteTypeDef<C>, content: unknown, fromVersion: number): C {
  if (fromVersion > def.version) {
    throw new NoteContentError(`Content version ${fromVersion} is newer than supported (${def.version})`);
  }
  let value = content;
  for (let v = fromVersion; v < def.version; v++) {
    const migrate = def.migrations?.[v];
    if (!migrate) throw new NoteContentError(`Missing ${def.id} migration from version ${v}`);
    value = migrate(value);
  }
  return validateContent(def, value);
}

/** A note as a readable file. Types without `toFile` (and unreadable content) are exported as JSON. */
export function noteToFile(def: NoteTypeDef<any> | undefined, content: unknown, title: string): ExportedFile {
  if (def?.toFile) {
    try {
      return def.toFile(content, title);
    } catch {
      // Fall through to JSON.
    }
  }
  return { ext: 'json', text: JSON.stringify(content, null, 2) };
}

/** Remove a byte-order mark and normalise line endings of imported text. */
export const cleanText = (text: string) => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

export function validateContent<C>(def: NoteTypeDef<C>, content: unknown): C {
  const result = def.schema.safeParse(content);
  if (!result.success) {
    throw new NoteContentError(result.error.issues[0]?.message ?? `Invalid ${def.label} content`);
  }
  return result.data;
}
