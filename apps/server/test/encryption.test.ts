import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db';
import { users } from '../src/db/schema';
import { FileStore } from '../src/files/store';
import { client, makeApp } from './helpers';

const KEY = 'k'.repeat(40);
const OTHER_KEY = 'o'.repeat(40);
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-enc-'));

describe('encrypted database', () => {
  it('cannot be read without the key, also not its WAL', () => {
    const file = path.join(tempDir(), 'app.db');
    const db = openDb(file, KEY);
    db.insert(users).values({ id: 'u1', username: 'secret-user-name', displayName: 'Secret', passwordHash: 'h' }).run();
    // Fresh writes sit in the WAL first.
    expect(fs.readFileSync(`${file}-wal`).includes('secret-user-name')).toBe(false);
    db.$client.pragma('wal_checkpoint(TRUNCATE)');
    db.$client.close();

    const raw = fs.readFileSync(file);
    expect(raw.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(raw.includes('secret-user-name')).toBe(false);

    const again = openDb(file, KEY);
    expect(again.select().from(users).get()?.username).toBe('secret-user-name');
    again.$client.close();

    expect(() => openDb(file, OTHER_KEY)).toThrow(/ENCRYPTION_KEY is wrong/);
    expect(() => openDb(file)).toThrow(/it is encrypted/);
  });
});

describe('encrypted files', () => {
  it('are stored encrypted, served decrypted, and changes are detected', async () => {
    const { app, db, config } = await makeApp({ ENCRYPTION_KEY: KEY, LINK_PREVIEWS: 'false' });
    try {
      const alice = client(app);
      const aliceId = (await alice.register('alice')).json().id;
      const note = (await alice.post('/api/notes', { type: 'text', title: 'n', content: { text: 'x' } })).json();
      const store = new FileStore(db, config.dataDir, KEY);
      const data = Buffer.from('PREVIEW-IMAGE-BYTES-'.repeat(20));
      const file = store.save({ ownerId: aliceId, noteId: note.id, kind: 'link-image', mime: 'image/png', ext: 'png', data });

      const onDisk = fs.readFileSync(store.absolutePath(file));
      expect(onDisk.includes('PREVIEW-IMAGE-BYTES')).toBe(false);
      const res = await alice.get(`/api/files/${file.id}`);
      expect(res.statusCode).toBe(200);
      expect(res.rawPayload.equals(data)).toBe(true);

      // Another key cannot read it, and a changed byte on disk is noticed.
      expect(new FileStore(db, config.dataDir, OTHER_KEY).read(file)).toBeUndefined();
      onDisk[onDisk.length - 20]! ^= 1;
      fs.writeFileSync(store.absolutePath(file), onDisk);
      expect((await alice.get(`/api/files/${file.id}`)).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('encryption key setting', () => {
  it('is required in production, must be long enough, and can come from a file', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ENCRYPTION_KEY is required/);
    expect(() => loadConfig({ ENCRYPTION_KEY: 'too-short' })).toThrow(/too short/);
    expect(loadConfig({ NODE_ENV: 'production', ENCRYPTION_KEY: ` ${KEY}\n` }).encryptionKey).toBe(KEY);

    const keyFile = path.join(tempDir(), 'key');
    fs.writeFileSync(keyFile, `${KEY}\n`);
    expect(loadConfig({ NODE_ENV: 'production', ENCRYPTION_KEY_FILE: keyFile }).encryptionKey).toBe(KEY);
    expect(() => loadConfig({ ENCRYPTION_KEY_FILE: path.join(tempDir(), 'missing') })).toThrow(/Cannot read ENCRYPTION_KEY_FILE/);
    // Dev and tests: no key, nothing encrypted.
    expect(loadConfig({}).encryptionKey).toBeUndefined();
  });
});
