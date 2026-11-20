import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { defineNoteType, getNoteType, upgradeContent } from '@notes/note-types';
import { notes } from '../src/db/schema';
import { client, makeApp } from './helpers';

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeApp>>['db'];
let alice: ReturnType<typeof client>;
let bob: ReturnType<typeof client>;

beforeEach(async () => {
  ({ app, db } = await makeApp());
  alice = client(app);
  bob = client(app);
  await alice.register('alice');
  await bob.register('bob');
});
afterEach(async () => {
  await app.close();
});

const folder = async (c = alice, name = 'Folder', parentId: string | null = null) =>
  (await c.post('/api/folders', { name, parentId })).json();
const note = async (c = alice, body: Record<string, unknown> = { type: 'markdown' }) =>
  (await c.post('/api/notes', { title: 'Note', ...body })).json();
/** Text note content: one paragraph per line, as plain text ({ text }) is stored. */
const textDoc = (...lines: string[]) => ({
  doc: { type: 'doc', content: lines.map((t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })) },
});

describe('folders', () => {
  it('creates nested folders, renames and moves them', async () => {
    const a = await folder(alice, 'A');
    const b = await folder(alice, 'B', a.id);
    expect(b.parentId).toBe(a.id);

    const renamed = (await alice.patch(`/api/folders/${b.id}`, { name: 'B2' })).json();
    expect(renamed.name).toBe('B2');
    const moved = (await alice.patch(`/api/folders/${b.id}`, { parentId: null })).json();
    expect(moved.parentId).toBeNull();

    const list = (await alice.get('/api/folders')).json();
    expect(list.map((f: { name: string }) => f.name)).toEqual(['A', 'B2']);
  });

  it('refuses to move a folder into itself or a descendant', async () => {
    const a = await folder(alice, 'A');
    const b = await folder(alice, 'B', a.id);
    expect((await alice.patch(`/api/folders/${a.id}`, { parentId: b.id })).statusCode).toBe(400);
    expect((await alice.patch(`/api/folders/${a.id}`, { parentId: a.id })).statusCode).toBe(400);
  });

  it('counts notes per folder', async () => {
    const a = await folder(alice, 'A');
    await note(alice, { type: 'text', folderId: a.id });
    await note(alice, { type: 'code', folderId: a.id });
    const [listed] = (await alice.get('/api/folders')).json();
    expect(listed.noteCount).toBe(2);
  });
});

