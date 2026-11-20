import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { Anchor, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import type { FolderDto } from '@notes/shared';
import { useMe } from '../auth';
import { exportNotes, useCreateFolder, useFolderIndex, useLeaveShare, usePatchNote, useTrashActions, useTrashFolder, useTrashNote, useUpdateFolder } from '../data';
import { noteTitle } from '../lib/format';
import { useNoteDialog, useNoteSearch } from '../lib/note-dialog';
import { notifyError } from '../lib/notify';
import { MoveModal, NameModal } from './notes-ui';
import { usePrivacyContext } from './Privacy';
import { ImportModal, type ImportTarget } from './ImportModal';
import { ShareModal, type ShareTarget } from './ShareModal';

interface NoteRef {
  id: string;
  title: string;
  folderId: string | null;
}

interface Actions {
  createFolder: (parentId: string | null) => void;
  renameFolder: (folder: FolderDto) => void;
  moveFolder: (folder: FolderDto) => void;
  /** Direct move (drag & drop). */
  moveFolderTo: (folder: FolderDto, parentId: string | null) => void;
  trashFolder: (folder: FolderDto) => void;
  /** Make a folder private (sets up a PIN first if needed) or public again. */
  setFolderPrivate: (folder: FolderDto, isPrivate: boolean) => void;
  moveNote: (note: NoteRef) => void;
  moveNoteTo: (noteId: string, folderId: string | null) => void;
  trashNote: (note: NoteRef) => void;
  /** Owner: open the share dialog. */
  share: (target: ShareTarget) => void;
  /** Recipient: remove something from "Shared with me". */
  leaveShare: (target: ShareTarget) => void;
  /** Open the import dialog for a folder (null = Home), optionally with files already chosen. */
  importInto: (folderId: string | null, files?: File[]) => void;
  /** Download a folder (null = everything I own) as a zip. */
  exportFolder: (folder: FolderDto | null) => void;
}

const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions outside ActionsProvider');
  return ctx;
}

type Dialog =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'rename'; folder: FolderDto }
  | { kind: 'move-folder'; folder: FolderDto }
  | { kind: 'move-note'; note: NoteRef }
  | null;

