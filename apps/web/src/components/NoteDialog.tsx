import { useRef, useState } from 'react';
import { Center, Loader, Modal } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Navigate } from '@tanstack/react-router';
import { getClientNoteType, type NoteDialogSize } from '@notes/note-types/client';
import { useFolderIndex, useNote } from '../data';
import { sharedSearch, useNoteDialog, useNoteSearch, type NoteSearch } from '../lib/note-dialog';
import { NoteView } from '../pages/NotePage';

/** Dialog widths per note type size (see NoteTypeClient.dialogSize). Capped by the window width. */
const WIDTH: Record<NoteDialogSize, number> = { sm: 640, md: 820, lg: 1400 };

const MAXIMIZED_KEY = 'notes.noteDialog.maximized';
function readMaximized(): boolean {
  try {
    return sessionStorage.getItem(MAXIMIZED_KEY) === '1';
  } catch {
    return false;
  }
}
function saveMaximized(on: boolean) {
  try {
    sessionStorage.setItem(MAXIMIZED_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; it still applies until the page is reloaded.
  }
}

/**
 * The note named in the address (`?note=…`), in a dialog over the current page. Its size depends
 * on the note type; phones always show it full screen. While editing, Escape and clicks outside
 * do not close it (editors use Escape themselves).
 */
export function NoteDialog() {
  const search = useNoteSearch();
  const dialog = useNoteDialog();
  // Keeps showing the note while the dialog fades out after the address dropped it.
  const shown = useRef<NoteSearch>(search);
  if (search.note) shown.current = search;
  const { note: noteId, new: draftType, folder } = shown.current;

  const note = useNote(noteId ?? '', Boolean(noteId) && !draftType);
  const size = getClientNoteType(draftType ?? note.data?.type ?? '')?.dialogSize ?? 'md';
  const phone = useMediaQuery('(max-width: 48em)') ?? false;
  const [maximized, setMaximized] = useState(readMaximized);
  const [editing, setEditing] = useState(false);
  const fullScreen = phone || maximized;
  const fill = fullScreen || size === 'lg';
  const shared = draftType ? sharedSearch(shown.current) : {};

  return (
    <Modal
      opened={Boolean(search.note)}
      onClose={dialog.close}
      withCloseButton={false}
      fullScreen={fullScreen}
      size={WIDTH[size]}
      padding="md"
      radius={fullScreen ? 0 : 'md'}
      closeOnEscape={!editing}
      closeOnClickOutside={!editing}
      transitionProps={{ duration: phone ? 0 : 150 }}
      styles={{
        content: {
          // A border in dark mode (see main.tsx); full screen needs none.
          ...(!fullScreen && { border: '1px solid var(--notes-popup-border)' }),
          ...(fill && { height: fullScreen ? '100dvh' : '90dvh', display: 'flex', flexDirection: 'column' }),
        },
        body: fill ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : {},
      }}
    >
      {noteId && (
        <NoteView
          key={noteId}
          noteId={noteId}
          draftType={draftType}
          draftFolderId={folder ?? null}
          shared={draftType && Object.keys(shared).length ? shared : undefined}
          chrome={{
            onClose: dialog.close,
            fill,
            maximized,
            onToggleMaximize: phone
              ? undefined
              : () => {
                  saveMaximized(!maximized);
                  setMaximized(!maximized);
                },
            onEditingChange: setEditing,
          }}
        />
      )}
    </Modal>
  );
}

/** Old note addresses (`/n/<id>`): the note's folder with the note open over it. */
export function NoteRedirect({ noteId }: { noteId: string }) {
  const note = useNote(noteId);
  const index = useFolderIndex();
  if (note.isPending || index.isPending) {
    return (
      <Center mih="50vh">
        <Loader />
      </Center>
    );
  }
  const search = { note: noteId };
  const n = note.data;
  if (n?.folderId && index.byId.has(n.folderId)) return <Navigate to="/f/$folderId" params={{ folderId: n.folderId }} search={search} replace />;
  // A note shared with me on its own lives in "Shared with me".
  if (n && n.permission !== 'owner' && n.folderId === null) return <Navigate to="/shared" search={search} replace />;
  // Home (also for missing notes: the dialog says it was not found).
  return <Navigate to="/" search={search} replace />;
}