describe('notes', () => {
  it('creates each built-in type with default content, mixed in one folder', async () => {
    const f = await folder();
    for (const [type, content] of [
      ['markdown', { markdown: '' }],
      ['text', textDoc('')],
      ['code', { code: '', language: '' }],
    ] as const) {
      const n = await note(alice, { type, folderId: f.id });
      expect(n).toMatchObject({ type, content, version: 1, folderId: f.id });
    }
    expect((await alice.get(`/api/notes?folderId=${f.id}`)).json()).toHaveLength(3);
    expect((await alice.get('/api/notes')).json()).toHaveLength(0); // top level is empty
  });

  it('rejects unknown types, invalid content and notes without a name', async () => {
    expect((await alice.post('/api/notes', { type: 'text', title: '  ' })).json().message).toBe('Enter a name');
    expect((await alice.post('/api/notes', { type: 'nope' })).statusCode).toBe(400);
    expect((await alice.post('/api/notes', { type: 'text', content: { text: 5 } })).statusCode).toBe(400);
    const n = await note(alice, { type: 'text' });
    const res = await alice.put(`/api/notes/${n.id}`, { title: 'x', content: { wrong: true }, version: 1 });
    expect(res.statusCode).toBe(400);
  });

  it('saves with version check and reports conflicts with the current note', async () => {
    const n = await note(alice, { type: 'text' });
    const first = await alice.put(`/api/notes/${n.id}`, { title: 'One', content: { text: 'v2' }, version: 1 });
    expect(first.json()).toMatchObject({ title: 'One', version: 2, content: textDoc('v2') });

    // A second editor still on version 1 must not overwrite.
    const stale = await alice.put(`/api/notes/${n.id}`, { title: 'Two', content: { text: 'stale' }, version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().details.current).toMatchObject({ version: 2, content: textDoc('v2') });

    // Overwrite after seeing the conflict = save against the current version.
    const ok = await alice.put(`/api/notes/${n.id}`, { title: 'Two', content: { text: 'mine' }, version: 2 });
    expect(ok.json().version).toBe(3);
  });

  it('moves and pins without bumping the content version', async () => {
    const f = await folder();
    const n = await note(alice, { type: 'text' });
    const moved = (await alice.patch(`/api/notes/${n.id}`, { folderId: f.id, pinned: true })).json();
    expect(moved).toMatchObject({ folderId: f.id, pinned: true, version: 1 });
  });

  it('sets and resets icon and colour without bumping the content version', async () => {
    const n = await note(alice, { type: 'text' });
    expect(n).toMatchObject({ icon: null, color: null });
    const styled = (await alice.patch(`/api/notes/${n.id}`, { icon: 'star', color: '#FA5252' })).json();
    expect(styled).toMatchObject({ icon: 'star', color: '#fa5252', version: 1 });
    expect((await alice.get('/api/notes')).json()[0]).toMatchObject({ icon: 'star', color: '#fa5252' });
    // Changing one leaves the other alone; null goes back to the default.
    expect((await alice.patch(`/api/notes/${n.id}`, { icon: null })).json()).toMatchObject({ icon: null, color: '#fa5252' });
    expect((await alice.patch(`/api/notes/${n.id}`, { color: 'red' })).statusCode).toBe(400);
    expect((await alice.patch(`/api/notes/${n.id}`, { icon: '<b>' })).statusCode).toBe(400);
  });

  it('returns excerpts in listings and sorts pinned notes first', async () => {
    const a = await note(alice, { type: 'text', title: 'a', content: { text: 'hello\n\nworld' } });
    await note(alice, { type: 'text', title: 'b' });
    await alice.patch(`/api/notes/${a.id}`, { pinned: true });
    const list = (await alice.get('/api/notes?sort=title')).json();
    expect(list.map((n: { title: string }) => n.title)).toEqual(['a', 'b']);
    expect(list[0].excerpt).toBe('hello world');
  });

  it('lists notes in my custom order, with new notes at the bottom', async () => {
    const f = await folder();
    const a = await note(alice, { type: 'markdown', title: 'a', folderId: f.id });
    const b = await note(alice, { type: 'markdown', title: 'b', folderId: f.id });
    const c = await note(alice, { type: 'markdown', title: 'c', folderId: f.id });
    const titles = async () => (await alice.get(`/api/notes?sort=manual&folderId=${f.id}`)).json().map((n: { title: string }) => n.title);
    // Nothing arranged yet: oldest first.
    expect(await titles()).toEqual(['a', 'b', 'c']);

    // Unknown ids (e.g. notes since deleted) are ignored.
    await alice.put('/api/folder-view', { folderId: f.id, sort: 'manual', noteOrder: [c.id, 'gone', a.id, b.id] });
    expect(await titles()).toEqual(['c', 'a', 'b']);
    await note(alice, { type: 'markdown', title: 'd', folderId: f.id });
    expect(await titles()).toEqual(['c', 'a', 'b', 'd']);

    // Switching to another sort keeps the order for later.
    await alice.put('/api/folder-view', { folderId: f.id, sort: 'title' });
    expect((await alice.get(`/api/folder-view?folderId=${f.id}`)).json()).toMatchObject({ sort: 'title', noteOrder: [c.id, 'gone', a.id, b.id] });
    await alice.put('/api/folder-view', { folderId: f.id, sort: 'manual' });
    expect(await titles()).toEqual(['c', 'a', 'b', 'd']);

    // Pinned notes still come first, in my order among themselves.
    await alice.patch(`/api/notes/${b.id}`, { pinned: true });
    expect(await titles()).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('text notes', () => {
  const rich = {
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Trip' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Pack ' },
            { type: 'text', text: 'boots ', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'map', marks: [{ type: 'link', attrs: { href: 'https://example.org/a (b)' } }] },
            { type: 'hardBreak' },
            { type: 'text', text: '*not a list' },
          ],
        },
        { type: 'paragraph' },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'tent' }] }] },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'food' }] },
                { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rice' }] }] }] },
              ],
            },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'sh' }, content: [{ type: 'text', text: 'ls -la' }] },
      ],
    },
  };

  it('stores formatted text, searches its words and exports it as Markdown', async () => {
    const n = await note(alice, { type: 'text', title: 'Trip', content: rich });
    expect(n.content).toEqual(rich);
    expect((await alice.get('/api/search?q=boots')).json()).toHaveLength(1);
    expect((await alice.get('/api/notes')).json()[0].excerpt).toMatch(/^Trip Pack boots map/);

    expect(getNoteType('text')!.toFile!(rich, 'Trip')).toEqual({
      ext: 'md',
      text: [
        '## Trip',
        '',
        'Pack **boots** [map](https://example.org/a%20%28b%29)\\',
        '\\*not a list',
        '',
        '- tent',
        '- food',
        '  1. rice',
        '',
        '```sh',
        'ls -la',
        '```',
        '',
      ].join('\n'),
    });
  });

  it('upgrades plain text notes from before formatting', async () => {
    const n = await note(alice, { type: 'text', title: 'Old' });
    db.update(notes).set({ typeVersion: 1, content: { text: 'first\n\nsecond' } }).where(eq(notes.id, n.id)).run();
    expect((await alice.get(`/api/notes/${n.id}`)).json()).toMatchObject({ typeVersion: 2, content: textDoc('first', '', 'second') });
  });

  it('rejects content that is not a text document', async () => {
    expect((await alice.post('/api/notes', { type: 'text', title: 'x', content: { doc: { type: 'paragraph' } } })).statusCode).toBe(400);
    expect((await alice.post('/api/notes', { type: 'text', title: 'x', content: { doc: { type: 'doc', content: 'no' } } })).statusCode).toBe(400);
  });
});

