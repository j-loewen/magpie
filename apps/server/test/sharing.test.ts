import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { client, makeApp } from './helpers';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeApp>>['db'];
type Client = ReturnType<typeof client>;
let alice: Client; // owner (and admin: first user)
let bob: Client;
let carol: Client;
const ids: Record<string, string> = {};

beforeEach(async () => {
  ({ app, db } = await makeApp());
  alice = client(app);
  bob = client(app);
  carol = client(app);
  ids.alice = (await alice.register('alice')).json().id;
  ids.bob = (await bob.register('bob')).json().id;
  ids.carol = (await carol.register('carol')).json().id;
});
afterEach(async () => {
  await app.close();
});

const folder = async (c: Client, name: string, parentId: string | null = null) =>
  (await c.post('/api/folders', { name, parentId })).json();
const note = async (c: Client, folderId: string | null, text: string) =>
  (await c.post('/api/notes', { type: 'text', folderId, title: text, content: { text } })).json();
const shareWith = (kind: 'folder' | 'note', id: string, user: string, permission: 'view' | 'edit') =>
  alice.put('/api/shares', { kind, id, userId: ids[user], permission });
const save = (c: Client, n: { id: string; version: number }, text: string) =>
  c.put(`/api/notes/${n.id}`, { title: text, content: { text }, version: n.version });

/** Alice: Recipes/{Cakes} with notes, plus Private stuff. */
async function setup() {
  const recipes = await folder(alice, 'Recipes');
  const cakes = await folder(alice, 'Cakes', recipes.id);
  const soup = await note(alice, recipes.id, 'tomato soup');
  const cake = await note(alice, cakes.id, 'lemon cake');
  const diary = await folder(alice, 'Diary');
  const entry = await note(alice, diary.id, 'dear diary');
  return { recipes, cakes, soup, cake, diary, entry };
}

