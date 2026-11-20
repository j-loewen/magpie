import { useEffect, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { Anchor, Button, Group, Menu, Modal, Select, Stack, Text, TextInput, ThemeIcon, Tooltip, type AnchorProps } from '@mantine/core';
import { IconChevronDown, IconFileText, IconFileUnknown, IconPlus } from '@tabler/icons-react';
import { clientNoteTypes, getClientNoteType } from '@notes/note-types/client';
import { canEdit } from '@notes/shared';
import { useMe } from '../auth';
import { useFolderIndex } from '../data';
import { useNoteDialog, withoutNote } from '../lib/note-dialog';
import { getNoteIcon, readableOn } from '../lib/note-icons';
import { AnchorLink } from './links';

export function NoteTypeIcon({ type, size = 28 }: { type: string; size?: number }) {
  const t = getClientNoteType(type);
  const Icon = t?.icon ?? IconFileUnknown;
  return (
    <ThemeIcon variant="light" color={t?.color ?? 'gray'} size={size} radius="md" aria-label={t?.def.label ?? type}>
      <Icon size={Math.round(size * 0.6)} stroke={1.7} />
    </ThemeIcon>
  );
}

export interface NoteIconSource {
  type: string;
  icon?: string | null;
  color?: string | null;
  meta?: unknown;
}

/**
 * A note's own icon: the icon and colour the user picked, else the type's default image (the
 * favicon of links), else the type icon. Glyphs are drawn black or white, whichever reads better
 * on the chosen colour.
 */
export function NoteIcon({ note, size = 28 }: { note: NoteIconSource; size?: number }) {
  const t = getClientNoteType(note.type);
  const chosen = getNoteIcon(note.icon);
  const image = chosen ? undefined : t?.defaultIconImage?.(note.meta);
  // Favicons that fail to load fall back to the type icon.
  const [broken, setBroken] = useState<string>();
  const showImage = image !== undefined && image !== broken;
  const Glyph = chosen?.Icon ?? t?.icon ?? IconFileUnknown;
  const label = t?.def.label ?? note.type;
  const content = showImage ? (
    <img
      src={image}
      alt=""
      width={Math.round(size * 0.62)}
      height={Math.round(size * 0.62)}
      style={{ objectFit: 'contain' }}
      draggable={false}
      onError={() => setBroken(image)}
    />
  ) : (
    <Glyph size={Math.round(size * 0.6)} stroke={1.7} />
  );
  if (note.color) {
    return (
      <ThemeIcon variant="filled" color={note.color} size={size} radius="md" aria-label={label} style={{ color: readableOn(note.color) }}>
        {content}
      </ThemeIcon>
    );
  }
  return (
    <ThemeIcon variant={showImage ? 'default' : 'light'} color={t?.color ?? 'gray'} size={size} radius="md" aria-label={label}>
      {content}
    </ThemeIcon>
  );
}

/** Small type icon without background, e.g. in the footer of note cards. */
export function NoteTypeGlyph({ type, size = 14 }: { type: string; size?: number }) {
  const t = getClientNoteType(type);
  const Icon = t?.icon ?? IconFileUnknown;
  const label = t?.def.label ?? type;
  return (
    <Tooltip label={label} openDelay={400}>
      <Icon
        size={size}
        stroke={1.8}
        color={`var(--mantine-color-${t?.color ?? 'gray'}-text)`}
        aria-label={label}
        style={{ flexShrink: 0 }}
      />
    </Tooltip>
  );
}

/** "New note ▾" button listing every registered note type. */
export function NewNoteMenu({ folderId, compact }: { folderId: string | null; compact?: boolean }) {
  const dialog = useNoteDialog();
  // Opens an unsaved draft; it is created on the server once it has a name (see useNoteDraft).
  const make = (type: string) => dialog.openNew(type, folderId);
  return (
    <Menu position="bottom-end" width={240}>
      <Menu.Target>
        <Button
          size={compact ? 'xs' : 'sm'}
          leftSection={<IconPlus size={16} />}
          rightSection={<IconChevronDown size={14} />}
          aria-label="New note"
        >
          New
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {clientNoteTypes.map((t) => (
          <Menu.Item key={t.def.id} leftSection={<NoteTypeIcon type={t.def.id} size={26} />} onClick={() => make(t.def.id)}>
            <Text size="sm" fw={500}>
              {t.def.label}
            </Text>
            <Text size="xs" c="dimmed">
              {t.def.description}
            </Text>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Single text field dialog (new folder, rename). */
export function NameModal({
  opened,
  title,
  label = 'Name',
  initial = '',
  submitLabel = 'Save',
  loading,
  onClose,
  onSubmit,
}: {
  opened: boolean;
  title: string;
  label?: string;
  initial?: string;
  submitLabel?: string;
  loading?: boolean;
  onClose: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (opened) setValue(initial);
  }, [opened, initial]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };
  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <form onSubmit={submit}>
        <Stack>
          <TextInput label={label} required maxLength={120} data-autofocus value={value} onChange={(e) => setValue(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading} disabled={!value.trim()}>
              {submitLabel}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

const ROOT = '__root__';

/** Folder picker for "Move to…". When moving a folder, pass it as `excludeFolderId` (it and its subfolders are hidden). */
export function MoveModal({
  opened,
  title,
  currentFolderId,
  excludeFolderId,
  ownerId,
  loading,
  onClose,
  onMove,
}: {
  opened: boolean;
  title: string;
  currentFolderId: string | null;
  excludeFolderId?: string;
  /** Owner of the item being moved: it can only go into that owner's folders that I may edit. */
  ownerId: string;
  loading?: boolean;
  onClose: () => void;
  onMove: (folderId: string | null) => void;
}) {
  const index = useFolderIndex();
  const { data: me } = useMe();
  const [target, setTarget] = useState<string>(currentFolderId ?? ROOT);
  useEffect(() => {
    if (opened) setTarget(currentFolderId ?? ROOT);
  }, [opened, currentFolderId]);

  const options = [
    ...(ownerId === me?.id ? [{ value: ROOT, label: 'Home (top level)' }] : []),
    ...[...index.byId.values()]
      .filter((f) => f.ownerId === ownerId && canEdit(f.permission))
      .filter((f) => !excludeFolderId || !index.isWithin(f.id, excludeFolderId))
      .map((f) => ({ value: f.id, label: index.path(f.id).map((p) => p.name).join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];

  return (
    <Modal opened={opened} onClose={onClose} title={title}>
      <Stack>
        <Select
          label="Destination"
          data={options}
          value={target}
          onChange={(v) => setTarget(v ?? ROOT)}
          searchable
          allowDeselect={false}
          maxDropdownHeight={300}
          comboboxProps={{ withinPortal: false }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={loading}
            disabled={(target === ROOT ? null : target) === currentFolderId}
            onClick={() => onMove(target === ROOT ? null : target)}
          >
            Move
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ---- Opening notes from lists -------------------------------------------------------------------

type NoteTarget = { id: string; type: string; meta?: unknown };

/** Where a click on the note in a list goes instead of the note (link notes: their web page). */
export const noteOpenUrl = (note: NoteTarget) => getClientNoteType(note.type)?.openUrl?.(note.meta);

/** Opens a note from a list: link notes open their web page in a new tab, others the note dialog. */
export function useOpenNote() {
  const dialog = useNoteDialog();
  return (note: NoteTarget) => {
    const url = noteOpenUrl(note);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else dialog.open(note.id);
  };
}

type TitleLinkProps = AnchorProps & {
  note: NoteTarget;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
};

/** The note's name as a link with the same target as useOpenNote (so middle-click etc. work). */
export function NoteTitleLink({ note, ...props }: TitleLinkProps) {
  const url = noteOpenUrl(note);
  return url ? (
    <Anchor href={url} target="_blank" rel="noopener noreferrer" {...props} />
  ) : (
    // The current page with the note open in the dialog over it.
    <AnchorLink
      to="."
      search={((prev: object) => ({ ...withoutNote(prev), note: note.id })) as never}
      state={{ noteDialog: true }}
      {...props}
    />
  );
}

/** "Open note" for notes whose list click goes elsewhere (link notes); nothing for other notes. */
export function OpenNoteMenuItem({ note }: { note: NoteTarget }) {
  const dialog = useNoteDialog();
  if (!noteOpenUrl(note)) return null;
  return (
    <Menu.Item leftSection={<IconFileText size={16} />} onClick={() => dialog.open(note.id)}>
      Open note
    </Menu.Item>
  );
}
