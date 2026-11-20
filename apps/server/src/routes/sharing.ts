import type { FastifyInstance } from 'fastify';
import { shareRefSchema, shareSchema, unshareSchema } from '@notes/shared';
import type { Db } from '../db';
import { parse } from '../lib/errors';
import { requireViewer } from '../plugins/auth';
import { publish } from '../live/hub';
import { folderAudience, noteAudience, union } from '../services/audience';
import { leaveShare, listShares, share, sharedWithMe, unshare, userDirectory } from '../services/sharing';

export async function sharingRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const audience = (kind: 'folder' | 'note', id: string) => (kind === 'folder' ? folderAudience(db, id) : noteAudience(db, id));

  /** Other users on this server (for picking whom to share with). */
  app.get('/api/users', async (req) => userDirectory(db, requireViewer(req)));

  /** Everything shared directly with me. */
  app.get('/api/shared', async (req) => sharedWithMe(db, requireViewer(req)));

  /** Who an item is shared with (owner only). */
  app.get('/api/shares', async (req) => {
    const { kind, id } = parse(shareRefSchema, req.query);
    return listShares(db, requireViewer(req), kind, id);
  });

  /** Share or change permission (owner only). */
  app.put('/api/shares', async (req) => {
    const input = parse(shareSchema, req.body);
    const result = share(db, requireViewer(req), input);
    publish(req, union(audience(input.kind, input.id), [input.userId]));
    return result;
  });

  /** Stop sharing with a user (owner only). */
  app.delete('/api/shares', async (req) => {
    const { kind, id, userId } = parse(unshareSchema, req.body);
    const result = unshare(db, requireViewer(req), kind, id, userId);
    publish(req, union(audience(kind, id), [userId]));
    return result;
  });

  /** Remove something from my "Shared with me". */
  app.delete('/api/shared', async (req, reply) => {
    const { kind, id } = parse(shareRefSchema, req.body);
    const viewer = requireViewer(req);
    leaveShare(db, viewer, kind, id);
    // The owner's share count changes too.
    publish(req, union(audience(kind, id), [viewer.id]));
    return reply.code(204).send();
  });
}
