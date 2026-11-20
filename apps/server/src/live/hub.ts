import type { FastifyRequest } from 'fastify';
import { TAB_HEADER, type LiveEvent } from '@notes/shared';

interface Client {
  userId: string;
  /** Browser tab of this stream; that tab is not sent events about its own changes. */
  tab: string | undefined;
  send(data: string): void;
  end(): void;
}

/** In-memory fan-out of live events to the open event streams, per user. */
export class LiveHub {
  private byUser = new Map<string, Set<Client>>();

  add(client: Client) {
    const set = this.byUser.get(client.userId) ?? new Set<Client>();
    set.add(client);
    this.byUser.set(client.userId, set);
  }

  remove(client: Client) {
    const set = this.byUser.get(client.userId);
    set?.delete(client);
    if (set?.size === 0) this.byUser.delete(client.userId);
  }

  publish(userIds: Iterable<string>, event: LiveEvent, originTab?: string) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const userId of new Set(userIds)) {
      for (const client of this.byUser.get(userId) ?? []) {
        if (originTab && client.tab === originTab) continue;
        client.send(data);
      }
    }
  }

  /** Number of open streams (for tests and logs). */
  get size() {
    let n = 0;
    for (const set of this.byUser.values()) n += set.size;
    return n;
  }

  closeAll() {
    for (const set of this.byUser.values()) for (const client of set) client.end();
    this.byUser.clear();
  }
}

const tabOf = (value: unknown) => (typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : undefined);
export const originTab = (req: FastifyRequest) => tabOf(req.headers[TAB_HEADER]);
export const streamTab = (req: FastifyRequest) => tabOf((req.query as { tab?: unknown } | undefined)?.tab);

/** Tell these users that something changed, except the browser tab that made the change. */
export function publish(req: FastifyRequest, userIds: Iterable<string>, event: LiveEvent = { kind: 'tree' }) {
  req.server.live.publish(userIds, event, originTab(req));
}
