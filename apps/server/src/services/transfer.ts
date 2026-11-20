import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { noteColorSchema, noteIconSchema, type ImportResultDto } from '@notes/shared';
import {
  cleanText,
  getNoteType,
  NoteContentError,
  noteToFile,
  noteTypeForExtension,
  parseHttpUrl,
  upgradeContent,
} from '@notes/note-types';
import type { Db } from '../db';
import { folders, notes, type FolderRow, type NoteRow } from '../db/schema';
import { badRequest } from '../lib/errors';
import { getFolderFor, hiddenFolderIds, type Viewer } from './access';
import { isBookmarksFile, parseBookmarks, type BookmarkFolder } from './bookmarks';
import { runAfterSave } from './notes';

/*
 * Export: a zip with notes-export.json (everything needed to restore the notes exactly) plus
 * every note as a readable file (Markdown, text, code…) in the folder structure.
 * Import: such an export, a zip of Markdown/text/code files (e.g. from another notes app),
 * a browser bookmarks file, or single files. Imported items get new ids.
 */

export const EXPORT_FORMAT = 'notes-export';
const EXPORT_VERSION = 1;
const MANIFEST = 'notes-export.json';
const MAX_NOTES = 20_000;
const MAX_FOLDERS = 5_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 30_000;
const SKIPPED_LISTED = 50;

// ---- Export --------------------------------------------------------------------------------

const today = () => new Date().toISOString().slice(0, 10);

/** A file or folder name that is safe on Windows, macOS and Linux. */
export function safeName(name: string, fallback = 'Untitled') {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|[. ]+$/g, '')
    .slice(0, 100)
    .trim();
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) || !cleaned ? fallback : cleaned;
}

/** Hands out unique names per directory ("Name", "Name (2)", …), ignoring case. */
function uniqueNamer() {
  const used = new Map<string, Set<string>>();
  return (dir: string, base: string, ext = '') => {
    const set = used.get(dir) ?? new Set<string>();
    used.set(dir, set);
    let name = `${base}${ext}`;
    for (let i = 2; set.has(name.toLowerCase()); i++) name = `${base} (${i})${ext}`;
    set.add(name.toLowerCase());
    return name;
  };
}

export function exportArchive(db: Db, viewer: Viewer, folderId: string | null): { fileName: string; data: Uint8Array } {
  const hidden = hiddenFolderIds(db, viewer);
  const rootFolder = folderId ? getFolderFor(db, viewer, folderId, 'read') : null;

  // Folders reachable from the starting point without passing trashed or hidden ones.
  const candidates = rootFolder
    ? db.select().from(folders).where(and(eq(folders.ownerId, rootFolder.ownerId), isNull(folders.deletedAt))).all()
    : db.select().from(folders).where(and(eq(folders.ownerId, viewer.id), isNull(folders.deletedAt))).all();
  const children = new Map<string | null, FolderRow[]>();
  for (const f of candidates) if (!hidden.has(f.id)) children.set(f.parentId, [...(children.get(f.parentId) ?? []), f]);
  const included: FolderRow[] = [];
  const queue = rootFolder ? [...(children.get(rootFolder.id) ?? [])] : [...(children.get(null) ?? [])];
  while (queue.length) {
    const f = queue.shift()!;
    included.push(f);
    queue.push(...(children.get(f.id) ?? []));
  }
  const folderIds = [rootFolder?.id, ...included.map((f) => f.id)].filter((id): id is string => Boolean(id));

  const inFolders = folderIds.length ? inArray(notes.folderId, folderIds) : undefined;
  const noteRows = db
    .select()
    .from(notes)
    .where(
      and(
        isNull(notes.deletedAt),
        rootFolder ? inFolders : or(...[inFolders, and(isNull(notes.folderId), eq(notes.ownerId, viewer.id))].filter(Boolean)),
      ),
    )
    .all();

  // Readable copies: folder names become directories (the exported folder itself is the zip root).
  const nameIn = uniqueNamer();
  const dirOf = new Map<string | null, string>([[rootFolder?.id ?? null, '']]);
  for (const f of included) {
    const parentDir = dirOf.get(f.parentId) ?? '';
    dirOf.set(f.id, `${parentDir}${nameIn(parentDir, safeName(f.name, 'Folder'))}/`);
  }

  const files: Zippable = {};
  const manifestNotes = noteRows.map((n) => {
    const def = getNoteType(n.type);
    let readable: unknown = n.content;
    try {
      if (def) readable = upgradeContent(def, n.content, n.typeVersion);
    } catch {
      // Unreadable content is exported as stored.
    }
    const file = noteToFile(def, readable, n.title);
    const dir = dirOf.get(n.folderId) ?? '';
    const path = `${dir}${nameIn(dir, safeName(n.title || fallbackTitle(n), 'Untitled'), `.${file.ext}`)}`;
    files[path] = [strToU8(file.text), { mtime: n.updatedAt }];
    return {
      id: n.id,
      folderId: n.folderId === rootFolder?.id ? null : n.folderId,
      type: n.type,
      typeVersion: n.typeVersion,
      title: n.title,
      content: n.content,
      pinned: n.pinned,
      icon: n.icon,
      color: n.color,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      file: path,
    };
  });

  const manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    ...(rootFolder && { name: rootFolder.name }),
    folders: included.map((f) => ({
      id: f.id,
      parentId: f.parentId === rootFolder?.id ? null : f.parentId,
      name: f.name,
      createdAt: f.createdAt.toISOString(),
    })),
    notes: manifestNotes,
  };
  files[MANIFEST] = strToU8(JSON.stringify(manifest, null, 1));

  // The file is named after the app; the manifest inside keeps its format name (notes-export.json), so older exports still import.
  const base = rootFolder ? safeName(rootFolder.name, 'Folder') : 'magpie-export';
  return { fileName: `${base}-${today()}.zip`, data: zipSync(files, { level: 6 }) };
}

