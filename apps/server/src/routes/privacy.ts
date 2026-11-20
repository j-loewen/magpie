import type { FastifyInstance } from 'fastify';
import { DEFAULT_PREFS, removeSecretSchema, setSecretSchema, unlockSchema } from '@notes/shared';
import type { Db } from '../db';
import { parse } from '../lib/errors';
import { requireUser } from '../plugins/auth';
import { extend, lock, privacyStatus, removeSecret, setSecret, unlock } from '../services/privacy';
import { publish } from '../live/hub';

export async function privacyRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/api/privacy', async (req) => {
    const { user, session } = requireUser(req);
    return privacyStatus(db, user, session);
  });

  app.put('/api/privacy/secret', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { user, session } = requireUser(req);
    await setSecret(db, user, parse(setSecretSchema, req.body));
    return privacyStatus(db, user, session);
  });

  app.delete('/api/privacy/secret', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const { user, session } = requireUser(req);
    await removeSecret(db, user, parse(removeSecretSchema, req.body).accountPassword);
    session.privateUnlockedUntil = null;
    // Private folders became normal folders on all my devices.
    publish(req, [user.id]);
    return privacyStatus(db, user, session);
  });

  // Rate limited per user (in addition to the lockout after repeated wrong attempts).
  app.post(
    '/api/privacy/unlock',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req) => req.auth?.user.id ?? req.ip } } },
    async (req) => {
      const { user, session } = requireUser(req);
      const minutes = user.prefs.unlockMinutes ?? DEFAULT_PREFS.unlockMinutes;
      await unlock(db, user, session, parse(unlockSchema, req.body).secret, minutes);
      return privacyStatus(db, user, session);
    },
  );

  app.post('/api/privacy/extend', async (req) => {
    const { user, session } = requireUser(req);
    extend(db, session, user.prefs.unlockMinutes ?? DEFAULT_PREFS.unlockMinutes);
    return privacyStatus(db, user, session);
  });

  app.post('/api/privacy/lock', async (req) => {
    const { user, session } = requireUser(req);
    lock(db, session);
    return privacyStatus(db, user, session);
  });
}
