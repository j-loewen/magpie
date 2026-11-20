import type { FastifyInstance } from 'fastify';
import type { PruneResultDto, StorageStatusDto } from '@notes/shared';
import type { FileStore } from '../files/store';
import { purgeExpiredSessions } from '../auth/sessions';
import { adminCreateUserSchema, adminUpdateUserSchema } from '@notes/shared';
import type { Db } from '../db';
import { deleteUserSessions } from '../auth/sessions';
import { parse } from '../lib/errors';
import { publish } from '../live/hub';
import { requireAdmin } from '../plugins/auth';
import { adminCreateUser, adminDeleteUser, adminUpdateUser, listUsers, toUserDto } from '../services/users';

/** Account management only: admins never get access to other users' notes through these routes. */
export async function adminRoutes(
  app: FastifyInstance,
  { db, store }: { db: Db; store: FileStore },
) {
  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    return listUsers(db).map(toUserDto);
  });

  app.post('/api/admin/users', async (req, reply) => {
    requireAdmin(req);
    const user = await adminCreateUser(db, parse(adminCreateUserSchema, req.body));
    return reply.code(201).send(toUserDto(user));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/users/:id', async (req) => {
    const { user: me } = requireAdmin(req);
    const input = parse(adminUpdateUserSchema, req.body);
    const updated = await adminUpdateUser(db, req.params.id, input);
    if (input.password) {
      // Resetting a password logs that user out everywhere (keep the admin's own session).
      deleteUserSessions(db, updated.id, updated.id === me.id ? (req.sessionToken ?? undefined) : undefined);
    }
    publish(req, [updated.id], { kind: 'me' });
    return toUserDto(updated);
  });

  app.delete<{ Params: { id: string } }>('/api/admin/users/:id', async (req, reply) => {
    const { user: me } = requireAdmin(req);
    // People this user shared things with lose them.
    const recipients = db.$client
      .prepare(
        `SELECT s.user_id AS id FROM folder_shares s JOIN folders f ON f.id = s.folder_id WHERE f.owner_id = @id
         UNION SELECT s.user_id FROM note_shares s JOIN notes n ON n.id = s.note_id WHERE n.owner_id = @id`,
      )
      .all({ id: req.params.id }) as { id: string }[];
    adminDeleteUser(db, req.params.id, me.id);
    // Their notes are gone, and with them the notes' stored files.
    store.removeDeletedNotes();
    publish(req, recipients.map((r) => r.id));
    return reply.code(204).send();
  });

  // ---- Storage: what takes space, and a clean-up of everything no longer used.
  const databaseBytes = () =>
    (db.$client.pragma('page_count', { simple: true }) as number) * (db.$client.pragma('page_size', { simple: true }) as number);
  const storageStatus = (): StorageStatusDto => ({ files: store.usage(), databaseBytes: databaseBytes() });

  app.get('/api/admin/storage', async (req) => {
    requireAdmin(req);
    return storageStatus();
  });

  app.post('/api/admin/storage/prune', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req): Promise<PruneResultDto> => {
    requireAdmin(req);
    const files = store.prune();
    const sessions = purgeExpiredSessions(db).changes;
    const databaseBytesBefore = databaseBytes();
    // Give space freed by deleted notes back to the file system.
    db.$client.exec('VACUUM');
    db.$client.pragma('wal_checkpoint(TRUNCATE)');
    return { ...files, sessions, databaseBytesBefore, databaseBytesAfter: databaseBytes(), status: storageStatus() };
  });
}