/** Untitled links are named after their address in exports. */
function fallbackTitle(n: NoteRow) {
  if (n.type !== 'link') return '';
  const url = parseHttpUrl(String((n.content as { url?: unknown })?.url ?? ''));
  return url ? url.hostname.replace(/^www\./, '') : '';
}

// ---- Import --------------------------------------------------------------------------------

const manifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.number().int().min(1),
  name: z.string().optional(),
  folders: z
    .array(z.object({ id: z.string().min(1), parentId: z.string().nullable(), name: z.string(), createdAt: z.string().optional() }))
    .max(MAX_FOLDERS),
  notes: z
    .array(
      z.object({
        folderId: z.string().nullable(),
        type: z.string().min(1).max(64),
        typeVersion: z.number().int().min(1),
        title: z.string(),
        content: z.unknown(),
        pinned: z.boolean().optional(),
        // Invalid values (e.g. from a hand-edited export) fall back to the default look.
        icon: noteIconSchema.nullable().optional().catch(null),
        color: noteColorSchema.nullable().optional().catch(null),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
        file: z.string().optional(),
      }),
    )
    .max(MAX_NOTES),
});
type Manifest = z.infer<typeof manifestSchema>;

const parseDate = (value: string | undefined) => {
  const d = value ? new Date(value) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

class Importer {
  folders = 0;
  notes = 0;
  skipped: ImportResultDto['skipped'] = [];
  skippedCount = 0;
  created: NoteRow[] = [];

  constructor(
    private readonly db: Db,
    private readonly viewer: Viewer,
    private readonly ownerId: string,
  ) {}

  skip(name: string, reason: string) {
    this.skippedCount++;
    if (this.skipped.length < SKIPPED_LISTED) this.skipped.push({ name, reason });
  }

  folder(parentId: string | null, name: string, createdAt?: Date): string {
    if (++this.folders > MAX_FOLDERS) throw badRequest(`An import can create at most ${MAX_FOLDERS} folders`);
    const id = crypto.randomUUID();
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Folder';
    this.db
      .insert(folders)
      .values({ id, ownerId: this.ownerId, parentId, name: clean, ...(createdAt && { createdAt, updatedAt: createdAt }) })
      .run();
    return id;
  }

  /** Unknown types and newer versions are kept as they are (shown read-only), so nothing is lost. */
  note(
    folderId: string | null,
    source: string,
    input: {
      type: string;
      typeVersion?: number;
      title: string;
      content: unknown;
      pinned?: boolean;
      icon?: string | null;
      color?: string | null;
      createdAt?: Date;
      updatedAt?: Date;
    },
  ) {
    const def = getNoteType(input.type);
    let content = input.content;
    let typeVersion = input.typeVersion ?? def?.version ?? 1;
    let searchText = '';
    if (def && typeVersion <= def.version) {
      try {
        content = upgradeContent(def, content, typeVersion);
        typeVersion = def.version;
        searchText = def.toSearchText(content);
      } catch (err) {
        this.skip(source, err instanceof Error ? err.message : 'Invalid content');
        return;
      }
    }
    if (++this.notes > MAX_NOTES) throw badRequest(`An import can create at most ${MAX_NOTES} notes`);
    const updatedAt = input.updatedAt ?? input.createdAt ?? new Date();
    const row = this.db
      .insert(notes)
      .values({
        id: crypto.randomUUID(),
        ownerId: this.ownerId,
        folderId,
        type: input.type,
        typeVersion,
        title: input.title.replace(/\s+/g, ' ').trim().slice(0, 300),
        content,
        searchText,
        pinned: input.pinned ?? false,
        icon: input.icon ?? null,
        color: input.color ?? null,
        createdAt: input.createdAt ?? updatedAt,
        updatedAt,
        updatedBy: this.viewer.id,
      })
      .returning()
      .get();
    this.created.push(row);
  }

  /** A single file by its extension; false if the type is not supported. */
  file(folderId: string | null, path: string, bytes: Uint8Array): boolean {
    const name = path.split('/').pop() ?? path;
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : name.toLowerCase();
    const def = noteTypeForExtension(ext);
    if (!def?.fromFile) return false;
    if (bytes.length > MAX_FILE_BYTES) {
      this.skip(path, 'File is larger than 5 MB');
      return true;
    }
    try {
      const content = def.fromFile(cleanText(new TextDecoder().decode(bytes)), ext);
      this.note(folderId, path, { type: def.id, title: dot > 0 ? name.slice(0, dot) : name, content });
    } catch (err) {
      this.skip(path, err instanceof NoteContentError ? err.message : 'Could not read the file');
    }
    return true;
  }

  manifest(parentId: string | null, m: Manifest) {
    if (m.version > EXPORT_VERSION) throw badRequest('This export was made by a newer version of the app');
    // Create folders parents-first; folders whose parent is missing go to the top of the import.
    const newIds = new Map<string, string>();
    const known = new Set(m.folders.map((f) => f.id));
    let pending = m.folders;
    while (pending.length) {
      const next = pending.filter((f) => f.parentId && known.has(f.parentId) && !newIds.has(f.parentId));
      const ready = pending.filter((f) => !next.includes(f));
      if (!ready.length) {
        // A cycle: attach the rest at the top.
        for (const f of next) newIds.set(f.id, this.folder(parentId, f.name, parseDate(f.createdAt)));
        break;
      }
      for (const f of ready) {
        const parent = f.parentId ? (newIds.get(f.parentId) ?? parentId) : parentId;
        newIds.set(f.id, this.folder(parent, f.name, parseDate(f.createdAt)));
      }
      pending = next;
    }
    for (const n of m.notes) {
      this.note(n.folderId ? (newIds.get(n.folderId) ?? parentId) : parentId, n.file ?? n.title, {
        type: n.type,
        typeVersion: n.typeVersion,
        title: n.title,
        content: n.content,
        pinned: n.pinned,
        icon: n.icon,
        color: n.color,
        createdAt: parseDate(n.createdAt),
        updatedAt: parseDate(n.updatedAt),
      });
    }
  }

  bookmarks(parentId: string | null, folder: BookmarkFolder) {
    for (const link of folder.links) {
      const url = parseHttpUrl(link.url);
      if (!url) {
        this.skip(link.title || link.url, 'Not a web address');
        continue;
      }
      this.note(parentId, link.title || link.url, {
        type: 'link',
        title: link.title,
        content: { url: url.toString(), description: link.description.slice(0, 100_000) },
        createdAt: link.addedAt,
      });
    }
    for (const sub of folder.folders) this.bookmarks(this.folder(parentId, sub.name), sub);
  }

  /** A zip without a manifest: its folders and supported files. */
  tree(parentId: string | null, entries: [string, Uint8Array][]) {
    const dirs = new Map<string, string | null>([['', parentId]]);
    const dirId = (dir: string): string | null => {
      if (dirs.has(dir)) return dirs.get(dir)!;
      const cut = dir.lastIndexOf('/');
      const id = this.folder(dirId(cut < 0 ? '' : dir.slice(0, cut)), dir.slice(cut + 1));
      dirs.set(dir, id);
      return id;
    };
    for (const [path, bytes] of entries) {
      const cut = path.lastIndexOf('/');
      const dir = cut < 0 ? '' : path.slice(0, cut);
      // Only create a folder once something is imported into it.
      const def = noteTypeForExtension(path.slice(path.lastIndexOf('.') + 1));
      if (!def?.fromFile || path.lastIndexOf('.') <= cut + 1) {
        this.skip(path, 'Unsupported file type');
        continue;
      }
      this.file(dirId(dir), path, bytes);
    }
  }

  result(folderId: string | null): ImportResultDto {
    return { folderId, folders: this.folders, notes: this.notes, skipped: this.skipped, skippedCount: this.skippedCount };
  }
}

const isZip = (data: Uint8Array) => data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || name;
const IGNORED = /(^|\/)(__MACOSX|\.[^/]*)(\/|$)/;

function readZip(data: Uint8Array): [string, Uint8Array][] {
  let entries = 0;
  let total = 0;
  try {
    const files = unzipSync(data, {
      filter: (f) => {
        if (f.name.endsWith('/') || IGNORED.test(f.name)) return false;
        if (++entries > MAX_ENTRIES) throw badRequest('The archive contains too many files');
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw badRequest('The archive is too large once unpacked');
        return true;
      },
    });
    return Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  } catch (err) {
    if (err instanceof Error && 'statusCode' in err) throw err;
    throw badRequest('The archive could not be read');
  }
}

function parseManifest(text: string): Manifest | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if ((json as { format?: unknown } | null)?.format !== EXPORT_FORMAT) return null;
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw badRequest('The export file is damaged or incomplete');
  return parsed.data;
}

