import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../src/config';
import type { Db } from '../src/db';
import { files, linkMeta } from '../src/db/schema';
import { FileStore } from '../src/files/store';
import { client, makeApp } from './helpers';

let app: FastifyInstance;
let db: Db;
let config: AppConfig;
let store: FileStore;
let alice: ReturnType<typeof client>;
let aliceId: string;

beforeEach(async () => {
  ({ app, db, config } = await makeApp({ LINK_PREVIEWS: 'false' }));
  store = new FileStore(db, config.dataDir);
  alice = client(app);
  aliceId = (await alice.register('alice')).json().id;
});
afterEach(async () => {
  await app.close();
});

const noteDir = (noteId: string) => path.join(config.dataDir, 'files', noteId);
/** A note with a stored file, like a link with its preview image. */
async function noteWithFile(c = alice, ownerId = aliceId, folderId: string | null = null) {
  const note = (await c.post('/api/notes', { type: 'text', title: 'n', folderId, content: { text: 'x' } })).json();
  const file = store.save({ ownerId, noteId: note.id, kind: 'link-image', mime: 'image/webp', ext: 'webp', data: Buffer.alloc(1000, 1) });
  return { note, file };
}
const age = (abs: string, hours = 2) => {
  const t = new Date(Date.now() - hours * 3600_000);
  fs.utimesSync(abs, t, t);
};

describe('stored files', () => {
  it('keeps each note’s files in its own folder until the note is deleted for good', async () => {
    const { note, file } = await noteWithFile();
    expect(file.path).toBe(path.join(note.id, `${file.id}.webp`));
    expect(fs.existsSync(noteDir(note.id))).toBe(true);

    await alice.delete(`/api/notes/${note.id}`);
    // In the trash: still restorable, so the files stay.
    expect(fs.existsSync(noteDir(note.id))).toBe(true);

    expect((await alice.delete(`/api/trash/note/${note.id}`)).statusCode).toBe(204);
    expect(fs.existsSync(noteDir(note.id))).toBe(false);
    expect(db.select().from(files).all()).toHaveLength(0);
  });

  it('removes files when a folder is purged, the trash is emptied, or a user is deleted', async () => {
    const folder = (await alice.post('/api/folders', { name: 'F' })).json();
    const a = await noteWithFile(alice, aliceId, folder.id);
    const b = await noteWithFile();
    await alice.delete(`/api/folders/${folder.id}`);
    await alice.delete(`/api/notes/${b.note.id}`);
    await alice.delete(`/api/trash/folder/${folder.id}`);
    expect(fs.existsSync(noteDir(a.note.id))).toBe(false);
    expect(fs.existsSync(noteDir(b.note.id))).toBe(true);
    await alice.delete('/api/trash');
    expect(fs.existsSync(noteDir(b.note.id))).toBe(false);

    const bob = client(app);
    const bobId = (await bob.register('bob')).json().id;
    const c = await noteWithFile(bob, bobId);
    expect((await alice.delete(`/api/admin/users/${bobId}`)).statusCode).toBe(204);
    expect(fs.existsSync(noteDir(c.note.id))).toBe(false);
  });
});

describe('storage clean-up (admin)', () => {
  it('removes everything unused and reports what it freed', async () => {
    const { note, file } = await noteWithFile();
    const root = path.join(config.dataDir, 'files');
    // A stray file nothing refers to (old) and one being written right now (new).
    fs.writeFileSync(path.join(root, note.id, 'stray.webp'), Buffer.alloc(500));
    age(path.join(root, note.id, 'stray.webp'));
    fs.writeFileSync(path.join(root, note.id, 'fresh.webp'), Buffer.alloc(10));
    // A leftover folder of a note that no longer exists, and an empty folder.
    fs.mkdirSync(path.join(root, '11111111-2222-3333-4444-555555555555'));
    fs.writeFileSync(path.join(root, '11111111-2222-3333-4444-555555555555', 'x.webp'), Buffer.alloc(300));
    fs.mkdirSync(path.join(root, 'ab'));
    // An entry whose file vanished, used by a link preview.
    const missing = store.save({ ownerId: aliceId, noteId: note.id, kind: 'link-icon', mime: 'image/png', ext: 'png', data: Buffer.alloc(5) });
    fs.rmSync(store.absolutePath(missing));
    db.insert(linkMeta).values({ noteId: note.id, url: 'https://x.test/', status: 'ok', faviconFileId: missing.id }).run();

    expect((await client(app).post('/api/admin/storage/prune')).statusCode).toBe(401);
    const res = await alice.post('/api/admin/storage/prune');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ noteFolders: 1, strayFiles: 1, missingFiles: 1, emptyFolders: 1, bytesFreed: 800 });
    expect(res.json().status.files).toEqual({ count: 2, bytes: 1010 });

    expect(fs.existsSync(store.absolutePath(file))).toBe(true);
    expect(fs.existsSync(path.join(root, note.id, 'fresh.webp'))).toBe(true);
    expect(db.select().from(linkMeta).get()!.faviconFileId).toBeNull();
  });

  it('shows storage use to admins only', async () => {
    await noteWithFile();
    const res = await alice.get('/api/admin/storage');
    expect(res.json()).toMatchObject({ files: { count: 1, bytes: 1000 } });
    expect(res.json().databaseBytes).toBeGreaterThan(0);
    const bob = client(app);
    await bob.register('bob');
    expect((await bob.get('/api/admin/storage')).statusCode).toBe(403);
  });
});
