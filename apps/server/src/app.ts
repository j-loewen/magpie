import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { eq, sql } from 'drizzle-orm';
import type { AppConfig } from './config';
import type { Db } from './db';
import { purgeExpiredSessions } from './auth/sessions';
import { HttpError } from './lib/errors';
import authPlugin from './plugins/auth';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { SsoService } from './auth/sso';
import { meRoutes } from './routes/me';
import { notesRoutes } from './routes/notes';
import { linkRoutes } from './routes/links';
import { privacyRoutes } from './routes/privacy';
import { sharingRoutes } from './routes/sharing';
import { transferRoutes } from './routes/transfer';
import { liveRoutes } from './routes/live';
import { LiveHub } from './live/hub';
import { noteAudience } from './services/audience';
import { notes as notesTable } from './db/schema';
import { checklistHooks } from './services/checklist';
import { FileStore } from './files/store';
import { LinkPreviews } from './links/service';
import { setNoteHooks } from './note-hooks';
import { purgeExpiredTrash } from './services/trash';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // Mantine injects style tags
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

declare module 'fastify' {
  interface FastifyInstance {
    linkPreviews: LinkPreviews;
    live: LiveHub;
  }
}

export async function buildApp(config: AppConfig, db: Db) {
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 5 * 1024 * 1024,
  });

  app.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error(err);
      return reply.code(500).send({ error: 'internal', message: 'Internal server error' });
    }
    return reply.code(status).send({ error: err.code ?? 'error', message: err.message });
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header('Content-Security-Policy', CSP);
    }
    return payload;
  });

  // Live refresh: open event streams are ended before the server closes, or shutdown would wait for them.
  const live = new LiveHub();
  app.decorate('live', live);
  app.addHook('preClose', async () => live.closeAll());

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin, { db, config });

  app.get('/api/health', async () => {
    db.run(sql`select 1`);
    return { ok: true };
  });
  await app.register(authRoutes, { db, config, sso: new SsoService(config, app.log) });
  await app.register(meRoutes, { db });
  // Stored files (link preview images): one folder per note, encrypted with the same key as the database.
  const store = new FileStore(db, config.dataDir, config.encryptionKey);
  await app.register(adminRoutes, { db, store });
  // Note types with server-side behaviour.
  const previews = new LinkPreviews(db, store, config, app.log);
  setNoteHooks(db, { link: previews.hooks(), checklist: checklistHooks(db) });
  app.decorate('linkPreviews', previews);
  // A finished link preview changes what viewers of the note see.
  previews.onUpdate = (noteId) => {
    const version = db.select({ version: notesTable.version }).from(notesTable).where(eq(notesTable.id, noteId)).get()?.version;
    if (version !== undefined) live.publish(noteAudience(db, noteId), { kind: 'note', id: noteId, version });
  };
  app.addHook('onClose', async () => previews.close());
  previews.resumePending();

  await app.register(notesRoutes, { db, config, store });
  await app.register(linkRoutes, { db, store, previews });
  await app.register(privacyRoutes, { db });
  await app.register(sharingRoutes, { db });
  await app.register(transferRoutes, { db });
  await app.register(liveRoutes, { db, config });

  const webDist = config.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      setHeaders: (res, filePath) => {
        // Vite emits content-hashed file names under /assets, so they can be cached forever.
        const hashed = filePath.includes(`${path.sep}assets${path.sep}`);
        res.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }

  app.setNotFoundHandler((req, reply) => {
    // SPA fallback: unknown non-API GETs get index.html so client-side routes work on reload.
    if (webDist && req.method === 'GET' && !req.url.startsWith('/api/')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });

  const housekeeping = () => {
    purgeExpiredSessions(db);
    purgeExpiredTrash(db, config.trashDays);
    // Files of deleted notes, and anything left behind (e.g. a preview finishing after its note was deleted).
    store.prune(60 * 60 * 1000);
  };
  housekeeping();
  const cleanup = setInterval(housekeeping, 60 * 60 * 1000);
  cleanup.unref();
  app.addHook('onClose', async () => clearInterval(cleanup));

  return app;
}
