import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sessions } from '../src/db/schema';
import type { Db } from '../src/db';
import { client, makeApp } from './helpers';

let app: FastifyInstance;
let db: Db;
let alice: ReturnType<typeof client>;

beforeEach(async () => {
  ({ app, db } = await makeApp());
  alice = client(app);
  await alice.register('alice');
});
afterEach(async () => {
  await app.close();
});

const setPin = (c = alice, secret = '2468') =>
  c.put('/api/privacy/secret', { kind: 'pin', secret, accountPassword: 'password123' });
const folder = async (name: string, parentId: string | null = null) => (await alice.post('/api/folders', { name, parentId })).json();
const note = async (folderId: string | null, text: string) =>
  (await alice.post('/api/notes', { type: 'text', folderId, title: text, content: { text } })).json();
const folderNames = async (c = alice) => (await c.get('/api/folders')).json().map((f: { name: string }) => f.name);

/** A private folder "Diary" with a subfolder and notes, plus a normal folder. */
async function privateSetup() {
  await setPin();
  const diary = await folder('Diary');
  const sub = await folder('2026', diary.id);
  const n1 = await note(diary.id, 'secret alpha');
  const n2 = await note(sub.id, 'secret beta');
  const work = await folder('Work');
  const n3 = await note(work.id, 'public gamma');
  expect((await alice.patch(`/api/folders/${diary.id}`, { private: true })).json().isPrivate).toBe(true);
  return { diary, sub, n1, n2, work, n3 };
}

describe('PIN setup', () => {
  it('requires the account password and reports the status', async () => {
    expect((await alice.get('/api/privacy')).json()).toEqual({ hasSecret: false, kind: null, unlockedUntil: null, unlockedForMs: null, lockedOutUntil: null });
    const wrong = await alice.put('/api/privacy/secret', { kind: 'pin', secret: '2468', accountPassword: 'nope' });
    expect(wrong.statusCode).toBe(400);
    expect((await alice.put('/api/privacy/secret', { kind: 'pin', secret: '12a', accountPassword: 'password123' })).statusCode).toBe(400);
    expect((await setPin()).json()).toMatchObject({ hasSecret: true, kind: 'pin', unlockedUntil: null });
  });

  it('cannot make a folder private before a PIN is set', async () => {
    const f = await folder('X');
    expect((await alice.patch(`/api/folders/${f.id}`, { private: true })).statusCode).toBe(400);
  });
});

describe('private folders while locked', () => {
  it('hides the folder, its subfolders, their notes, search hits and trash entries', async () => {
    const { diary, sub, n1, n2, n3 } = await privateSetup();

    expect(await folderNames()).toEqual(['Work']);
    expect((await alice.get(`/api/notes?folderId=${diary.id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/notes?folderId=${sub.id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/notes/${n1.id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/notes/${n2.id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/notes/${n3.id}`)).statusCode).toBe(200);
    expect((await alice.get('/api/search?q=secret')).json()).toEqual([]);
    expect((await alice.get('/api/search?q=gamma')).json()).toHaveLength(1);

    // Writes are refused just like reads.
    expect((await alice.put(`/api/notes/${n1.id}`, { title: 'x', content: { text: 'x' }, version: 1 })).statusCode).toBe(404);
    expect((await alice.post('/api/notes', { type: 'text', folderId: diary.id })).statusCode).toBe(404);
    expect((await alice.patch(`/api/notes/${n3.id}`, { folderId: sub.id })).statusCode).toBe(404);
    expect((await alice.patch(`/api/folders/${diary.id}`, { private: false })).statusCode).toBe(404);
  });

  it('keeps trashed private items out of the trash view and away from "empty trash"', async () => {
    await setPin();
    const diary = await folder('Diary');
    const inside = await note(diary.id, 'secret');
    await alice.delete(`/api/notes/${inside.id}`); // trashed while visible
    await alice.patch(`/api/folders/${diary.id}`, { private: true });

    expect((await alice.get('/api/trash')).json().notes).toEqual([]);
    expect((await alice.post('/api/trash/restore', { kind: 'note', id: inside.id })).statusCode).toBe(404);
    expect((await alice.delete('/api/trash')).statusCode).toBe(204);

    await alice.post('/api/privacy/unlock', { secret: '2468' });
    expect((await alice.get('/api/trash')).json().notes).toHaveLength(1); // survived "empty trash"
  });

  it('refuses to trash a folder that contains a hidden private folder', async () => {
    await setPin();
    const parent = await folder('Parent');
    const hidden = await folder('Hidden', parent.id);
    await alice.patch(`/api/folders/${hidden.id}`, { private: true });
    expect((await alice.delete(`/api/folders/${parent.id}`)).statusCode).toBe(409);

    await alice.post('/api/privacy/unlock', { secret: '2468' });
    expect((await alice.delete(`/api/folders/${parent.id}`)).statusCode).toBe(204);
  });
});