describe('isolation between users', () => {
  it('folders and notes are invisible to other users, including admins', async () => {
    // alice registered first and is admin; bob creates private content.
    const f = await folder(bob, 'Bobs');
    const n = await note(bob, { type: 'text', folderId: f.id, content: { text: 'secret plans' } });

    expect((await alice.get('/api/folders')).json()).toEqual([]);
    expect((await alice.get(`/api/notes?folderId=${f.id}`)).statusCode).toBe(404);
    expect((await alice.get(`/api/notes/${n.id}`)).statusCode).toBe(404);
    expect((await alice.put(`/api/notes/${n.id}`, { title: 'x', content: { text: 'x' }, version: 1 })).statusCode).toBe(404);
    expect((await alice.patch(`/api/notes/${n.id}`, { pinned: true })).statusCode).toBe(404);
    expect((await alice.delete(`/api/notes/${n.id}`)).statusCode).toBe(404);
    expect((await alice.patch(`/api/folders/${f.id}`, { name: 'mine' })).statusCode).toBe(404);
    expect((await alice.delete(`/api/folders/${f.id}`)).statusCode).toBe(404);
    expect((await alice.get('/api/search?q=secret')).json()).toEqual([]);
  });

  it('cannot create notes or folders inside, or move into, another user\'s folder', async () => {
    const f = await folder(bob, 'Bobs');
    expect((await alice.post('/api/notes', { type: 'text', folderId: f.id })).statusCode).toBe(404);
    expect((await alice.post('/api/folders', { name: 'x', parentId: f.id })).statusCode).toBe(404);
    const mine = await note(alice, { type: 'text' });
    expect((await alice.patch(`/api/notes/${mine.id}`, { folderId: f.id })).statusCode).toBe(404);
  });
});

describe('trash', () => {
  it('trashing a folder trashes its subtree; restoring brings back exactly that batch', async () => {
    const a = await folder(alice, 'A');
    const b = await folder(alice, 'B', a.id);
    const n1 = await note(alice, { type: 'text', folderId: a.id });
    await note(alice, { type: 'text', folderId: b.id });

    expect((await alice.delete(`/api/folders/${a.id}`)).statusCode).toBe(204);
    expect((await alice.get('/api/folders')).json()).toEqual([]);
    expect((await alice.get(`/api/notes/${n1.id}`)).statusCode).toBe(404);

    const trash = (await alice.get('/api/trash')).json();
    expect(trash.folders).toEqual([expect.objectContaining({ id: a.id, folderCount: 1, noteCount: 2 })]);
    expect(trash.notes).toEqual([]); // notes inside a trashed folder are listed with the folder
    expect(trash.retentionDays).toBe(30);

    expect((await alice.post('/api/trash/restore', { kind: 'folder', id: a.id })).statusCode).toBe(204);
    expect((await alice.get('/api/folders')).json()).toHaveLength(2);
    expect((await alice.get(`/api/notes?folderId=${b.id}`)).json()).toHaveLength(1);
  });

  it('a note trashed on its own stays trashed when its folder is restored', async () => {
    const a = await folder(alice, 'A');
    const n = await note(alice, { type: 'text', folderId: a.id });
    await alice.delete(`/api/notes/${n.id}`);
    await new Promise((r) => setTimeout(r, 5));
    await alice.delete(`/api/folders/${a.id}`);
    await alice.post('/api/trash/restore', { kind: 'folder', id: a.id });
    expect((await alice.get(`/api/notes/${n.id}`)).statusCode).toBe(404);
    expect((await alice.get('/api/trash')).json().notes).toHaveLength(1);
  });

  it('restoring a note whose folder is in the trash puts it at the top level', async () => {
    const a = await folder(alice, 'A');
    const n = await note(alice, { type: 'text', folderId: a.id });
    await alice.delete(`/api/folders/${a.id}`);
    // Notes of a trashed folder can still be restored one by one.
    expect((await alice.post('/api/trash/restore', { kind: 'note', id: n.id })).statusCode).toBe(204);
    expect((await alice.get(`/api/notes/${n.id}`)).json().folderId).toBeNull();
  });

  it('purges single items and empties the trash', async () => {
    const a = await folder(alice, 'A');
    await note(alice, { type: 'text', folderId: a.id });
    const n = await note(alice, { type: 'text' });
    await alice.delete(`/api/folders/${a.id}`);
    await alice.delete(`/api/notes/${n.id}`);

    expect((await alice.delete(`/api/trash/note/${n.id}`)).statusCode).toBe(204);
    expect((await alice.get('/api/trash')).json().notes).toHaveLength(0);
    expect((await alice.delete('/api/trash')).statusCode).toBe(204);
    expect((await alice.get('/api/trash')).json().folders).toHaveLength(0);
  });

  it("other users cannot see, restore or purge someone's trash", async () => {
    const n = await note(bob, { type: 'text' });
    await bob.delete(`/api/notes/${n.id}`);
    expect((await alice.get('/api/trash')).json().notes).toHaveLength(0);
    expect((await alice.post('/api/trash/restore', { kind: 'note', id: n.id })).statusCode).toBe(404);
    expect((await alice.delete(`/api/trash/note/${n.id}`)).statusCode).toBe(404);
  });
});

