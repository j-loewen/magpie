import { Suspense, useEffect, useMemo, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Center,
  Code,
  Group,
  Loader,
  Menu,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
  useComputedColorScheme,
} from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconArrowsMove,
  IconCheck,
  IconCloudUpload,
  IconDots,
  IconDownload,
  IconPin,
  IconLogout2,
  IconPencil,
  IconPinnedOff,
  IconShare,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { canEdit, type NoteDto } from '@notes/shared';
import type { SharedContent } from '@notes/note-types';
import { getClientNoteType } from '@notes/note-types/client';
import { api, ApiError } from '../api';
import { useMe } from '../auth';
import { useCreateNote, useFolderIndex, useNote, usePatchNote, useRefreshMeta } from '../data';
import { useActions } from '../components/Actions';
import { NoteIconPicker } from '../components/NoteIconPicker';
import { useBeforeLock } from '../components/Privacy';
import { downloadNote } from '../lib/download';
import { fullDate, relativeTime } from '../lib/format';
import { useNoteDialog } from '../lib/note-dialog';
import { notifyError, notifyOk } from '../lib/notify';
import { SharingBadge } from './FolderPage';
import { useNoteDraft, type SaveStatus } from './useNoteDraft';

/** What the dialog around a note provides (see components/NoteDialog). */
export interface NoteChrome {
  onClose: () => void;
  /** The editor fills a fixed-height dialog (large note types, full screen). */
  fill: boolean;
  maximized: boolean;
  /** Unset where the dialog is always full screen (phones). */
  onToggleMaximize?: () => void;
  /** Editing started or ended (the dialog then ignores Escape and clicks outside). */
  onEditingChange: (editing: boolean) => void;
}

