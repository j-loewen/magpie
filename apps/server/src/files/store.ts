import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db';
import { files, notes, type FileRow } from '../db/schema';

/** Files that belong to no note (none today; kept apart so they are never mistaken for a note's). */
const UNATTACHED = '_unattached';
const NOTE_DIR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PruneReport {
  /** Note folders removed because their note no longer exists. */
  noteFolders: number;
  /** Files on disk without a database entry. */
  strayFiles: number;
  /** Database entries whose file was missing on disk. */
  missingFiles: number;
  /** Empty folders removed. */
  emptyFolders: number;
  bytesFreed: number;
}

/** Start of an encrypted file: magic, then IV, ciphertext and the GCM tag. */
const MAGIC = Buffer.from('NENC1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Files live on disk under <DATA_DIR>/files/<note id>/<file id>.<ext>, with a row in `files`.
 * A note's folder is removed as soon as the note is deleted permanently (rows go by cascade);
 * trashed notes keep their files so they can be restored.
 *
 * With an encryption key every file is encrypted (AES-256-GCM, key derived from ENCRYPTION_KEY),
 * so the files on disk are unreadable without it and changes to them are detected.
 */
export class FileStore {
  readonly root: string;
  private readonly key: Buffer | undefined;

  constructor(
    private readonly db: Db,
    dataDir: string,
    encryptionKey?: string,
  ) {
    this.root = path.join(dataDir, 'files');
    this.key = encryptionKey ? Buffer.from(hkdfSync('sha256', encryptionKey, 'notes', 'files', 32)) : undefined;
  }

  private seal(data: Buffer): Buffer {
    if (!this.key) return data;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
  }

  private open(stored: Buffer): Buffer {
    if (!this.key) return stored;
    if (stored.length < MAGIC.length + IV_BYTES + TAG_BYTES || !stored.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Stored file is not encrypted with this store');
    }
    const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
    const tag = stored.subarray(stored.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(stored.subarray(MAGIC.length + IV_BYTES, stored.length - TAG_BYTES)), decipher.final()]);
  }

  /** A stored file's content (decrypted); undefined if it is missing, damaged or was changed. */
  read(row: Pick<FileRow, 'path'>): Buffer | undefined {
    try {
      return this.open(fs.readFileSync(this.absolutePath(row)));
    } catch {
      return undefined;
    }
  }

  absolutePath(row: Pick<FileRow, 'path'>) {
    return path.join(this.root, row.path);
  }

  private relativePath(noteId: string | null, id: string, ext: string) {
    return path.join(noteId ?? UNATTACHED, `${id}.${ext}`);
  }

  save(input: { ownerId: string; noteId: string | null; kind: string; mime: string; ext: string; data: Buffer }): FileRow {
    const id = crypto.randomUUID();
    const rel = this.relativePath(input.noteId, id, input.ext);
    const abs = path.join(this.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // Write to a temp name first so a crash never leaves a half-written file under the real name.
    fs.writeFileSync(`${abs}.tmp`, this.seal(input.data));
    fs.renameSync(`${abs}.tmp`, abs);
    return this.db
      .insert(files)
      .values({ id, ownerId: input.ownerId, noteId: input.noteId, kind: input.kind, mime: input.mime, size: input.data.length, path: rel })
      .returning()
      .get();
  }

  get(id: string): FileRow | undefined {
    return this.db.select().from(files).where(eq(files.id, id)).get();
  }

  delete(ids: (string | null | undefined)[]) {
    const list = ids.filter((id): id is string => Boolean(id));
    if (list.length === 0) return;
    const rows = this.db.select().from(files).where(inArray(files.id, list)).all();
    this.db.delete(files).where(inArray(files.id, list)).run();
    for (const row of rows) fs.rmSync(this.absolutePath(row), { force: true });
  }

  /** Remove the folders of notes that no longer exist (deleted permanently). */
  removeDeletedNotes(): { folders: number; bytes: number } {
    if (!fs.existsSync(this.root)) return { folders: 0, bytes: 0 };
    const dirs = fs.readdirSync(this.root).filter((d) => NOTE_DIR.test(d));
    if (!dirs.length) return { folders: 0, bytes: 0 };
    const existing = new Set<string>();
    // Ask in chunks to stay below SQLite's parameter limit.
    for (let i = 0; i < dirs.length; i += 500) {
      const chunk = dirs.slice(i, i + 500);
      for (const r of this.db.select({ id: notes.id }).from(notes).where(inArray(notes.id, chunk)).all()) existing.add(r.id);
    }
    let folders = 0;
    let bytes = 0;
    for (const dir of dirs) {
      if (existing.has(dir)) continue;
      const abs = path.join(this.root, dir);
      bytes += sizeOf(abs);
      fs.rmSync(abs, { recursive: true, force: true });
      folders++;
    }
    return { folders, bytes };
  }

  /**
   * Full clean-up: folders of deleted notes, files without a database entry (older than
   * `minAgeMs`, so files being written right now are safe), entries whose file is gone, and
   * empty folders.
   */
  prune(minAgeMs = 10 * 60 * 1000): PruneReport {
    const report: PruneReport = { noteFolders: 0, strayFiles: 0, missingFiles: 0, emptyFolders: 0, bytesFreed: 0 };
    const deleted = this.removeDeletedNotes();
    report.noteFolders = deleted.folders;
    report.bytesFreed = deleted.bytes;

    const rows = this.db.select({ id: files.id, path: files.path }).from(files).all();
    const known = new Set(rows.map((r) => path.normalize(r.path)));
    const cutoff = Date.now() - minAgeMs;
    for (const rel of walk(this.root)) {
      if (known.has(rel)) continue;
      const abs = path.join(this.root, rel);
      const stat = fs.statSync(abs);
      if (stat.mtimeMs > cutoff) continue;
      fs.rmSync(abs, { force: true });
      report.strayFiles++;
      report.bytesFreed += stat.size;
    }

    const missing = rows.filter((r) => !fs.existsSync(path.join(this.root, r.path))).map((r) => r.id);
    // Link previews pointing at these files lose the image (ON DELETE SET NULL); "Refresh" fetches it again.
    for (let i = 0; i < missing.length; i += 500) this.db.delete(files).where(inArray(files.id, missing.slice(i, i + 500))).run();
    report.missingFiles = missing.length;

    report.emptyFolders = this.removeEmptyFolders();
    return report;
  }

  /** Number of stored files and their total size on disk. */
  usage(): { count: number; bytes: number } {
    let count = 0;
    let bytes = 0;
    for (const rel of walk(this.root)) {
      count++;
      bytes += fs.statSync(path.join(this.root, rel)).size;
    }
    return { count, bytes };
  }

  private removeEmptyFolders(): number {
    if (!fs.existsSync(this.root)) return 0;
    let removed = 0;
    for (const dir of fs.readdirSync(this.root)) {
      const abs = path.join(this.root, dir);
      if (fs.statSync(abs).isDirectory() && fs.readdirSync(abs).length === 0) {
        fs.rmdirSync(abs);
        removed++;
      }
    }
    return removed;
  }
}

/** Relative paths of all files below `root` (one folder level, like the layout). */
function* walk(root: string): Generator<string> {
  if (!fs.existsSync(root)) return;
  for (const dir of fs.readdirSync(root)) {
    const abs = path.join(root, dir);
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) {
      yield dir;
      continue;
    }
    for (const name of fs.readdirSync(abs)) {
      if (fs.statSync(path.join(abs, name)).isFile()) yield path.join(dir, name);
    }
  }
}

function sizeOf(dir: string): number {
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    const stat = fs.statSync(path.join(dir, name));
    total += stat.isDirectory() ? sizeOf(path.join(dir, name)) : stat.size;
  }
  return total;
}
