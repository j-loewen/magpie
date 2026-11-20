import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { FolderDto, ImportResultDto, NoteDto, NoteSummaryDto } from '@notes/shared';
import type { Db } from '../src/db';
import { linkMeta } from '../src/db/schema';
import { client, makeApp } from './helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const bookmarksHtml = fs.readFileSync(path.join(here, 'fixtures', 'bookmarks.html'));

let app: FastifyInstance;
let db: Db;
let alice: ReturnType<typeof client>;
let bob: ReturnType<typeof client>;
let bobId: string;

beforeEach(async () => {
  // No page fetching in these tests.
  ({ app, db } = await makeApp({ LINK_PREVIEWS: 'false' }));
  alice = client(app);
  bob = client(app);
  await alice.register('alice');
  bobId = (await bob.register('bob')).json().id;
});
afterEach(async () => {
  await app.close();
});

const folder = async (c: typeof alice, name: string, parentId: string | null = null): Promise<FolderDto> =>
  (await c.post('/api/folders', { name, parentId })).json();
const note = async (c: typeof alice, body: Record<string, unknown>): Promise<NoteDto> => {
  const res = await c.post('/api/notes', { title: 'Note', ...body });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
};
const folders = async (c: typeof alice): Promise<FolderDto[]> => (await c.get('/api/folders')).json();
const notesIn = async (c: typeof alice, folderId: string | null): Promise<NoteSummaryDto[]> =>
  (await c.get(`/api/notes${folderId ? `?folderId=${folderId}` : ''}`)).json();
const fullNote = async (c: typeof alice, id: string): Promise<NoteDto> => (await c.get(`/api/notes/${id}`)).json();
const upload = async (c: typeof alice, name: string, data: Buffer | Uint8Array | string, extra = '') => {
  const res = await c.upload(`/api/import?name=${encodeURIComponent(name)}&previews=false${extra}`, data);
  return { res, body: res.json() as ImportResultDto };
};

/** A small tree with every note type. */
async function sampleTree() {
  const recipes = await folder(alice, 'Recipes');
  const sweet = await folder(alice, 'Sweet', recipes.id);
  await note(alice, { type: 'markdown', folderId: recipes.id, title: 'Pancakes', content: { markdown: '# Pancakes\n\nFlour, milk, eggs.' } });
  await note(alice, {
    type: 'checklist',
    folderId: sweet.id,
    title: 'Shopping: sugar/cream',
    content: {
      items: [
        { id: 'a', text: 'Sugar', done: true },
        { id: 'b', text: 'Cream', done: false, indent: 1 },
      ],
    },
  });
  const map = await note(alice, {
    type: 'mindmap',
    folderId: recipes.id,
    title: 'Menu ideas',
    content: { root: { id: 'r', text: 'Menu', children: [{ id: 'c1', text: 'Starters', children: [{ id: 'c2', text: 'Soup', children: [] }] }] } },
  });
  await alice.patch(`/api/notes/${map.id}`, { pinned: true, icon: 'chef-hat', color: '#40c057' });
  await note(alice, { type: 'link', folderId: null, title: 'Example', content: { url: 'https://example.com/', description: 'A site' } });
  await note(alice, { type: 'code', folderId: null, title: 'script', content: { code: 'echo hi', language: 'Shell' } });
  return { recipes, sweet };
}

