import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createFolderSchema,
  createNoteSchema,
  NOTE_SORTS,
  patchNoteSchema,
  restoreSchema,
  saveNoteSchema,
  updateFolderSchema,
  updateFolderViewSchema,
} from '@notes/shared';
import type { AppConfig } from '../config';
import type { Db } from '../db';
import type { FileStore } from '../files/store';
import { parse } from '../lib/errors';
import { requireViewer } from '../plugins/auth';
import { getFolderView, updateFolderView } from '../services/folder-views';
import { createFolder, listFolders, trashFolder, updateFolder } from '../services/folders';
import { createNote, getNote, listNotes, patchNote, saveNote, trashNote } from '../services/notes';
import { searchNotes } from '../services/search';
import { publish } from '../live/hub';
import { folderAudience, noteAudience, union } from '../services/audience';
import { emptyTrash, listTrash, purgeFolder, purgeNote, restoreFolder, restoreNote } from '../services/trash';

type IdParams = { Params: { id: string } };

const listNotesQuery = z.object({
  /** Omitted = top level. */
  folderId: z.string().min(1).optional(),
  sort: z.enum(NOTE_SORTS).default('updated'),
});
const searchQuery = z.object({ q: z.string().max(500).default('') });
/** Omitted = Home. */
const folderViewQuery = z.object({ folderId: z.string().min(1).optional() });

export async function notesRoutes(app: FastifyInstance, { db, config, store }: { db: Db; config: AppConfig; store: FileStore }) {
  // ---- Folders
  app.get('/api/folders', async (req) => listFolders(db, requireViewer(req)));

  // Changes are announced to everyone who could see the item before or after the change.
  app.post('/api/folders', async (req, reply) => {
    const viewer = requireViewer(req);
    const folder = createFolder(db, viewer, parse(createFolderSchema, req.body));
    publish(req, union(folderAudience(db, folder.id), [viewer.id]));
    return reply.code(201).send(folder);
  });

  app.patch<IdParams>('/api/folders/:id', async (req) => {
    const viewer = requireViewer(req);
    const input = parse(updateFolderSchema, req.body);
    const before = folderAudience(db, req.params.id);
    const folder = updateFolder(db, viewer, req.params.id, input);
    // Marking a folder private only changes what I see.
    const others = input.name !== undefined || input.parentId !== undefined;
    publish(req, others ? union(before, folderAudience(db, req.params.id), [viewer.id]) : [viewer.id]);
    return folder;
  });

  app.delete<IdParams>('/api/folders/:id', async (req, reply) => {
    const viewer = requireViewer(req);
    const before = folderAudience(db, req.params.id);
    trashFolder(db, viewer, req.params.id);
    publish(req, union(before, [viewer.id]));
    return reply.code(204).send();
  });

  // ---- My view settings per folder (sort, layout, card size); only my other devices are told.
  app.get('/api/folder-view', async (req) => {
    const { folderId } = parse(folderViewQuery, req.query);
    return getFolderView(db, requireViewer(req), folderId ?? null);
  });

  app.put('/api/folder-view', async (req) => {
    const viewer = requireViewer(req);
    const view = updateFolderView(db, viewer, parse(updateFolderViewSchema, req.body));
    publish(req, [viewer.id], { kind: 'me' });
    return view;
  });

  // ---- Notes
  app.get('/api/notes', async (req) => {
    const viewer = requireViewer(req);
    const q = parse(listNotesQuery, req.query);
    return listNotes(db, viewer, q.folderId ?? null, q.sort);
  });

  app.post('/api/notes', async (req, reply) => {
    const viewer = requireViewer(req);
    const note = createNote(db, viewer, parse(createNoteSchema, req.body));
    publish(req, union(noteAudience(db, note.id), [viewer.id]));
    return reply.code(201).send(note);
  });

  app.get<IdParams>('/api/notes/:id', async (req) => getNote(db, requireViewer(req), req.params.id));

  app.put<IdParams>('/api/notes/:id', async (req) => {
    const viewer = requireViewer(req);
    const note = saveNote(db, viewer, req.params.id, parse(saveNoteSchema, req.body));
    publish(req, union(noteAudience(db, note.id), [viewer.id]), { kind: 'note', id: note.id, version: note.version });
    return note;
  });

  app.patch<IdParams>('/api/notes/:id', async (req) => {
    const viewer = requireViewer(req);
    const before = noteAudience(db, req.params.id);
    const note = patchNote(db, viewer, req.params.id, parse(patchNoteSchema, req.body));
    publish(req, union(before, noteAudience(db, note.id), [viewer.id]));
    return note;
  });

  app.delete<IdParams>('/api/notes/:id', async (req, reply) => {
    const viewer = requireViewer(req);
    const before = noteAudience(db, req.params.id);
    trashNote(db, viewer, req.params.id);
    publish(req, union(before, [viewer.id]));
    return reply.code(204).send();
  });

  // ---- Search
  app.get('/api/search', async (req) => {
    const viewer = requireViewer(req);
    return searchNotes(db, viewer, parse(searchQuery, req.query).q);
  });

  // ---- Trash
  app.get('/api/trash', async (req) => listTrash(db, requireViewer(req), config.trashDays));

  app.post('/api/trash/restore', async (req, reply) => {
    const viewer = requireViewer(req);
    const { kind, id } = parse(restoreSchema, req.body);
    if (kind === 'folder') restoreFolder(db, viewer, id);
    else restoreNote(db, viewer, id);
    publish(req, union(kind === 'folder' ? folderAudience(db, id) : noteAudience(db, id), [viewer.id]));
    return reply.code(204).send();
  });

  app.delete<{ Params: { kind: string; id: string } }>('/api/trash/:kind/:id', async (req, reply) => {
    const viewer = requireViewer(req);
    const { kind, id } = parse(restoreSchema, req.params);
    if (kind === 'folder') purgeFolder(db, viewer, id);
    else purgeNote(db, viewer, id);
    // Deleted for good: their stored files go too.
    store.removeDeletedNotes();
    // Only the owner sees the trash.
    publish(req, [viewer.id]);
    return reply.code(204).send();
  });

  app.delete('/api/trash', async (req, reply) => {
    const viewer = requireViewer(req);
    emptyTrash(db, viewer);
    store.removeDeletedNotes();
    publish(req, [viewer.id]);
    return reply.code(204).send();
  });
}
