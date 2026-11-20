import type { FastifyInstance } from 'fastify';
import { parseHttpUrl, type LinkContent } from '@notes/note-types';
import type { Db } from '../db';
import type { FileStore } from '../files/store';
import type { LinkPreviews } from '../links/service';
import { z } from 'zod';
import { badRequest, notFound, parse } from '../lib/errors';
import { requireViewer } from '../plugins/auth';
import { getNoteFor } from '../services/access';

type IdParams = { Params: { id: string } };
const titleBody = z.object({ url: z.string().min(1).max(2048) });

export async function linkRoutes(
  app: FastifyInstance,
  { db, store, previews }: { db: Db; store: FileStore; previews: LinkPreviews },
) {
  /** Fetch the page information of a link note again. */
  app.post<IdParams>('/api/notes/:id/refresh-meta', async (req) => {
    const viewer = requireViewer(req);
    const note = getNoteFor(db, viewer, req.params.id, 'write');
    if (note.type !== 'link') throw badRequest('Only link notes have page information');
    const url = parseHttpUrl((note.content as LinkContent).url);
    if (!url) throw badRequest('The note has no valid http(s) link');
    previews.forget(url.toString());
    return previews.refresh(note.id, url.toString()) ?? { status: 'disabled', url: url.toString() };
  });

  /** Title of a page, to name a link note before it is created. `title` is missing if unavailable. */
  app.post('/api/links/title', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    requireViewer(req);
    const { url: raw } = parse(titleBody, req.body);
    const url = parseHttpUrl(raw);
    if (!url) throw badRequest('Not a valid http(s) link');
    const title = await previews.lookupTitle(url.toString());
    return title ? { title } : {};
  });

  /** Stored files (preview images, favicons). Readable by whoever can read the note they belong to. */
  app.get<IdParams>('/api/files/:id', async (req, reply) => {
    const viewer = requireViewer(req);
    const file = store.get(req.params.id);
    if (!file) throw notFound('File not found');
    if (file.noteId) getNoteFor(db, viewer, file.noteId, 'read');
    else if (file.ownerId !== viewer.id) throw notFound('File not found');

    // Small files (thumbnails, icons): decrypted in memory. Missing, damaged or changed files are not served.
    const data = store.read(file);
    if (!data) throw notFound('File not found');
    return reply
      .header('Content-Type', file.mime)
      .header('Content-Length', data.length)
      // File ids never change content; a refetch creates new ids.
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      .send(data);
  });
}