describe('sharing a folder', () => {
  it('nothing is shared by default', async () => {
    await setup();
    expect((await bob.get('/api/folders')).json()).toEqual([]);
    expect((await bob.get('/api/shared')).json()).toEqual([]);
    expect((await bob.get('/api/search?q=soup')).json()).toEqual([]);
  });

  it('view: recipient sees the folder, its subfolders and notes, but cannot change anything', async () => {
    const { recipes, cakes, soup, cake, entry } = await setup();
    expect((await shareWith('folder', recipes.id, 'bob', 'view')).statusCode).toBe(200);

    const shared = (await bob.get('/api/shared')).json();
    expect(shared).toEqual([expect.objectContaining({ kind: 'folder', id: recipes.id, name: 'Recipes', permission: 'view' })]);
    expect(shared[0].owner).toMatchObject({ username: 'alice' });

    const folders = (await bob.get('/api/folders')).json();
    expect(folders.map((f: { name: string }) => f.name)).toEqual(['Cakes', 'Recipes']);
    expect(folders.find((f: { id: string }) => f.id === recipes.id)).toMatchObject({ parentId: null, permission: 'view', ownerName: 'alice' });
    expect(folders.find((f: { id: string }) => f.id === cakes.id)).toMatchObject({ parentId: recipes.id, permission: 'view' });

    expect((await bob.get(`/api/notes?folderId=${cakes.id}`)).json()).toEqual([expect.objectContaining({ id: cake.id, permission: 'view' })]);
    expect((await bob.get(`/api/notes/${soup.id}`)).json()).toMatchObject({ permission: 'view', folderId: recipes.id });
    expect((await bob.get(`/api/notes/${entry.id}`)).statusCode).toBe(404); // not shared
    expect((await bob.get('/api/search?q=soup')).json()).toHaveLength(1);
    expect((await bob.get('/api/search?q=diary')).json()).toEqual([]);

    expect((await save(bob, soup, 'hacked')).statusCode).toBe(403);
    expect((await bob.post('/api/notes', { type: 'text', folderId: recipes.id })).statusCode).toBe(403);
    expect((await bob.post('/api/folders', { name: 'x', parentId: recipes.id })).statusCode).toBe(403);
    expect((await bob.patch(`/api/folders/${cakes.id}`, { name: 'x' })).statusCode).toBe(403);
    expect((await bob.delete(`/api/notes/${soup.id}`)).statusCode).toBe(403);
    expect((await bob.delete(`/api/folders/${recipes.id}`)).statusCode).toBe(403);

    // Carol got nothing.
    expect((await carol.get('/api/folders')).json()).toEqual([]);
    expect((await carol.get(`/api/notes/${soup.id}`)).statusCode).toBe(404);
  });

  it('edit: recipient edits, creates and moves inside, but cannot delete or reshare', async () => {
    const { recipes, cakes, soup } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'edit');

    const saved = await save(bob, soup, 'tomato soup with basil');
    expect(saved.statusCode).toBe(200);
    // The owner sees who changed it.
    expect((await alice.get(`/api/notes/${soup.id}`)).json()).toMatchObject({ updatedByName: 'bob', version: 2 });

    const created = await note(bob, recipes.id, 'pancakes');
    expect(created).toMatchObject({ permission: 'edit' });
    const sub = await folder(bob, 'Breakfast', recipes.id);
    expect(sub).toMatchObject({ ownerId: ids.alice, permission: 'edit' }); // belongs to the folder owner
    expect((await alice.get(`/api/notes?folderId=${recipes.id}`)).json().map((n: { title: string }) => n.title)).toContain('pancakes');

    expect((await bob.patch(`/api/notes/${created.id}`, { folderId: sub.id })).statusCode).toBe(200);
    expect((await bob.patch(`/api/folders/${sub.id}`, { name: 'Morning', parentId: cakes.id })).statusCode).toBe(200);

    // Out of the shared tree: into bob's own folder, or to alice's top level.
    const own = await folder(bob, 'Mine');
    expect((await bob.patch(`/api/notes/${created.id}`, { folderId: own.id })).statusCode).toBe(400);
    expect((await bob.patch(`/api/notes/${created.id}`, { folderId: null })).statusCode).toBe(403);

    expect((await bob.delete(`/api/notes/${soup.id}`)).statusCode).toBe(403);
    expect((await bob.put('/api/shares', { kind: 'folder', id: recipes.id, userId: ids.carol, permission: 'view' })).statusCode).toBe(403);
    expect((await bob.get(`/api/shares?kind=folder&id=${recipes.id}`)).statusCode).toBe(403);
  });

  it('the share on the nearest folder counts', async () => {
    const { recipes, cakes, soup, cake } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'view');
    await shareWith('folder', cakes.id, 'bob', 'edit');
    expect((await save(bob, cake, 'chocolate cake')).statusCode).toBe(200);
    expect((await save(bob, soup, 'x')).statusCode).toBe(403);
    const folders = (await bob.get('/api/folders')).json();
    expect(folders.find((f: { id: string }) => f.id === cakes.id).permission).toBe('edit');
  });

  it('owner sees share counts and can change and revoke shares', async () => {
    const { recipes } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'view');
    await shareWith('folder', recipes.id, 'carol', 'edit');
    const own = (await alice.get('/api/folders')).json().find((f: { id: string }) => f.id === recipes.id);
    expect(own).toMatchObject({ permission: 'owner', shareCount: 2 });

    const shares = (await alice.get(`/api/shares?kind=folder&id=${recipes.id}`)).json();
    expect(shares.map((s: { user: { username: string }; permission: string }) => [s.user.username, s.permission])).toEqual([
      ['bob', 'view'],
      ['carol', 'edit'],
    ]);
    await shareWith('folder', recipes.id, 'bob', 'edit');
    const after = await alice.delete('/api/shares', { kind: 'folder', id: recipes.id, userId: ids.carol });
    expect(after.json().map((s: { permission: string }) => s.permission)).toEqual(['edit']);
    expect((await carol.get('/api/folders')).json()).toEqual([]);

    expect((await alice.put('/api/shares', { kind: 'folder', id: recipes.id, userId: ids.alice, permission: 'view' })).statusCode).toBe(400);
  });

  it('recipients can leave a share; trashing by the owner hides it until restored', async () => {
    const { recipes } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'view');
    await shareWith('folder', recipes.id, 'carol', 'view');

    expect((await bob.delete('/api/shared', { kind: 'folder', id: recipes.id })).statusCode).toBe(204);
    expect((await bob.get('/api/shared')).json()).toEqual([]);

    await alice.delete(`/api/folders/${recipes.id}`);
    expect((await carol.get('/api/folders')).json()).toEqual([]);
    expect((await carol.get('/api/shared')).json()).toEqual([]);
    await alice.post('/api/trash/restore', { kind: 'folder', id: recipes.id });
    expect((await carol.get('/api/shared')).json()).toHaveLength(1);
  });
});

