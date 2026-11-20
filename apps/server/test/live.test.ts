import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { LiveEvent } from '@notes/shared';
import { client, makeApp } from './helpers';

let app: FastifyInstance;
let base: string;
const ids: Record<string, string> = {};
let alice: ReturnType<typeof client>;
let bob: ReturnType<typeof client>;
let carol: ReturnType<typeof client>;
const streams: Stream[] = [];

beforeEach(async () => {
  ({ app } = await makeApp({ LIVE_HEARTBEAT_MS: '100' }));
  base = await app.listen({ host: '127.0.0.1', port: 0 });
  alice = client(app, { tab: 'alice-tab-1' });
  bob = client(app);
  carol = client(app);
  ids.alice = (await alice.register('alice')).json().id;
  ids.bob = (await bob.register('bob')).json().id;
  ids.carol = (await carol.register('carol')).json().id;
});
afterEach(async () => {
  for (const s of streams.splice(0)) s.stop();
  await app.close();
});

interface Stream {
  events: LiveEvent[];
  ended: boolean;
  status: number;
  stop(): void;
  /** Resolves once an event matching `pred` arrived. */
  waitFor(pred: (e: LiveEvent) => boolean, ms?: number): Promise<LiveEvent>;
}

/** Open GET /api/events as a browser would and collect the events. */
async function open(c: ReturnType<typeof client>, tab?: string): Promise<Stream> {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/events${tab ? `?tab=${tab}` : ''}`, {
    headers: c.cookie() ? { cookie: c.cookie()! } : {},
    signal: ctrl.signal,
  });
  const stream: Stream = {
    events: [],
    ended: false,
    status: res.status,
    stop: () => ctrl.abort(),
    waitFor: (pred, ms = 2000) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          const hit = stream.events.find(pred);
          if (hit) return resolve(hit);
          if (Date.now() - started > ms) return reject(new Error(`no matching event; got ${JSON.stringify(stream.events)}`));
          setTimeout(check, 10);
        };
        check();
      }),
  };
  streams.push(stream);
  if (res.ok && res.body) {
    void (async () => {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            for (const line of block.split('\n')) if (line.startsWith('data: ')) stream.events.push(JSON.parse(line.slice(6)));
          }
        }
      } catch {
        // Aborted.
      }
      stream.ended = true;
    })();
    await stream.waitFor((e) => e.kind === 'hello');
  }
  return stream;
}

const settle = () => new Promise((r) => setTimeout(r, 150));

describe('live refresh', () => {
  it('needs a login', async () => {
    const res = await fetch(`${base}/api/events`);
    expect(res.status).toBe(401);
  });

  it('tells exactly the people who can see a change', async () => {
    const bobStream = await open(bob);
    const carolStream = await open(carol);
    const folder = (await alice.post('/api/folders', { name: 'Recipes' })).json();
    const note = (await alice.post('/api/notes', { type: 'text', folderId: folder.id, title: 'Soup', content: { text: 'a' } })).json();
    await settle();
    expect(bobStream.events.filter((e) => e.kind !== 'hello')).toEqual([]);

    await alice.put('/api/shares', { kind: 'folder', id: folder.id, userId: ids.bob, permission: 'edit' });
    await bobStream.waitFor((e) => e.kind === 'tree');

    await alice.put(`/api/notes/${note.id}`, { title: 'Soup', content: { text: 'b' }, version: 1 });
    expect(await bobStream.waitFor((e) => e.kind === 'note')).toEqual({ kind: 'note', id: note.id, version: 2 });

    // Bob's own save reaches alice, too.
    const aliceStream = await open(alice, 'alice-tab-2');
    await bob.put(`/api/notes/${note.id}`, { title: 'Soup', content: { text: 'c' }, version: 2 });
    await aliceStream.waitFor((e) => e.kind === 'note' && e.version === 3);

    // Removed people hear about it once more, then nothing.
    bobStream.events.length = 0;
    await alice.delete('/api/shares', { kind: 'folder', id: folder.id, userId: ids.bob });
    await bobStream.waitFor((e) => e.kind === 'tree');
    bobStream.events.length = 0;
    await alice.put(`/api/notes/${note.id}`, { title: 'Soup', content: { text: 'd' }, version: 3 });
    await settle();
    expect(bobStream.events).toEqual([]);
    expect(carolStream.events.filter((e) => e.kind !== 'hello')).toEqual([]);
  });

  it('does not echo a change back to the tab that made it', async () => {
    const sameTab = await open(alice, 'alice-tab-1');
    const otherTab = await open(alice, 'alice-tab-2');
    await alice.post('/api/folders', { name: 'Work' });
    await otherTab.waitFor((e) => e.kind === 'tree');
    await settle();
    expect(sameTab.events.filter((e) => e.kind !== 'hello')).toEqual([]);
  });

  it('sends preference changes to my other devices', async () => {
    const other = await open(alice, 'phone');
    await alice.patch('/api/me/prefs', { theme: 'dark' });
    await other.waitFor((e) => e.kind === 'me');
  });

  it('does not keep the server from shutting down', async () => {
    const s = await open(bob);
    const started = Date.now();
    await app.close();
    expect(Date.now() - started).toBeLessThan(1000);
    await new Promise((r) => setTimeout(r, 50));
    expect(s.ended).toBe(true);
  });

  it('ends the stream after logout', async () => {
    const s = await open(bob);
    await bob.post('/api/auth/logout');
    await new Promise((r) => setTimeout(r, 400));
    expect(s.ended).toBe(true);
    expect(app.live.size).toBe(0);
  });
});
