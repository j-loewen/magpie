import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IMPORT_MAX_BYTES, importQuerySchema } from '@notes/shared';
import type { Db } from '../db';
import { badRequest, parse } from '../lib/errors';
import { requireViewer } from '../plugins/auth';
import { exportArchive, importUpload } from '../services/transfer';
import { publish } from '../live/hub';
import { folderAudience, union } from '../services/audience';

/** RFC 6266 attachment header with an ASCII fallback for old clients. */
export function attachment(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

const exportQuery = z.object({ folderId: z.string().min(1).max(64).optional() });

export async function transferRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // Uploads are sent as the raw file body (only within this plugin).
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: IMPORT_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  /** Everything I own (or one folder I can read) as a zip. Private folders are included only while unlocked. */
  app.get('/api/export', async (req, reply) => {
    const viewer = requireViewer(req);
    const { folderId } = parse(exportQuery, req.query);
    const { fileName, data } = exportArchive(db, viewer, folderId ?? null);
    return reply
      .header('content-type', 'application/zip')
      .header('content-disposition', attachment(fileName))
      .header('cache-control', 'no-store')
      .send(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  });

  app.post('/api/import', { bodyLimit: IMPORT_MAX_BYTES }, async (req) => {
    const viewer = requireViewer(req);
    const q = parse(importQuerySchema, req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('Send the file as application/octet-stream');
    const result = importUpload(db, viewer, { name: q.name, data: req.body, folderId: q.folderId ?? null, previews: q.previews === 'true' });
    publish(req, union(folderAudience(db, q.folderId), [viewer.id]));
    return result;
  });
}
