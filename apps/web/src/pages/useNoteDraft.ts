import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { NoteConflictDetails, NoteDto } from '@notes/shared';
import { missingForSave } from '@notes/note-types';
import { getClientNoteType } from '@notes/note-types/client';
import { api, ApiError } from '../api';
import { keys } from '../data';

/**
 * new: a draft nobody typed into yet · incomplete: changed, but cannot be saved yet (see `missing`)
 */
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'gone' | 'new' | 'incomplete';

const SAVE_DELAY = 800;
const RETRY_DELAY = 5000;

/**
 * Local draft of a note with autosave. Saves are sent with the version the draft is based on;
 * if the server has a newer version, saving stops and `conflict` holds the server's note until
 * the user picks a resolution.
 *
 * A note with version 0 is a new, unsaved draft: it is created on the server (under its id) by
 * the first save. Nothing is saved while the note lacks a name or what its type requires (a
 * link's web address); `missing` says what.
 */
export function useNoteDraft(note: NoteDto, { onCreated }: { onCreated?: (note: NoteDto) => void } = {}) {
  const qc = useQueryClient();
  const def = getClientNoteType(note.type)?.def;
  const missingFor = useCallback(
    (title: string, content: unknown) => (def ? missingForSave(def, title, content) : undefined),
    [def],
  );
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState<unknown>(note.content);
  const [status, setStatus] = useState<SaveStatus>(note.version === 0 ? 'new' : 'saved');
  const [missing, setMissing] = useState(() => missingFor(note.title, note.content));
  const [conflict, setConflict] = useState<NoteDto | null>(null);
  const [isNew, setIsNew] = useState(note.version === 0);
  const s = useRef({
    title: note.title,
    content: note.content,
    version: note.version,
    dirty: false,
    saving: false,
    inConflict: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  }).current;

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(s.timer);
    s.timer = undefined;
    // If a save is running, the check at the end of that save picks up these changes.
    if (!s.dirty || s.saving || s.inConflict) return;
    // Incomplete notes are not sent (the server would refuse them); they stay dirty.
    if (missingFor(s.title, s.content)) return;
    const creating = s.version === 0;
    s.saving = true;
    s.dirty = false;
    setStatus('saving');
    try {
      const saved = creating
        ? await api<NoteDto>('/api/notes', 'POST', {
            id: note.id,
            type: note.type,
            folderId: note.folderId,
            title: s.title,
            content: s.content,
          })
        : await api<NoteDto>(`/api/notes/${note.id}`, 'PUT', { title: s.title, content: s.content, version: s.version });
      s.version = saved.version;
      qc.setQueryData(keys.note(note.id), saved);
      void qc.invalidateQueries({ queryKey: ['notes'] });
      void qc.invalidateQueries({ queryKey: ['search'] });
      if (creating) {
        void qc.invalidateQueries({ queryKey: ['folders'] });
        setIsNew(false);
        onCreated?.(saved);
      }
      setStatus(s.dirty ? 'dirty' : 'saved');
    } catch (err) {
      s.dirty = true;
      if (creating && err instanceof ApiError && err.status === 409) {
        // Created before, but the answer got lost (e.g. a dropped connection): continue on that note.
        try {
          const existing = await api<NoteDto>(`/api/notes/${note.id}`);
          s.version = existing.version;
          qc.setQueryData(keys.note(note.id), existing);
          setIsNew(false);
          onCreated?.(existing);
          s.timer = setTimeout(() => void save(), 0);
        } catch {
          s.inConflict = true;
          setStatus('gone');
        }
      } else if (err instanceof ApiError && err.status === 409) {
        s.inConflict = true;
        setConflict((err.details as NoteConflictDetails).current);
        setStatus('conflict');
      } else if (err instanceof ApiError && err.status === 404) {
        // Deleted elsewhere, or private folders locked: retrying cannot help.
        s.inConflict = true;
        setStatus('gone');
      } else {
        setStatus('error');
        s.timer = setTimeout(() => void save(), RETRY_DELAY);
      }
    } finally {
      s.saving = false;
    }
    // Edits made while the request was in flight.
    if (s.dirty && !s.inConflict && !s.timer) s.timer = setTimeout(() => void save(), SAVE_DELAY);
    // onCreated is a callback from the page; it may change identity without mattering here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, note.type, note.folderId, qc, s, missingFor]);

  const schedule = useCallback(() => {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = undefined;
      void save();
    }, SAVE_DELAY);
  }, [s, save]);

  const edit = useCallback(
    (patch: { title?: string; content?: unknown }) => {
      if (patch.title !== undefined) {
        s.title = patch.title;
        setTitle(patch.title);
      }
      if (patch.content !== undefined) {
        s.content = patch.content;
        setContent(patch.content);
      }
      s.dirty = true;
      const m = missingFor(s.title, s.content);
      setMissing(m);
      if (!s.inConflict && !s.saving) setStatus(m ? 'incomplete' : 'dirty');
      if (m) clearTimeout(s.timer);
      else schedule();
    },
    [s, schedule, missingFor],
  );

  /** Fill the name with a suggestion (e.g. the page title of a link), unless one was typed meanwhile. */
  const suggestTitle = useCallback(
    (suggestion: string) => {
      if (s.title.trim() === '' && suggestion.trim()) edit({ title: suggestion.trim() });
    },
    [s, edit],
  );

  const takeServerVersion = useCallback(
    (server: NoteDto) => {
      Object.assign(s, { title: server.title, content: server.content, version: server.version, dirty: false, inConflict: false });
      setTitle(server.title);
      setContent(server.content);
      setMissing(undefined);
      setConflict(null);
      setStatus('saved');
      qc.setQueryData(keys.note(note.id), server);
    },
    [note.id, qc, s],
  );

  // Live refresh: a newer version saved elsewhere replaces the draft when I have no unsaved
  // changes. With unsaved changes, the next save runs into the conflict dialog as before.
  useEffect(() => {
    if (note.version > s.version && !s.dirty && !s.saving && !s.inConflict) takeServerVersion(note);
  }, [note, s, takeServerVersion]);

  const resolve = {
    /** Save my draft on top of the other change. */
    overwrite: () => {
      if (!conflict) return;
      s.version = conflict.version;
      s.inConflict = false;
      s.dirty = true;
      setConflict(null);
      void save();
    },
    /** Drop my changes and show the other version. */
    discard: () => conflict && takeServerVersion(conflict),
    /** Server version stays in this note; returns my draft so it can be saved as a new note. */
    takeTheirsKeepMine: () => {
      const mine = { title: s.title, content: s.content };
      if (conflict) takeServerVersion(conflict);
      return mine;
    },
  };

  /** Changes that will be lost on leaving, because the note cannot be saved yet. */
  const unsavable = useCallback(
    () => (s.dirty && !s.inConflict ? missingFor(s.title, s.content) : undefined),
    [s, missingFor],
  );

  // Ctrl/Cmd+S, leaving the page, and unmount all flush pending changes.
  const flush = useCallback(() => save(), [save]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (s.dirty || s.saving) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      void save();
    };
  }, [s, save]);

  return { title, content, status, missing, isNew, conflict, edit, suggestTitle, flush, unsavable, resolve };
}
