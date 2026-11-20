import { z } from 'zod';
import type { Permission } from './sharing';

const id = z.string().min(1).max(64);
const folderName = z.string().trim().min(1, 'Name is required').max(120, 'At most 120 characters');
const noteTitle = z.string().trim().max(300, 'At most 300 characters');

// ---- Folders ------------------------------------------------------------------

export const createFolderSchema = z.object({
  name: folderName,
  /** null / omitted = top level */
  parentId: id.nullable().optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z.object({
  name: folderName.optional(),
  parentId: id.nullable().optional(),
  /** Hide the folder (and everything in it) until private folders are unlocked. */
  private: z.boolean().optional(),
});
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

export interface FolderDto {
  id: string;
  parentId: string | null;
  name: string;
  /** Notes directly in this folder (not counting subfolders). */
  noteCount: number;
  /** Marked private by the current user (its subfolders are private too, without their own flag). */
  isPrivate: boolean;
  ownerId: string;
  /** Owner's display name (shown for folders shared with me). */
  ownerName: string;
  /** What the current user may do here. */
  permission: Permission;
  /** Number of people this folder itself is shared with (owner only; 0 otherwise). */
  shareCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- Notes ----------------------------------------------------------------------

/** 'manual' = my own order, arranged by drag and drop (see `noteOrder` in the folder view). */
export const NOTE_SORTS = ['updated', 'created', 'title', 'manual'] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

/** Most notes a manual order remembers per folder. */
export const MAX_NOTE_ORDER = 10_000;

/**
 * Notes in my manual order: pinned notes first, then the order I arranged. Notes not in that order
 * yet (new notes, notes moved here) come last, in the order they are given in (oldest first from
 * the server), so new notes land at the bottom.
 */
export function applyNoteOrder<T extends { id: string; pinned: boolean }>(notes: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return notes
    .map((n, i) => ({ n, key: rank.get(n.id) ?? order.length + i }))
    .sort((a, b) => Number(b.n.pinned) - Number(a.n.pinned) || a.key - b.key)
    .map(({ n }) => n);
}

/**
 * Note layouts: full cards in rows, cards of their natural height in columns (masonry), compact
 * cards (icon + name) or a list.
 */
export const NOTE_VIEWS = ['grid', 'masonry', 'compact', 'list'] as const;
export type NoteView = (typeof NOTE_VIEWS)[number];
/** Number of card size steps (0 = smallest). */
export const CARD_SIZE_STEPS = 5;

/** How one user shows the notes of one folder. Each user has their own, also in shared folders. */
export const folderViewSchema = z.object({
  sort: z.enum(NOTE_SORTS),
  view: z.enum(NOTE_VIEWS),
  cardSize: z
    .number()
    .int()
    .min(0)
    .max(CARD_SIZE_STEPS - 1),
  /** Note ids in my manual order. Kept when I switch to another sort, so I can come back to it. */
  noteOrder: z.array(id).max(MAX_NOTE_ORDER),
});
export type FolderViewDto = z.infer<typeof folderViewSchema>;
export const DEFAULT_FOLDER_VIEW: FolderViewDto = { sort: 'updated', view: 'grid', cardSize: 2, noteOrder: [] };

export const updateFolderViewSchema = folderViewSchema.partial().extend({
  /** null = Home (my top level). */
  folderId: id.nullable(),
});
export type UpdateFolderViewInput = z.infer<typeof updateFolderViewSchema>;

export const createNoteSchema = z.object({
  /**
   * Id chosen by the client (a UUID), so a new note has its final address while it is still an
   * unsaved draft. Omit to let the server pick one. An id that is already taken is refused (409).
   */
  id: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid note id')
    .transform((v) => v.toLowerCase())
    .optional(),
  type: z.string().min(1).max(64),
  folderId: id.nullable().optional(),
  title: noteTitle.optional(),
  /** Omit to start with the type's default content. */
  content: z.unknown().optional(),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

/** Full save of title + content; `version` must match the stored version (optimistic locking). */
export const saveNoteSchema = z.object({
  title: noteTitle,
  content: z.unknown(),
  version: z.number().int().min(1),
});
export type SaveNoteInput = z.infer<typeof saveNoteSchema>;

/** Key of an icon in the client's icon set, e.g. "star". */
export const noteIconSchema = z.string().regex(/^[a-z0-9-]{1,40}$/, 'Invalid icon');
/** Background colour of the note icon, #rrggbb. */
export const noteColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be #rrggbb')
  .transform((c) => c.toLowerCase());

/** Metadata changes that do not conflict with content edits. */
export const patchNoteSchema = z.object({
  folderId: id.nullable().optional(),
  pinned: z.boolean().optional(),
  /** null = back to the type's default icon (the favicon for links). */
  icon: noteIconSchema.nullable().optional(),
  /** null = back to the default colour. */
  color: noteColorSchema.nullable().optional(),
});
export type PatchNoteInput = z.input<typeof patchNoteSchema>;

/** How a note's icon looks. Both null = the type's default. */
export interface NoteAppearance {
  icon: string | null;
  color: string | null;
}

export interface NoteSummaryDto extends NoteAppearance {
  id: string;
  folderId: string | null;
  type: string;
  title: string;
  /** Start of the note's searchable text, for previews. */
  excerpt: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  permission: Permission;
  /** Number of people this note itself is shared with (owner only; 0 otherwise). */
  shareCount: number;
  ownerName: string;
  /** Who saved the current version, when it was someone else. */
  updatedByName?: string;
  /** Server-provided data for some note types (link notes: LinkMetaDto). Not part of the content. */
  meta?: unknown;
}

export interface NoteDto extends Omit<NoteSummaryDto, 'excerpt'> {
  typeVersion: number;
  content: unknown;
  version: number;
  /**
   * Set when this server version cannot edit the note: its type is unknown (removed plugin) or
   * newer than this version of the app. The note is shown read-only and never overwritten.
   */
  readOnlyReason?: 'unknown-type' | 'newer-version' | 'invalid-content';
}

/** `details` of a 409 response to a save with a stale version. */
export interface NoteConflictDetails {
  current: NoteDto;
}

// ---- Trash & search --------------------------------------------------------------

export interface TrashDto {
  folders: { id: string; name: string; deletedAt: string; noteCount: number; folderCount: number }[];
  notes: { id: string; title: string; type: string; deletedAt: string }[];
  /** Items are deleted permanently this many days after being moved to the trash. */
  retentionDays: number;
}

export const restoreSchema = z.object({
  kind: z.enum(['folder', 'note']),
  id,
});

export interface SearchResultDto extends NoteAppearance {
  id: string;
  folderId: string | null;
  type: string;
  title: string;
  /** Server data for some note types, as in NoteSummaryDto (e.g. the favicon of links). */
  meta?: unknown;
  /** Owner's name, for notes shared with me. */
  ownerName?: string;
  /** Matching text; matches are wrapped in \u0001 … \u0002 (rendered as highlights by the client). */
  snippet: string;
  updatedAt: string;
}