/** A note (or a new draft) as shown in the note dialog. */
export function NoteView({
  noteId,
  draftType,
  draftFolderId = null,
  shared,
  chrome,
}: {
  noteId: string;
  /** Set for a new, unsaved draft of this type (created under `noteId` once it has a name). */
  draftType?: string;
  draftFolderId?: string | null;
  /** For a draft: what another app shared, to fill in the new note. */
  shared?: SharedContent & { title?: string };
  chrome: NoteChrome;
}) {
  const dialog = useNoteDialog();
  const index = useFolderIndex();
  const { data: me } = useMe();
  // A draft is not on the server yet; once created, the note comes from the cache like any other.
  const note = useNote(noteId, !draftType);
  const draftDef = draftType ? getClientNoteType(draftType)?.def : undefined;
  const draft = useMemo<NoteDto | undefined>(() => {
    if (!draftDef) return undefined;
    const now = new Date().toISOString();
    const folder = draftFolderId ? index.byId.get(draftFolderId) : undefined;
    return {
      id: noteId,
      folderId: draftFolderId,
      type: draftDef.id,
      typeVersion: draftDef.version,
      title: '',
      content: draftDef.createDefault(),
      version: 0,
      pinned: false,
      icon: null,
      color: null,
      permission: folder && folder.permission !== 'owner' ? folder.permission : 'owner',
      shareCount: 0,
      ownerName: folder?.ownerName ?? me?.displayName ?? '',
      createdAt: now,
      updatedAt: now,
    };
    // Only a new draft (other id/type/folder) starts over; folder or account updates do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, draftDef, draftFolderId]);

  const data = note.data ?? draft;
  if (data) {
    // Keyed by id: the editor (and its draft) survives the draft being created on the server.
    return (
      <NoteEditor
        key={data.id}
        note={data}
        chrome={chrome}
        // Drop ?new=… so a reload opens the saved note instead of a fresh draft.
        onCreated={() => dialog.created(noteId)}
        prefill={draft && note.data === undefined && shared ? { title: shared.title ?? '', content: draftDef?.fromShared?.(shared) } : undefined}
      />
    );
  }
  if (draftType) {
    return (
      <Center mih={200}>
        <Stack align="center" gap="xs">
          <Text c="dimmed">Unknown note type "{draftType}".</Text>
          <Button variant="light" onClick={chrome.onClose}>
            Close
          </Button>
        </Stack>
      </Center>
    );
  }
  if (note.isPending) {
    return (
      <Center mih={200}>
        <Loader />
      </Center>
    );
  }
  if (note.isError) {
    const missing = note.error instanceof ApiError && note.error.status === 404;
    return (
      <Center mih={200}>
        <Stack align="center" gap="xs">
          <Title order={3}>{missing ? 'Note not found' : 'Could not load note'}</Title>
          <Text c="dimmed">{missing ? 'It may have been moved to the trash.' : note.error.message}</Text>
          <Button variant="light" onClick={chrome.onClose}>
            Close
          </Button>
        </Stack>
      </Center>
    );
  }
  return null;
}

const READ_ONLY_TEXT: Record<NonNullable<NoteDto['readOnlyReason']>, string> = {
  'unknown-type': 'This note type is not available in this version of the app, so the note is shown read-only.',
  'newer-version': 'This note was saved by a newer version of the app and is shown read-only.',
  'invalid-content': 'This note’s content could not be read, so it is shown read-only.',
};

function NoteEditor({
  note,
  chrome,
  onCreated,
  prefill,
}: {
  note: NoteDto;
  chrome: NoteChrome;
  onCreated: () => void;
  prefill?: { title: string; content?: unknown };
}) {
  const draft = useNoteDraft(note, { onCreated });
  // Shared from another app: filled in as if typed, so it saves as soon as it is complete.
  useEffect(() => {
    if (prefill) draft.edit(prefill.content === undefined ? { title: prefill.title } : prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const actions = useActions();
  const patch = usePatchNote();
  const createNote = useCreateNote();
  const dialog = useNoteDialog();
  const scheme = useComputedColorScheme('light');
  const type = getClientNoteType(note.type);
  // View-only shares open read-only, like notes the app cannot edit.
  const readOnly = Boolean(note.readOnlyReason) || !canEdit(note.permission);
  const owner = note.permission === 'owner';
  // A single note shared with me (I cannot see its folder).
  const sharedAlone = !owner && note.folderId === null;
  const refreshMeta = useRefreshMeta();
  // Notes open in view mode; Edit switches to editing. New notes start in edit mode. The editor is
  // keyed by note id, so leaving the note ends editing.
  const [editing, setEditing] = useState(draft.isNew);
  const isEditing = editing && !readOnly;
  const { onEditingChange } = chrome;
  useEffect(() => onEditingChange(isEditing), [isEditing, onEditingChange]);
  const finishEditing = () => {
    void draft.flush();
    setEditing(false);
  };

  useHotkeys([['mod+S', () => void draft.flush()]], [], true);
  // E starts editing (ignored while typing in a field).
  useHotkeys(readOnly || editing ? [] : [['E', () => setEditing(true)]]);
  // Save before private folders lock (the note may be inside one).
  useBeforeLock(draft.flush);

  // Fill an empty title from server data once available (e.g. the fetched page title of a link).
  const suggested = type?.suggestTitle?.(note.meta);
  useEffect(() => {
    if (!readOnly && suggested && draft.title.trim() === '') draft.edit({ title: suggested });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  // A new link is named after its page before it is saved: look the title up once the address is valid.
  const lookupUrl = draft.isNew && draft.title.trim() === '' ? type?.titleLookupUrl?.(draft.content) : undefined;
  const [lookingUp, setLookingUp] = useState(false);
  useEffect(() => {
    if (!lookupUrl) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLookingUp(true);
      api<{ title?: string }>('/api/links/title', 'POST', { url: lookupUrl })
        .then((r) => !cancelled && r.title && draft.suggestTitle(r.title))
        .catch(() => {}) // No title: the user names it.
        .finally(() => !cancelled && setLookingUp(false));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setLookingUp(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupUrl]);

  // Leaving loses changes that cannot be saved yet (no name, no web address): ask first.
  useBlocker({
    shouldBlockFn: () => {
      const missing = draft.unsavable();
      return missing ? !window.confirm(`This note is not saved: ${missing.toLowerCase()} first.\n\nLeave anyway and lose your changes?`) : false;
    },
    // The browser's own "leave page?" prompt already covers reloads and closing the tab.
    enableBeforeUnload: false,
  });

  const saveMineAsCopy = () => {
    const mine = draft.resolve.takeTheirsKeepMine();
    createNote.mutate(
      { type: note.type, folderId: note.folderId, title: `${mine.title || 'Untitled'} (my version)`, content: mine.content },
      {
        onSuccess: (copy) => {
          notifyOk('Your version was saved as a new note.');
          dialog.open(copy.id);
        },
        onError: notifyError,
      },
    );
  };

  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        // Large editors fill the dialog and scroll internally; others make the dialog grow.
        ...(chrome.fill && { flex: 1, minHeight: 0 }),
      }}
    >
      {/*
        Stays at the top while long notes scroll the dialog. It takes over the dialog's top
        padding (so the same space stays above it when stuck) and covers what scrolls under it.
      */}
      <Group
        justify="flex-end"
        wrap="nowrap"
        gap="xs"
        mb={4}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 3,
          marginTop: 'calc(-1 * var(--mantine-spacing-md))',
          paddingTop: 'var(--mantine-spacing-md)',
          paddingBottom: 4,
          background: 'var(--mantine-color-body)',
        }}
      >
        <Group gap={6} wrap="nowrap">
          {/* In view mode only changes in progress are worth a status (e.g. a ticked checklist item). */}
          {(isEditing || draft.status !== 'saved') && <SaveIndicator status={draft.status} missing={draft.missing} updatedAt={note.updatedAt} />}
          {!readOnly &&
            (isEditing ? (
              <Tooltip label={draft.missing ? `${draft.missing} first` : 'Back to view mode'} openDelay={400}>
                <Button size="xs" variant="light" leftSection={<IconCheck size={14} />} disabled={Boolean(draft.missing)} onClick={finishEditing}>
                  Done
                </Button>
              </Tooltip>
            ) : (
              <Tooltip label="Edit this note (E)" openDelay={400}>
                <Button size="xs" variant="default" leftSection={<IconPencil size={14} />} onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </Tooltip>
            ))}
          {/* Nothing to share, pin, move or trash before the note exists. */}
          {!draft.isNew && <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Note actions">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>
                {type?.def.label ?? note.type} · created {relativeTime(note.createdAt)}
              </Menu.Label>
              <Menu.Item
                leftSection={<IconDownload size={16} />}
                onClick={() => downloadNote({ type: note.type, title: draft.title, content: draft.content, meta: note.meta })}
              >
                Download
              </Menu.Item>
              {owner && (
                <Menu.Item
                  leftSection={<IconShare size={16} />}
                  onClick={() => actions.share({ kind: 'note', id: note.id, name: draft.title || 'Untitled' })}
                >
                  Share…
                </Menu.Item>
              )}
              {!readOnly && (
                <>
                  <Menu.Item
                    leftSection={note.pinned ? <IconPinnedOff size={16} /> : <IconPin size={16} />}
                    onClick={() => patch.mutate({ id: note.id, pinned: !note.pinned }, { onError: notifyError })}
                  >
                    {note.pinned ? 'Unpin' : 'Pin to top'}
                  </Menu.Item>
                  {!sharedAlone && (
                    <Menu.Item
                      leftSection={<IconArrowsMove size={16} />}
                      onClick={() => actions.moveNote({ id: note.id, title: draft.title, folderId: note.folderId })}
                    >
                      Move to…
                    </Menu.Item>
                  )}
                </>
              )}
              {sharedAlone && (
                <Menu.Item
                  leftSection={<IconLogout2 size={16} />}
                  onClick={() => actions.leaveShare({ kind: 'note', id: note.id, name: draft.title || 'Untitled' })}
                >
                  Remove from Shared with me
                </Menu.Item>
              )}
              {owner && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    onClick={() => {
                      void draft.flush();
                      actions.trashNote({ id: note.id, title: draft.title, folderId: note.folderId });
                    }}
                  >
                    Move to trash
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>}
          {chrome.onToggleMaximize && (
            <Tooltip label={chrome.maximized ? 'Restore size' : 'Full screen'} openDelay={400}>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={chrome.maximized ? 'Restore size' : 'Full screen'}
                onClick={chrome.onToggleMaximize}
              >
                {chrome.maximized ? <IconArrowsMinimize size={18} /> : <IconArrowsMaximize size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={isEditing ? 'Close' : 'Close (Esc)'} openDelay={400}>
            <ActionIcon variant="subtle" color="gray" aria-label="Close" onClick={chrome.onClose}>
              <IconX size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <Group gap="sm" wrap="nowrap" mb="sm">
        {/* Icon and colour can be picked once the note exists. */}
        <NoteIconPicker note={note} readOnly={!isEditing || draft.isNew} />
        <TextInput
          variant="unstyled"
          placeholder="Name"
          aria-label="Name"
          maxLength={300}
          readOnly={!isEditing}
          // The dialog focuses the element marked with data-autofocus (else its first button).
          data-autofocus={(isEditing && draft.isNew && type?.focusTitleOnCreate !== false) || undefined}
          value={draft.title}
          onChange={(e) => draft.edit({ title: e.currentTarget.value })}
          style={{ flex: 1 }}
          styles={{ input: { fontSize: 'var(--mantine-h2-font-size)', fontWeight: 700, height: 'auto', lineHeight: 1.3 } }}
        />
      </Group>

      {!readOnly && (lookingUp || (draft.missing && (draft.status === 'new' || draft.status === 'incomplete'))) && (
        <Text size="xs" mb="sm" mt={-6} c={draft.status === 'incomplete' && !lookingUp ? 'orange' : 'dimmed'}>
          {lookingUp ? 'Looking up the page title…' : `${draft.missing} to save this note.`}
        </Text>
      )}

      {(note.permission !== 'owner' || note.shareCount > 0 || note.updatedByName) && (
        <Group mb="sm" mt={-6}>
          <SharingBadge
            permission={note.permission}
            ownerName={note.ownerName}
            shareCount={note.shareCount}
            onManage={() => actions.share({ kind: 'note', id: note.id, name: draft.title || 'Untitled' })}
          />
          {note.updatedByName && (
            <Text size="xs" c="dimmed">
              Last edited by {note.updatedByName} {relativeTime(note.updatedAt)}
            </Text>
          )}
        </Group>
      )}

      {note.readOnlyReason && (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />} mb="sm">
          {READ_ONLY_TEXT[note.readOnlyReason]}
        </Alert>
      )}

      <Box style={{ display: 'flex', flexDirection: 'column', ...(chrome.fill && { flex: 1, minHeight: 0, overflow: 'auto' }) }}>
        {type && note.readOnlyReason !== 'unknown-type' && note.readOnlyReason !== 'invalid-content' ? (
          <Suspense
            fallback={
              <Center py="xl">
                <Loader size="sm" />
              </Center>
            }
          >
            <type.Editor
              noteId={note.id}
              meta={note.meta}
              refreshMeta={() => refreshMeta.mutate(note.id, { onError: notifyError })}
              value={draft.content}
              onChange={(content: unknown) => draft.edit({ content })}
              readOnly={!isEditing}
              viewMode={!readOnly && !isEditing}
              colorScheme={scheme}
            />
          </Suspense>
        ) : (
          <Code block>{JSON.stringify(note.content, null, 2)}</Code>
        )}
      </Box>

      <Modal
        opened={draft.conflict !== null}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title={
          <Group gap="xs">
            <IconAlertTriangle size={20} color="var(--mantine-color-orange-6)" />
            <Text fw={600}>This note was changed somewhere else</Text>
          </Group>
        }
      >
        <Stack>
          <Text size="sm">
            While you were editing, a newer version was saved
            {draft.conflict?.updatedByName ? ` by ${draft.conflict.updatedByName}` : ''}
            {draft.conflict && ` ${relativeTime(draft.conflict.updatedAt)}`}
            {draft.conflict?.updatedByName ? '.' : ' (in another tab or on another device).'} Your
            changes have not been saved yet. What should happen?
          </Text>
          <Stack gap="xs">
            <Button onClick={draft.resolve.overwrite}>Keep my version (overwrite the other change)</Button>
            <Button variant="light" onClick={saveMineAsCopy} loading={createNote.isPending}>
              Keep both (save mine as a new note)
            </Button>
            <Button variant="default" color="red" onClick={draft.resolve.discard}>
              Discard my changes
            </Button>
          </Stack>
        </Stack>
      </Modal>
    </Box>
  );
}

function SaveIndicator({ status, missing, updatedAt }: { status: SaveStatus; missing?: string; updatedAt: string }) {
  const map: Record<SaveStatus, { label: string; color: string; icon?: React.ReactNode }> = {
    new: { label: 'Not saved yet', color: 'dimmed' },
    incomplete: { label: `Not saved: ${(missing ?? 'incomplete').toLowerCase()}`, color: 'orange', icon: <IconAlertTriangle size={14} /> },
    saved: { label: 'Saved', color: 'dimmed', icon: <IconCheck size={14} /> },
    dirty: { label: 'Unsaved', color: 'dimmed' },
    saving: { label: 'Saving…', color: 'dimmed', icon: <IconCloudUpload size={14} /> },
    error: { label: 'Not saved, retrying', color: 'red', icon: <IconAlertTriangle size={14} /> },
    conflict: { label: 'Conflict', color: 'orange', icon: <IconAlertTriangle size={14} /> },
    gone: { label: 'Not saved: note is no longer available', color: 'red', icon: <IconAlertTriangle size={14} /> },
  };
  const s = map[status];
  return (
    <Tooltip label={`Last saved ${fullDate(updatedAt)} · Ctrl+S saves now`} openDelay={400}>
      <Group gap={4} wrap="nowrap" c={s.color} style={{ fontSize: 'var(--mantine-font-size-xs)', whiteSpace: 'nowrap' }}>
        {s.icon}
        {s.label}
      </Group>
    </Tooltip>
  );
}