describe('unlocking', () => {
  it('shows everything for the configured minutes, in this session only', async () => {
    const { n2 } = await privateSetup();
    await alice.patch('/api/me/prefs', { unlockMinutes: 3 });

    expect((await alice.post('/api/privacy/unlock', { secret: '0000' })).statusCode).toBe(400);
    const res = await alice.post('/api/privacy/unlock', { secret: '2468' });
    expect(res.statusCode).toBe(200);
    const until = new Date(res.json().unlockedUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(2.9 * 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(3 * 60_000);
    expect(res.json().unlockedForMs).toBeGreaterThan(2.9 * 60_000);
    expect(res.json().unlockedForMs).toBeLessThanOrEqual(3 * 60_000);

    expect(await folderNames()).toEqual(['2026', 'Diary', 'Work']);
    expect((await alice.get(`/api/notes/${n2.id}`)).statusCode).toBe(200);
    expect((await alice.get('/api/search?q=secret')).json()).toHaveLength(2);

    // A second login (another device) is still locked.
    const phone = client(app);
    await phone.login('alice');
    expect(await folderNames(phone)).toEqual(['Work']);
  });

  it('locks again on "lock now" and when the time is up; extend only works while unlocked', async () => {
    await privateSetup();
    await alice.post('/api/privacy/unlock', { secret: '2468' });
    expect((await alice.post('/api/privacy/extend')).statusCode).toBe(200);
    await alice.post('/api/privacy/lock');
    expect(await folderNames()).toEqual(['Work']);
    expect((await alice.post('/api/privacy/extend')).statusCode).toBe(403);

    await alice.post('/api/privacy/unlock', { secret: '2468' });
    db.update(sessions).set({ privateUnlockedUntil: new Date(Date.now() - 1000) }).run(); // time passes
    expect(await folderNames()).toEqual(['Work']);
    expect((await alice.get('/api/privacy')).json()).toMatchObject({ unlockedUntil: null, unlockedForMs: null });
  });

  it('locks out after 5 wrong attempts, even for the right PIN', async () => {
    await setPin();
    for (let i = 0; i < 5; i++) expect((await alice.post('/api/privacy/unlock', { secret: '1111' })).statusCode).toBe(400);
    const res = await alice.post('/api/privacy/unlock', { secret: '2468' });
    expect(res.statusCode).toBe(429);
    expect(res.json().message).toMatch(/Try again in 1 minute/);
    expect((await alice.get('/api/privacy')).json().lockedOutUntil).not.toBeNull();
  });
});

describe('removing the PIN', () => {
  it('turns private folders back into normal folders', async () => {
    await privateSetup();
    const res = await alice.delete('/api/privacy/secret', { accountPassword: 'password123' });
    expect(res.json()).toMatchObject({ hasSecret: false });
    expect(await folderNames()).toEqual(['2026', 'Diary', 'Work']);
  });
});

describe('other users', () => {
  it('are unaffected by and cannot see private folders', async () => {
    const { diary } = await privateSetup();
    const bob = client(app);
    await bob.register('bob');
    expect(await folderNames(bob)).toEqual([]);
    expect((await bob.post('/api/privacy/unlock', { secret: '2468' })).statusCode).toBe(400); // bob has no PIN
    expect((await bob.patch(`/api/folders/${diary.id}`, { private: false })).statusCode).toBe(404);
  });
});