/** Owns the folder/note dialogs so the sidebar and pages share one implementation. */
export function ActionsProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The note open in the note dialog, if any.
  const openNote = useNoteSearch().note;
  const noteDialog = useNoteDialog();
  const index = useFolderIndex();
  const createFolder = useCreateFolder();
  const updateFolder = useUpdateFolder();
  const trashFolder = useTrashFolder();
  const patchNote = usePatchNote();
  const trashNote = useTrashNote();
  const { restore } = useTrashActions();
  const privacy = usePrivacyContext();
  const leave = useLeaveShare();
  const { data: me } = useMe();
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const close = () => setDialog(null);
  // Moves stay within one owner's folders; a note at the top level belongs to me.
  const noteOwner = (note: NoteRef) => (note.folderId ? index.byId.get(note.folderId)?.ownerId : undefined) ?? me?.id ?? '';

  const undoable = (message: string, kind: 'folder' | 'note', id: string) => {
    const notificationId = `trash-${id}`;
    notifications.show({
      id: notificationId,
      message: (
        <Text size="sm">
          {message}{' '}
          <Anchor
            component="button"
            size="sm"
            onClick={() => {
              notifications.hide(notificationId);
              restore.mutate({ kind, id }, { onError: notifyError });
            }}
          >
            Undo
          </Anchor>
        </Text>
      ),
    });
  };

  const actions = useMemo<Actions>(() => {
    const folderLink = (id: string | null) =>
      id ? navigate({ to: '/f/$folderId', params: { folderId: id } }) : navigate({ to: '/' });
    return {
      createFolder: (parentId) => setDialog({ kind: 'create', parentId }),
      renameFolder: (folder) => setDialog({ kind: 'rename', folder }),
      moveFolder: (folder) => setDialog({ kind: 'move-folder', folder }),
      moveFolderTo: (folder, parentId) =>
        updateFolder.mutate({ id: folder.id, parentId }, { onError: notifyError }),
      trashFolder: (folder) =>
        trashFolder.mutate(folder.id, {
          onSuccess: () => {
            undoable(`"${folder.name}" moved to the trash.`, 'folder', folder.id);
            const viewed = pathname.match(/^\/f\/([^/]+)/)?.[1];
            if (viewed && index.isWithin(viewed, folder.id)) void folderLink(folder.parentId);
          },
          onError: notifyError,
        }),
      setFolderPrivate: async (folder, isPrivate) => {
        if (isPrivate && !(await privacy.requestSetup())) return;
        updateFolder.mutate(
          { id: folder.id, private: isPrivate },
          {
            onSuccess: () => {
              if (!isPrivate) {
                notifications.show({ message: `"${folder.name}" is no longer private.` });
              } else if (privacy.unlocked) {
                notifications.show({ message: `"${folder.name}" is now private. It will be hidden when private folders lock.` });
              } else {
                notifications.show({ message: `"${folder.name}" is now private and hidden. Use the lock button to show it.` });
                const viewed = pathname.match(/^\/f\/([^/]+)/)?.[1];
                if (viewed && index.isWithin(viewed, folder.id)) void folderLink(folder.parentId);
              }
            },
            onError: notifyError,
          },
        );
      },
      moveNote: (note) => setDialog({ kind: 'move-note', note }),
      moveNoteTo: (noteId, folderId) => patchNote.mutate({ id: noteId, folderId }, { onError: notifyError }),
      trashNote: (note) =>
        trashNote.mutate(note.id, {
          onSuccess: () => {
            undoable(`"${noteTitle(note.title)}" moved to the trash.`, 'note', note.id);
            if (openNote === note.id) noteDialog.close();
          },
          onError: notifyError,
        }),
      share: (target) => setShareTarget(target),
      importInto: (folderId, files) => setImportTarget({ folderId, files }),
      exportFolder: (folder) => {
        const id = `export-${folder?.id ?? 'all'}`;
        notifications.show({ id, loading: true, autoClose: false, message: `Preparing ${folder ? `"${folder.name}"` : 'your notes'} for download…` });
        exportNotes(folder?.id ?? null).then(
          () => notifications.hide(id),
          (err: unknown) => {
            notifications.hide(id);
            notifyError(err);
          },
        );
      },
      leaveShare: (target) =>
        leave.mutate(
          { kind: target.kind, id: target.id },
          {
            onSuccess: () => {
              notifications.show({ message: `"${target.name}" was removed from Shared with me.` });
              const viewedFolder = pathname.match(/^\/f\/([^/]+)/)?.[1];
              if (target.kind === 'folder' && viewedFolder && index.isWithin(viewedFolder, target.id)) void navigate({ to: '/shared' });
              else if (target.kind === 'note' && openNote === target.id) noteDialog.close();
            },
            onError: notifyError,
          },
        ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, pathname, openNote, noteDialog, index, privacy]);

  return (
    <ActionsContext.Provider value={actions}>
      {children}
      <NameModal
        opened={dialog?.kind === 'create'}
        title={
          dialog?.kind === 'create' && dialog.parentId
            ? `New folder in "${index.byId.get(dialog.parentId)?.name ?? ''}"`
            : 'New folder'
        }
        submitLabel="Create"
        loading={createFolder.isPending}
        onClose={close}
        onSubmit={(name) =>
          dialog?.kind === 'create' &&
          createFolder.mutate(
            { name, parentId: dialog.parentId },
            {
              onSuccess: (f) => {
                close();
                void navigate({ to: '/f/$folderId', params: { folderId: f.id } });
              },
              onError: notifyError,
            },
          )
        }
      />
      <NameModal
        opened={dialog?.kind === 'rename'}
        title="Rename folder"
        initial={dialog?.kind === 'rename' ? dialog.folder.name : ''}
        loading={updateFolder.isPending}
        onClose={close}
        onSubmit={(name) =>
          dialog?.kind === 'rename' &&
          updateFolder.mutate({ id: dialog.folder.id, name }, { onSuccess: close, onError: notifyError })
        }
      />
      <MoveModal
        opened={dialog?.kind === 'move-folder'}
        title={dialog?.kind === 'move-folder' ? `Move "${dialog.folder.name}"` : ''}
        currentFolderId={dialog?.kind === 'move-folder' ? dialog.folder.parentId : null}
        excludeFolderId={dialog?.kind === 'move-folder' ? dialog.folder.id : undefined}
        ownerId={dialog?.kind === 'move-folder' ? dialog.folder.ownerId : ''}
        loading={updateFolder.isPending}
        onClose={close}
        onMove={(parentId) =>
          dialog?.kind === 'move-folder' &&
          updateFolder.mutate({ id: dialog.folder.id, parentId }, { onSuccess: close, onError: notifyError })
        }
      />
      <MoveModal
        opened={dialog?.kind === 'move-note'}
        title={dialog?.kind === 'move-note' ? `Move "${noteTitle(dialog.note.title)}"` : ''}
        currentFolderId={dialog?.kind === 'move-note' ? dialog.note.folderId : null}
        ownerId={dialog?.kind === 'move-note' ? noteOwner(dialog.note) : ''}
        loading={patchNote.isPending}
        onClose={close}
        onMove={(folderId) =>
          dialog?.kind === 'move-note' &&
          patchNote.mutate({ id: dialog.note.id, folderId }, { onSuccess: close, onError: notifyError })
        }
      />
      <ShareModal target={shareTarget} onClose={() => setShareTarget(null)} />
      <ImportModal target={importTarget} onClose={() => setImportTarget(null)} />
    </ActionsContext.Provider>
  );
}
