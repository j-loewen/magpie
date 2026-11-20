import { useMemo } from 'react';
import { useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import type { SharedContent } from '@notes/note-types';
import { newId } from '../api';
import type { ShareTargetSearch } from './share';

/*
 * Notes open in a dialog over the current page. Which note is open is part of the address, as
 * search parameters of whatever page is behind it (`/f/…?note=<id>`), so reload, Back and links
 * work. A new, unsaved draft also has `new` (its type) and `folder`, plus what another app shared
 * (`title`, `text`, `url`).
 */

declare module '@tanstack/history' {
  interface HistoryState {
    /** The dialog was opened by the app (so closing it can go back one step, like Back does). */
    noteDialog?: boolean;
  }
}

export type NoteSearch = { note?: string; new?: string; folder?: string } & ShareTargetSearch;

const DIALOG_KEYS = ['note', 'new', 'folder', 'title', 'text', 'url'] as const;

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

/** The share fields of a search (Android share sheet). */
export function sharedSearch(search: Record<string, unknown>): ShareTargetSearch {
  const out: ShareTargetSearch = {};
  for (const k of ['title', 'text', 'url'] as const) {
    const v = str(search[k]);
    if (v) out[k] = v;
  }
  return out;
}

/** validateSearch of every app page: the note dialog's parameters. */
export function validateNoteSearch(search: Record<string, unknown>): NoteSearch {
  const note = str(search.note);
  if (!note) return {};
  const type = str(search.new);
  const folder = str(search.folder);
  return { note, ...(type && { new: type }), ...(type && folder && { folder }), ...(type && sharedSearch(search)) };
}

/** A page's search without the dialog's parameters. */
export function withoutNote<T extends object>(search: T): Omit<T, (typeof DIALOG_KEYS)[number]> {
  const out = { ...search } as Record<string, unknown>;
  for (const k of DIALOG_KEYS) delete out[k];
  return out as Omit<T, (typeof DIALOG_KEYS)[number]>;
}

/** The dialog's parameters in the current address. */
export function useNoteSearch(): NoteSearch {
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  return useMemo(() => validateNoteSearch(search), [search]);
}

export function useNoteDialog() {
  const navigate = useNavigate();
  const router = useRouter();
  return useMemo(
    () => ({
      /** Opens a saved note. */
      open: (id: string) =>
        void navigate({ to: '.', search: (prev: object) => ({ ...withoutNote(prev), note: id }), state: { noteDialog: true } } as never),
      /** Opens a new, unsaved note of `type` (created in `folderId` once it has a name). */
      openNew: (type: string, folderId: string | null, shared?: SharedContent & { title?: string }) =>
        void navigate({
          to: '.',
          search: (prev: object) => ({
            ...withoutNote(prev),
            note: newId(),
            new: type,
            ...(folderId && { folder: folderId }),
            ...(shared && sharedSearch(shared as Record<string, unknown>)),
          }),
          state: { noteDialog: true },
        } as never),
      /** The draft was created: the address now names the saved note (reload opens it, not a new draft). */
      created: (id: string) =>
        void navigate({ to: '.', search: (prev: object) => ({ ...withoutNote(prev), note: id }), state: true, replace: true } as never),
      close: () => {
        if (router.state.location.state.noteDialog) router.history.back();
        else void navigate({ to: '.', search: (prev: object) => withoutNote(prev), replace: true } as never);
      },
    }),
    [navigate, router],
  );
}