describe('sharing a single note', () => {
  it('gives access to that note only, without revealing the owner’s folders', async () => {
    const { diary, entry } = await setup();
    await shareWith('note', entry.id, 'carol', 'edit');

    const shared = (await carol.get('/api/shared')).json();
    expect(shared).toEqual([expect.objectContaining({ kind: 'note', id: entry.id, name: 'dear diary', type: 'text', permission: 'edit' })]);
    const dto = (await carol.get(`/api/notes/${entry.id}`)).json();
    expect(dto).toMatchObject({ permission: 'edit', folderId: null, ownerName: 'alice' });
    expect((await carol.get('/api/folders')).json()).toEqual([]);
    expect((await carol.get(`/api/notes?folderId=${diary.id}`)).statusCode).toBe(404);

    const [hit] = (await carol.get('/api/search?q=diary')).json();
    expect(hit).toMatchObject({ id: entry.id, folderId: null, ownerName: 'alice' });
    expect((await save(carol, dto, 'dear diary, hello')).statusCode).toBe(200);
    expect((await carol.patch(`/api/notes/${entry.id}`, { folderId: null })).statusCode).toBe(403);
  });

  it('a share on the note wins over the folder share', async () => {
    const { recipes, soup } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'edit');
    await shareWith('note', soup.id, 'bob', 'view');
    expect((await save(bob, soup, 'x')).statusCode).toBe(403);
    const list = (await bob.get(`/api/notes?folderId=${recipes.id}`)).json();
    expect(list.find((n: { id: string }) => n.id === soup.id).permission).toBe('view');
  });

  it('owner sees per-note share counts in listings', async () => {
    const { recipes, soup } = await setup();
    await shareWith('note', soup.id, 'bob', 'view');
    const list = (await alice.get(`/api/notes?folderId=${recipes.id}`)).json();
    expect(list.find((n: { id: string }) => n.id === soup.id)).toMatchObject({ permission: 'owner', shareCount: 1 });
  });
});

describe('sharing and privacy', () => {
  it('a recipient can hide a shared folder for themselves only', async () => {
    const { recipes } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'view');
    await bob.put('/api/privacy/secret', { kind: 'pin', secret: '1357', accountPassword: 'password123' });
    expect((await bob.patch(`/api/folders/${recipes.id}`, { private: true })).statusCode).toBe(200);
    expect((await bob.get('/api/folders')).json()).toEqual([]);
    expect((await bob.get('/api/shared')).json()).toEqual([]);
    expect((await alice.get('/api/folders')).json().find((f: { id: string }) => f.id === recipes.id).isPrivate).toBe(false);
  });
});

describe('users', () => {
  it('lists other users for the share dialog; deleting an editor keeps their edits', async () => {
    const { recipes, soup } = await setup();
    expect((await bob.get('/api/users')).json().map((u: { username: string }) => u.username)).toEqual(['alice', 'carol']);

    await shareWith('folder', recipes.id, 'bob', 'edit');
    await save(bob, soup, 'bob was here');
    expect((await alice.delete(`/api/admin/users/${ids.bob}`)).statusCode).toBe(204);
    const after = (await alice.get(`/api/notes/${soup.id}`)).json();
    expect(after.content.doc.content[0].content[0].text).toBe('bob was here');
    expect(after.updatedByName).toBeUndefined();
  });
});