export function importUpload(
  db: Db,
  viewer: Viewer,
  input: { name: string; data: Uint8Array; folderId: string | null; previews: boolean },
): ImportResultDto {
  // Imports go into a folder I can edit (and belong to its owner), or my own top level.
  const ownerId = input.folderId ? getFolderFor(db, viewer, input.folderId, 'write').ownerId : viewer.id;
  const target = input.folderId;
  const ext = input.name.includes('.') ? input.name.slice(input.name.lastIndexOf('.') + 1).toLowerCase() : '';
  const importer = new Importer(db, viewer, ownerId);

  const result = db.transaction(() => {
    let created: string | null = null;
    if (isZip(input.data)) {
      const entries = readZip(input.data);
      // The manifest may sit at the root or inside one top-level directory.
      const manifestEntry = entries.find(([p]) => p === MANIFEST || /^[^/]+\/notes-export\.json$/.test(p));
      const manifest = manifestEntry && parseManifest(strFromU8(manifestEntry[1]));
      if (manifest) {
        created = importer.folder(target, manifest.name ?? `Imported notes ${today()}`);
        importer.manifest(created, manifest);
      } else {
        created = importer.folder(target, baseName(input.name));
        importer.tree(created, entries);
      }
    } else {
      const text = cleanText(new TextDecoder().decode(input.data));
      const manifest = ext === 'json' ? parseManifest(text) : null;
      if (manifest) {
        created = importer.folder(target, manifest.name ?? `Imported notes ${today()}`);
        importer.manifest(created, manifest);
      } else if ((ext === 'html' || ext === 'htm') && isBookmarksFile(text)) {
        created = importer.folder(target, baseName(input.name));
        importer.bookmarks(created, parseBookmarks(text));
      } else if (!importer.file(target, input.name, input.data)) {
        throw badRequest(`"${input.name}" is not a supported file type`);
      }
    }
    if (importer.notes === 0 && importer.folders <= 1) {
      const first = importer.skipped[0];
      throw badRequest(first ? `Nothing could be imported: ${first.name}: ${first.reason}` : 'Nothing to import was found in this file');
    }
    return importer.result(created);
  });

  // Link previews are fetched in the background, like for links added by hand.
  if (input.previews) for (const row of importer.created) if (row.type === 'link') runAfterSave(db, row);
  return result;
}