describe('search', () => {
  it('finds notes by title and content with prefix matching, skipping trashed notes', async () => {
    const a = await note(alice, { type: 'markdown', title: 'Grocery list', content: { markdown: '# Shopping\n- **Bananas**' } });
    await note(alice, { type: 'code', title: 'Script', content: { code: 'const banana = 1;', language: 'JavaScript' } });

    const byTitle = (await alice.get('/api/search?q=groc')).json();
    expect(byTitle.map((r: { id: string }) => r.id)).toEqual([a.id]);

    const byBody = (await alice.get('/api/search?q=banan')).json();
    expect(byBody).toHaveLength(2);
    expect(byBody.find((r: { id: string }) => r.id === a.id).snippet).toContain('\u0001Bananas\u0002');

    await alice.delete(`/api/notes/${a.id}`);
    expect((await alice.get('/api/search?q=banan')).json()).toHaveLength(1);
  });

  it('updates the index on save and ignores FTS syntax in queries', async () => {
    const n = await note(alice, { type: 'text' });
    await alice.put(`/api/notes/${n.id}`, { title: 'T', content: { text: 'quantum physics' }, version: 1 });
    expect((await alice.get('/api/search?q=quantum')).json()).toHaveLength(1);
    // Quotes, parentheses, stars and colons are treated as plain separators.
    const tricky = await alice.get(`/api/search?q=${encodeURIComponent('"quantum*" :(phys^')}`);
    expect(tricky.statusCode).toBe(200);
    expect(tricky.json()).toHaveLength(1);
    expect((await alice.get('/api/search?q=***')).json()).toEqual([]);
  });
});

describe('note type content migrations', () => {
  const v2 = defineNoteType({
    id: 'demo',
    label: 'Demo',
    description: '',
    version: 3,
    schema: z.object({ body: z.string(), tags: z.array(z.string()) }),
    createDefault: () => ({ body: '', tags: [] }),
    migrations: {
      1: (c) => ({ body: (c as { text: string }).text }),
      2: (c) => ({ ...(c as object), tags: [] }),
    },
    toSearchText: (c) => c.body,
  });

  it('upgrades step by step and validates the result', () => {
    expect(upgradeContent(v2, { text: 'hi' }, 1)).toEqual({ body: 'hi', tags: [] });
    expect(upgradeContent(v2, { body: 'hi', tags: ['x'] }, 3)).toEqual({ body: 'hi', tags: ['x'] });
    expect(() => upgradeContent(v2, { body: 'hi' }, 4)).toThrow(/newer/);
  });
});

describe('client-chosen note ids', () => {
  it('creates the note under that id once, and refuses taken or malformed ids', async () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const first = await alice.post('/api/notes', { id: id.toUpperCase(), type: 'text', title: 'Draft' });
    expect(first.statusCode).toBe(201);
    expect(first.json().id).toBe(id);
    expect((await alice.post('/api/notes', { id, type: 'text', title: 'Again' })).statusCode).toBe(409);
    expect((await alice.post('/api/notes', { id: 'not-a-uuid', type: 'text', title: 'X' })).statusCode).toBe(400);
  });
});
