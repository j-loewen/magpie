import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { NoteSort, NoteView, Role, SsoProvider, UserPrefs } from '@notes/shared';

const now = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    /** Empty for accounts created through a sign-in provider without a password. */
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<Role>().notNull().default('user'),
    prefs: text('prefs', { mode: 'json' }).$type<Partial<UserPrefs>>().notNull().default({}),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [uniqueIndex('users_username_lower_uq').on(sql`lower(${t.username})`)],
);

/**
 * Accounts at sign-in providers (OIDC, GitHub) connected to a user. A user has at most one per
 * provider; each provider account belongs to at most one user.
 */
export const userIdentities = sqliteTable(
  'user_identities',
  {
    provider: text('provider').$type<SsoProvider>().notNull(),
    /** Stable account id at the provider: "<issuer> <sub>" for OIDC, the numeric user id for GitHub. */
    subject: text('subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Account name shown in Settings (GitHub login, email, …). */
    label: text('label').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.provider, t.subject] }), uniqueIndex('user_identities_user_provider_uq').on(t.userId, t.provider)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    /** Private folders are visible for this session until this time (milestone 4). */
    privateUnlockedUntil: integer('private_unlocked_until', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    /** Set when moved to the trash. Everything trashed together shares the same timestamp. */
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('folders_owner_idx').on(t.ownerId), index('folders_parent_idx').on(t.parentId)],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** null = top level ("Home"). */
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    typeVersion: integer('type_version').notNull(),
    title: text('title').notNull().default(''),
    content: text('content', { mode: 'json' }).notNull(),
    /** Plain text from the type's toSearchText(); indexed by notes_fts (see migration 0002). */
    searchText: text('search_text').notNull().default(''),
    /** Incremented on every content save; used for conflict detection. */
    version: integer('version').notNull().default(1),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /** Chosen icon (key into the client's icon set); null = the type's default (favicon for links, else type icon). */
    icon: text('icon'),
    /** Chosen background colour as #rrggbb; null = the type's default. */
    color: text('color'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
    /** Who saved the current version (differs from the owner in shared folders). */
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('notes_owner_folder_idx').on(t.ownerId, t.folderId), index('notes_deleted_idx').on(t.deletedAt)],
);

/** A folder (with everything inside it) shared with another user. */
export const folderShares = sqliteTable(
  'folder_shares',
  {
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').$type<'view' | 'edit'>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.folderId, t.userId] }), index('folder_shares_user_idx').on(t.userId)],
);

/** A single note shared with another user. */
export const noteShares = sqliteTable(
  'note_shares',
  {
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').$type<'view' | 'edit'>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.userId] }), index('note_shares_user_idx').on(t.userId)],
);

/** Files stored under <DATA_DIR>/files (link preview images, favicons; attachments later). */
export const files = sqliteTable(
  'files',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    noteId: text('note_id').references(() => notes.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    /** Path relative to <DATA_DIR>/files. */
    path: text('path').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [index('files_note_idx').on(t.noteId)],
);

/** Page metadata fetched for link notes. Kept apart from note content so fetches never conflict with edits. */
export const linkMeta = sqliteTable('link_meta', {
  noteId: text('note_id')
    .primaryKey()
    .references(() => notes.id, { onDelete: 'cascade' }),
  /** The URL this metadata belongs to; a different URL in the note means it is stale. */
  url: text('url').notNull(),
  status: text('status').$type<'pending' | 'ok' | 'error'>().notNull(),
  finalUrl: text('final_url'),
  title: text('title'),
  description: text('description'),
  siteName: text('site_name'),
  ogType: text('og_type'),
  contentType: text('content_type'),
  imageFileId: text('image_file_id').references(() => files.id, { onDelete: 'set null' }),
  faviconFileId: text('favicon_file_id').references(() => files.id, { onDelete: 'set null' }),
  jsonLd: text('json_ld', { mode: 'json' }).$type<unknown[]>(),
  error: text('error'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }),
});

/** A user's private-folder PIN/password (separate from the login password). */
export const userPrivacy = sqliteTable('user_privacy', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretHash: text('secret_hash').notNull(),
  kind: text('kind').$type<'pin' | 'password'>().notNull(),
  /** Consecutive wrong attempts; reset on success. */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
});

/**
 * Folders a user has marked private. Per viewer (not per folder), so a user can later also hide a
 * folder someone shared with them. Everything below a private folder is private too.
 */
export const folderPrivate = sqliteTable(
  'folder_private',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => folders.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.userId, t.folderId] })],
);

/**
 * How a user shows the notes of a folder (sort, layout, card size, manual order). Per user, so people a folder is
 * shared with keep their own. Rows stay when a share ends, so they come back if it is shared again.
 */
export const folderViews = sqliteTable(
  'folder_views',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** null = the user's top level (Home). */
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'cascade' }),
    sort: text('sort').$type<NoteSort>().notNull(),
    view: text('view').$type<NoteView>().notNull(),
    cardSize: integer('card_size').notNull(),
    /** Note ids in my manual order (JSON array). */
    noteOrder: text('note_order', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(now),
  },
  // One row per user and folder; Home ('' here) counts as a folder.
  (t) => [uniqueIndex('folder_views_user_folder_uq').on(t.userId, sql`ifnull(${t.folderId}, '')`)],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type LinkMetaRow = typeof linkMeta.$inferSelect;