describe('folder view settings', () => {
  const view = (c: Client, folderId: string | null) => c.get(`/api/folder-view${folderId ? `?folderId=${folderId}` : ''}`);

  it('are kept per folder and per user, also in shared folders', async () => {
    const { recipes, diary } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'view');
    expect((await view(alice, recipes.id)).json()).toEqual({ sort: 'updated', view: 'grid', cardSize: 2, noteOrder: [] });

    const set = await alice.put('/api/folder-view', { folderId: recipes.id, view: 'compact', cardSize: 4 });
    expect(set.json()).toEqual({ sort: 'updated', view: 'compact', cardSize: 4, noteOrder: [] });
    await alice.put('/api/folder-view', { folderId: null, sort: 'title' });

    // Other folders and Home keep their own settings.
    expect((await view(alice, diary.id)).json()).toEqual({ sort: 'updated', view: 'grid', cardSize: 2, noteOrder: [] });
    expect((await view(alice, null)).json()).toEqual({ sort: 'title', view: 'grid', cardSize: 2, noteOrder: [] });
    expect((await view(alice, recipes.id)).json()).toMatchObject({ view: 'compact', cardSize: 4 });

    // Bob only views the folder, but may arrange it his own way without changing Alice's.
    expect((await view(bob, recipes.id)).json()).toEqual({ sort: 'updated', view: 'grid', cardSize: 2, noteOrder: [] });
    expect((await bob.put('/api/folder-view', { folderId: recipes.id, view: 'list' })).statusCode).toBe(200);
    expect((await view(bob, recipes.id)).json()).toMatchObject({ view: 'list' });
    expect((await view(alice, recipes.id)).json()).toMatchObject({ view: 'compact' });
    // Home is per user too.
    expect((await view(bob, null)).json()).toMatchObject({ sort: 'updated' });
  });

  it('need access to the folder and valid values', async () => {
    const { diary } = await setup();
    expect((await view(bob, diary.id)).statusCode).toBe(404);
    expect((await bob.put('/api/folder-view', { folderId: diary.id, view: 'list' })).statusCode).toBe(404);
    expect((await alice.put('/api/folder-view', { folderId: diary.id, cardSize: 9 })).statusCode).toBe(400);
    expect((await alice.put('/api/folder-view', { folderId: diary.id, view: 'tiles' })).statusCode).toBe(400);
  });
});

describe('deleting a folder for good', () => {
  const count = (table: string) => (db.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  it('removes its subfolders, notes and everyone’s view settings with it', async () => {
    const { recipes, cakes } = await setup();
    await shareWith('folder', recipes.id, 'bob', 'view');
    await alice.put('/api/folder-view', { folderId: recipes.id, view: 'list' });
    await alice.put('/api/folder-view', { folderId: cakes.id, view: 'compact' });
    await bob.put('/api/folder-view', { folderId: recipes.id, cardSize: 0 });
    await alice.put('/api/folder-view', { folderId: null, sort: 'title' });
    expect(count('folder_views')).toBe(4);

    // In the trash, nothing is deleted yet: restoring brings the settings back too.
    await alice.delete(`/api/folders/${recipes.id}`);
    expect(count('folder_views')).toBe(4);
    expect(count('notes')).toBe(3);

    expect((await alice.delete(`/api/trash/folder/${recipes.id}`)).statusCode).toBe(204);
    // Recipes, Cakes and their two notes are gone; Diary and its note stay. Only Home's setting is left.
    expect(count('folders')).toBe(1);
    expect(count('notes')).toBe(1);
    expect(count('folder_views')).toBe(1);
  });
});