describe('note types', () => {
  it('validates checklist and mind map content', async () => {
    expect((await alice.post('/api/notes', { type: 'checklist', content: { items: [{ id: 'x', text: 'a' }] } })).statusCode).toBe(400);
    let deep: Record<string, unknown> = { id: 'leaf', text: 'x', children: [] };
    for (let i = 0; i < 80; i++) deep = { id: `n${i}`, text: 'x', children: [deep] };
    const res = await alice.post('/api/notes', { type: 'mindmap', content: { root: deep } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/nested too deeply/);
  });

  it('shows checklist progress on cards and indexes the items for search', async () => {
    const list = await note(alice, {
      type: 'checklist',
      title: 'Groceries',
      content: { items: [{ id: 'a', text: 'Bananas', done: true }, { id: 'b', text: 'Apples', done: false }] },
    });
    const card = (await notesIn(alice, null)).find((n) => n.id === list.id)!;
    expect(card.meta).toEqual({ total: 2, done: 1 });
    expect(card.excerpt).toBe('☑ Bananas ☐ Apples');
    expect((await alice.get('/api/search?q=banana')).json()[0].id).toBe(list.id);
  });
});

describe('export', () => {
  it('exports everything I own as JSON plus readable files', async () => {
    await sampleTree();
    const res = await alice.get('/api/export');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="magpie-export-\d{4}-\d{2}-\d{2}\.zip"/);
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files).sort()).toEqual([
      'Example.md',
      'Recipes/Menu ideas.md',
      'Recipes/Pancakes.md',
      'Recipes/Sweet/Shopping sugar cream.md',
      'notes-export.json',
      'script.sh',
    ]);
    expect(strFromU8(files['Recipes/Sweet/Shopping sugar cream.md']!)).toBe('- [x] Sugar\n  - [ ] Cream\n');
    expect(strFromU8(files['Recipes/Menu ideas.md']!)).toBe('# Menu\n\n- Starters\n  - Soup\n');
    expect(strFromU8(files['Example.md']!)).toBe('# Example\n\n<https://example.com/>\n\nA site\n');
    const manifest = JSON.parse(strFromU8(files['notes-export.json']!));
    expect(manifest).toMatchObject({ format: 'notes-export', version: 1 });
    expect(manifest.folders).toHaveLength(2);
    expect(manifest.notes).toHaveLength(5);
  });

  it('skips trashed notes and private folders while they are locked', async () => {
    const { sweet } = await sampleTree();
    const gone = await note(alice, { type: 'text', title: 'Deleted', content: { text: 'x' } });
    await alice.delete(`/api/notes/${gone.id}`);
    await alice.put('/api/privacy/secret', { kind: 'pin', secret: '2468', accountPassword: 'password123' });
    await alice.patch(`/api/folders/${sweet.id}`, { private: true });

    const names = async () => Object.keys(unzipSync(new Uint8Array((await alice.get('/api/export')).rawPayload)));
    expect(await names()).not.toContain('Deleted.md');
    expect((await names()).some((n) => n.includes('Sweet'))).toBe(false);
    await alice.post('/api/privacy/unlock', { secret: '2468' });
    expect((await names()).some((n) => n.includes('Sweet'))).toBe(true);
  });

  it('exports one folder; others can export it only when it is shared with them', async () => {
    const { recipes } = await sampleTree();
    expect((await bob.get(`/api/export?folderId=${recipes.id}`)).statusCode).toBe(404);
    await alice.put('/api/shares', { kind: 'folder', id: recipes.id, userId: bobId, permission: 'view' });
    const res = await bob.get(`/api/export?folderId=${recipes.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/filename="Recipes-/);
    const files = unzipSync(new Uint8Array(res.rawPayload));
    expect(Object.keys(files).sort()).toEqual(['Menu ideas.md', 'Pancakes.md', 'Sweet/Shopping sugar cream.md', 'notes-export.json']);
  });
});

describe('import', () => {
  it('restores an export with folders, contents and pins', async () => {
    await sampleTree();
    const zip = (await alice.get('/api/export')).rawPayload;
    const { res, body } = await upload(bob, 'notes-export-2026-11-17.zip', zip);
    expect(res.statusCode, res.body).toBe(200);
    expect(body).toMatchObject({ folders: 3, notes: 5, skippedCount: 0 });

    const tree = await folders(bob);
    const top = tree.find((f) => f.id === body.folderId)!;
    expect(top.name).toMatch(/^Imported notes \d{4}-\d{2}-\d{2}$/);
    const recipes = tree.find((f) => f.name === 'Recipes')!;
    expect(recipes.parentId).toBe(top.id);
    expect(recipes.ownerId).toBe(bobId);
    expect(tree.find((f) => f.name === 'Sweet')!.parentId).toBe(recipes.id);

    const inRecipes = await notesIn(bob, recipes.id);
    expect(inRecipes.map((n) => n.title)).toEqual(['Menu ideas', 'Pancakes']); // pinned first
    expect(inRecipes[0]).toMatchObject({ pinned: true, icon: 'chef-hat', color: '#40c057' });
    const map = await fullNote(bob, inRecipes[0]!.id);
    expect(map.content).toEqual({
      root: { id: 'r', text: 'Menu', children: [{ id: 'c1', text: 'Starters', children: [{ id: 'c2', text: 'Soup', children: [] }] }] },
    });
    const topNotes = await notesIn(bob, top.id);
    expect(topNotes.map((n) => n.type).sort()).toEqual(['code', 'link']);
  });

  it('imports browser bookmarks as link notes in folders', async () => {
    const { res, body } = await upload(alice, 'bookmarks.html', bookmarksHtml);
    expect(res.statusCode, res.body).toBe(200);
    expect(body).toMatchObject({ folders: 4, notes: 4, skippedCount: 2 });
    expect(body.skipped.map((s) => s.name)).toEqual(['Bookmarklet', 'Most visited']);

    const tree = await folders(alice);
    const root = tree.find((f) => f.id === body.folderId)!;
    expect(root.name).toBe('bookmarks');
    const toolbar = tree.find((f) => f.name === 'Bookmarks Toolbar')!;
    expect(toolbar.parentId).toBe(root.id);
    expect(tree.find((f) => f.name === 'Recipes')!.parentId).toBe(toolbar.id);
    expect(tree.find((f) => f.name === 'Empty folder')!.parentId).toBe(toolbar.id);

    expect((await notesIn(alice, root.id)).map((n) => n.title).sort()).toEqual(['Last one', 'Top level & first']);
    const news = (await notesIn(alice, toolbar.id))[0]!;
    expect(news.createdAt).toBe(new Date(1_700_000_100_000).toISOString());
    expect((await fullNote(alice, news.id)).content).toEqual({ url: 'https://news.example.org/', description: 'Daily news site\nwith two lines' });
    const recipes = tree.find((f) => f.name === 'Recipes')!;
    const pancakes = (await notesIn(alice, recipes.id))[0]!;
    expect((await fullNote(alice, pancakes.id)).content).toMatchObject({ url: 'https://cook.example.net/pancakes?a=1&b=2' });
    // previews=false: nothing queued.
    expect(db.select().from(linkMeta).all()).toHaveLength(0);
  });

  it('imports single files by extension into the chosen folder', async () => {
    const target = await folder(alice, 'Inbox');
    const into = `&folderId=${target.id}`;
    expect((await upload(alice, 'Ideas.md', '# Ideas\r\n\r\nMore later', into)).body).toMatchObject({ folderId: null, notes: 1 });
    expect((await upload(alice, 'deploy.yml', 'on: push', into)).body.notes).toBe(1);
    expect((await upload(alice, 'Site.url', '[InternetShortcut]\r\nURL=https://example.org/page\r\n', into)).body.notes).toBe(1);
    const opml = `<?xml version="1.0"?><opml version="2.0"><head><title>Plan</title></head><body>
      <outline text="Goals"><outline text="Health &amp; sport"/><outline text="Work"/></outline>
      <outline text="Ideas"/></body></opml>`;
    expect((await upload(alice, 'Plan.opml', opml, into)).body.notes).toBe(1);

    const imported = await notesIn(alice, target.id);
    const byTitle = Object.fromEntries(await Promise.all(imported.map(async (n) => [n.title, await fullNote(alice, n.id)])));
    expect(byTitle.Ideas.content).toEqual({ markdown: '# Ideas\n\nMore later' });
    expect(byTitle.deploy.content).toEqual({ code: 'on: push', language: 'YAML' });
    expect(byTitle.Site.content).toEqual({ url: 'https://example.org/page', description: '' });
    expect(byTitle.Plan.type).toBe('mindmap');
    const root = (byTitle.Plan.content as { root: { text: string; children: { text: string; children: { text: string }[] }[] } }).root;
    expect(root.text).toBe('Plan');
    expect(root.children.map((c) => c.text)).toEqual(['Goals', 'Ideas']);
    expect(root.children[0]!.children.map((c) => c.text)).toEqual(['Health & sport', 'Work']);

    const bad = await upload(alice, 'scan.pdf', '%PDF-1.7');
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.json().message).toMatch(/not a supported file type/);
  });

  it('imports a zip of files from another app, keeping its folders', async () => {
    const zip = zipSync({
      'Vault/Daily/2026-11-17.md': strToU8('Today'),
      'Vault/Projects/notes.txt': strToU8('plain'),
      'Vault/Projects/photo.png': new Uint8Array([137, 80, 78, 71]),
      'Vault/.obsidian/app.json': strToU8('{}'),
      '__MACOSX/Vault/._x.md': strToU8('junk'),
    });
    const { res, body } = await upload(alice, 'Vault.zip', zip);
    expect(res.statusCode, res.body).toBe(200);
    expect(body).toMatchObject({ notes: 2, skippedCount: 1, skipped: [{ name: 'Vault/Projects/photo.png', reason: 'Unsupported file type' }] });
    const tree = await folders(alice);
    const root = tree.find((f) => f.id === body.folderId)!;
    expect(root.name).toBe('Vault');
    const vault = tree.find((f) => f.name === 'Vault' && f.parentId === root.id)!;
    expect(tree.filter((f) => f.parentId === vault.id).map((f) => f.name).sort()).toEqual(['Daily', 'Projects']);
  });

  it('only imports into folders I can edit, and rejects broken files', async () => {
    const shared = await folder(alice, 'Shared');
    await alice.put('/api/shares', { kind: 'folder', id: shared.id, userId: bobId, permission: 'view' });
    expect((await upload(bob, 'a.md', 'x', `&folderId=${shared.id}`)).res.statusCode).toBe(403);
    await alice.put('/api/shares', { kind: 'folder', id: shared.id, userId: bobId, permission: 'edit' });
    const ok = await upload(bob, 'a.md', 'x', `&folderId=${shared.id}`);
    expect(ok.res.statusCode).toBe(200);
    // Belongs to the folder owner, like notes an editor creates by hand.
    expect((await notesIn(alice, shared.id))[0]!.title).toBe('a');

    const notZip = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(40)]);
    expect((await upload(alice, 'x.zip', notZip)).res.statusCode).toBe(400);
    const empty = zipSync({ 'a.png': new Uint8Array([1]) });
    const res = await upload(alice, 'pics.zip', empty);
    expect(res.res.statusCode).toBe(400);
    expect(res.res.json().message).toMatch(/Nothing could be imported/);
    // Rolled back: no stray "pics" folder.
    expect((await folders(alice)).some((f) => f.name === 'pics')).toBe(false);
  });
});
