import { useState, type DragEvent, type HTMLAttributes, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Image,
  Loader,
  Menu,
  Overlay,
  Paper,
  Popover,
  Slider,
  Stack,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconArrowsMove,
  IconArrowsSort,
  IconCheck,
  IconDots,
  IconEye,
  IconFileImport,
  IconFolder,
  IconFolderShare,
  IconGridDots,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconList,
  IconLock,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconShare,
  IconSquare,
  IconTrash,
  IconUsers,
} from '@tabler/icons-react';
import {
  applyNoteOrder,
  canEdit,
  CARD_SIZE_STEPS,
  DEFAULT_FOLDER_VIEW,
  NOTE_SORTS,
  type FolderDto,
  type FolderViewDto,
  type NoteSort,
  type NoteSummaryDto,
  type NoteView,
  type Permission,
} from '@notes/shared';
import { displayTitle, getClientNoteType } from '@notes/note-types/client';
import { useMe } from '../auth';
import { useFolderIndex, useFolderView, useNotes, usePatchNote, useUpdateFolderView } from '../data';
import { useActions } from '../components/Actions';
import { FolderMenuItems } from '../components/FolderTree';
import { Masonry } from '../components/Masonry';
import { StatusBar, StatusText, countLabel } from '../components/StatusBar';
import { ActionIconLink, PlainLink } from '../components/links';
import { NewNoteMenu, NoteIcon, NoteTitleLink, NoteTypeGlyph, OpenNoteMenuItem, noteOpenUrl, useOpenNote } from '../components/notes-ui';
import { fullDate, relativeTime } from '../lib/format';
import { NOTE_DRAG_TYPE, notifyError } from '../lib/notify';

/**
 * Arrow in front of a folder's name, back to the folder it is in. At the top: Home for my folders,
 * "Shared with me" for folders other people shared with me (their parent is not mine to see).
 */
function FolderBackLink({ folder }: { folder: FolderDto }) {
  const index = useFolderIndex();
  const { data: me } = useMe();
  const parent = folder.parentId ? index.byId.get(folder.parentId) : undefined;
  const shared = folder.ownerId !== me?.id;
  const label = `Back to ${parent?.name ?? (shared ? 'Shared with me' : 'Home')}`;
  const props = { variant: 'subtle', color: 'gray', size: 'lg', 'aria-label': label } as const;
  const icon = <IconArrowLeft size={22} />;
  return (
    <Tooltip label={label}>
      {parent ? (
        <ActionIconLink to="/f/$folderId" params={{ folderId: parent.id }} {...props}>
          {icon}
        </ActionIconLink>
      ) : shared ? (
        <ActionIconLink to="/shared" {...props}>
          {icon}
        </ActionIconLink>
      ) : (
        <ActionIconLink to="/" {...props}>
          {icon}
        </ActionIconLink>
      )}
    </Tooltip>
  );
}

/**
 * Minimum card width in px per card size step (CARD_SIZE_STEPS of them), smallest first; the same
 * for cards and compact cards so both views line up. Rows hold as many cards as fit, and the cards
 * stretch to fill the row.
 */
const CARD_WIDTHS = [200, 240, 280, 330, 400] as const;

function CardGrid({ minWidth, children }: { minWidth: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        // min(…, 100%): a single card never overflows a narrow screen.
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${minWidth}px, 100%), 1fr))`,
        gap: 'var(--mantine-spacing-sm)',
      }}
    >
      {children}
    </div>
  );
}

const VIEWS = [
  { value: 'grid', label: 'Grid view', Icon: IconLayoutGrid },
  { value: 'masonry', label: 'Masonry view', Icon: IconLayoutDashboard },
  { value: 'compact', label: 'Compact view', Icon: IconGridDots },
  { value: 'list', label: 'List view', Icon: IconList },
] as const satisfies readonly { value: NoteView; label: string; Icon: unknown }[];

const SORT_LABEL: Record<NoteSort, string> = {
  updated: 'Last edited',
  created: 'Date created',
  title: 'Title',
  manual: 'Custom order',
};

/** Status bar item showing the sort; opens the list of sorts above it. */
function SortControl({ value, onChange }: { value: NoteSort; onChange: (sort: NoteSort) => void }) {
  return (
    <Menu position="top-end" width={180}>
      <Menu.Target>
        <UnstyledButton className="status-item" aria-label={`Sort: ${SORT_LABEL[value]}`}>
          <IconArrowsSort size={14} />
          {SORT_LABEL[value]}
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Sort notes</Menu.Label>
        {NOTE_SORTS.map((s) => (
          <Menu.Item key={s} onClick={() => onChange(s)} rightSection={s === value ? <IconCheck size={14} /> : null}>
            {SORT_LABEL[s]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Status bar item with a stepped slider for the card size (smaller cards = more per row). */
function CardSizeControl({ value, onChange }: { value: number; onChange: (size: number) => void }) {
  return (
    <Popover position="top-end" width={220} shadow="md" radius="md">
      <Popover.Target>
        <Tooltip label="Card size">
          <UnstyledButton className="status-item" aria-label="Card size">
            <IconAdjustmentsHorizontal size={14} />
          </UnstyledButton>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="xs">
          Card size
        </Text>
        <Group gap="xs" wrap="nowrap">
          <IconGridDots size={14} color="var(--mantine-color-dimmed)" aria-hidden />
          <Slider
            style={{ flex: 1 }}
            min={0}
            max={CARD_SIZE_STEPS - 1}
            step={1}
            value={value}
            onChange={onChange}
            marks={Array.from({ length: CARD_SIZE_STEPS }, (_, i) => ({ value: i }))}
            label={null}
            aria-label="Card size"
          />
          <IconSquare size={14} color="var(--mantine-color-dimmed)" aria-hidden />
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

const PERMISSION_LABEL: Record<Exclude<Permission, 'owner'>, string> = { edit: 'Can edit', view: 'View only' };

/** "Shared by Alice · View only" for things shared with me; "Shared with 2" (opens dialog) for my shared things. */
export function SharingBadge({
  permission,
  ownerName,
  shareCount,
  onManage,
}: {
  permission: Permission;
  ownerName: string;
  shareCount: number;
  onManage: () => void;
}) {
  if (permission !== 'owner') {
    return (
      <Badge
        variant="light"
        color={permission === 'edit' ? 'teal' : 'gray'}
        leftSection={permission === 'edit' ? <IconPencil size={12} /> : <IconEye size={12} />}
        style={{ textTransform: 'none' }}
      >
        Shared by {ownerName} · {PERMISSION_LABEL[permission]}
      </Badge>
    );
  }
  if (shareCount === 0) return null;
  return (
    <Tooltip label="Manage sharing">
      <Badge
        component="button"
        variant="light"
        leftSection={<IconUsers size={12} />}
        style={{ textTransform: 'none', cursor: 'pointer', border: 0 }}
        onClick={onManage}
      >
        Shared with {shareCount}
      </Badge>
    </Tooltip>
  );
}

export function FolderPage({ folderId }: { folderId: string | null }) {
  const index = useFolderIndex();
  const actions = useActions();
  const { data: me } = useMe();
  // Sort, custom order, layout and card size are saved per folder and per user (people I share with keep their own).
  const folderView = useFolderView(folderId);
  const updateFolderView = useUpdateFolderView();
  const { sort, view, cardSize, noteOrder } = { ...DEFAULT_FOLDER_VIEW, ...folderView.data };
  const setFolderView = (patch: Partial<FolderViewDto>) => updateFolderView.mutate({ folderId, ...patch }, { onError: notifyError });
  // Wait for the saved sort order, so the list is not loaded twice.
  const notesQuery = useNotes(folderId, sort, !folderView.isPending);
  // Manual order: applied here too, so a drag shows at once (the server list follows on the next load).
  const manual = sort === 'manual';
  const list = notesQuery.data && manual ? applyNoteOrder(notesQuery.data, noteOrder) : notesQuery.data;
  const notes = { isPending: notesQuery.isPending, data: list };
  const sorting = useNoteSorting(list ?? [], manual, view === 'list' ? 'y' : 'x', (ids) => setFolderView({ noteOrder: ids }));
  const changeSort = (next: NoteSort) =>
    // The first time: start the manual order from what is on screen now.
    setFolderView(next === 'manual' && noteOrder.length === 0 && list?.length ? { sort: next, noteOrder: list.map((n) => n.id) } : { sort: next });
  const folder = folderId ? index.byId.get(folderId) : undefined;
  const editable = !folder || canEdit(folder.permission);
  // Files dragged in from the computer are imported into this folder.
  const [fileDrag, setFileDrag] = useState(false);
  const isFileDrag = (e: DragEvent) => editable && e.dataTransfer.types.includes('Files');

  if (folderId && !index.isPending && !folder) {
    return (
      <Center mih="50vh">
        <Stack align="center" gap="xs">
          <Title order={3}>Folder not found</Title>
          <Text c="dimmed">It may have been moved to the trash or is no longer shared with you.</Text>
          <Button component={Link} to="/" variant="light">
            Go to Home
          </Button>
        </Stack>
      </Center>
    );
  }

  // Subfolders are listed in the sidebar only, so "empty" is about notes.
  const empty = notes.data?.length === 0;

  return (
    <Stack
      gap="md"
      pos="relative"
      mih="60vh"
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setFileDrag(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDrag(false);
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setFileDrag(false);
        if (e.dataTransfer.files.length) actions.importInto(folderId, [...e.dataTransfer.files]);
      }}
    >
      {fileDrag && (
        <Overlay color="var(--mantine-color-body)" backgroundOpacity={0.85} radius="md" zIndex={50} style={{ pointerEvents: 'none' }}>
          <Center h="100%" style={{ border: '2px dashed var(--mantine-primary-color-filled)', borderRadius: 'var(--mantine-radius-md)' }}>
            <Stack align="center" gap="xs">
              <IconFileImport size={40} stroke={1.5} color="var(--mantine-primary-color-filled)" />
              <Text fw={500}>Drop to import into "{folder?.name ?? 'Home'}"</Text>
            </Stack>
          </Center>
        </Overlay>
      )}
      <div style={{ minWidth: 0 }}>
        {/* Folder name (with a way back up) on the left, folder buttons on the right of the same line. */}
        <Group justify="space-between" wrap="wrap" gap="sm">
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            {folder && <FolderBackLink folder={folder} />}
            {folder && index.path(folder.id).some((f) => f.isPrivate) && (
              <Tooltip label="Private: hidden while private folders are locked">
                <IconLock size={22} color="var(--mantine-color-orange-6)" aria-label="Private" />
              </Tooltip>
            )}
            <Title order={2} style={{ overflowWrap: 'anywhere' }}>
              {folder?.name ?? 'Home'}
            </Title>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {/* Sharing is in this menu too, so there is no separate Share button. */}
            <Menu position="bottom-end">
              <Menu.Target>
                {/* Same height and style as the buttons next to it. */}
                <ActionIcon variant="default" size={36} aria-label="Folder actions">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {/* Folders are created in the sidebar only. */}
                <FolderMenuItems
                  folder={folder ?? null}
                  isSharedRoot={Boolean(folder && folder.ownerId !== me?.id && !folder.parentId)}
                  newFolder={false}
                />
              </Menu.Dropdown>
            </Menu>
            {editable && <NewNoteMenu folderId={folderId} />}
          </Group>
        </Group>
        {folder && (
          <Group mt={4}>
            <SharingBadge
              permission={folder.permission}
              ownerName={folder.ownerName}
              shareCount={folder.shareCount}
              onManage={() => actions.share({ kind: 'folder', id: folder.id, name: folder.name })}
            />
          </Group>
        )}
      </div>

      {/* Count, sort, card size and layout live in the status bar at the bottom, to leave the page to the notes. */}
      {notes.data && (
        <StatusBar>
          <StatusText>{countLabel(notes.data.length, 'item')}</StatusText>
          <Group gap={2} wrap="nowrap">
            <SortControl value={sort} onChange={changeSort} />
            {view !== 'list' && <CardSizeControl value={cardSize} onChange={(size) => setFolderView({ cardSize: size })} />}
            {VIEWS.map(({ value, label, Icon }) => (
              <Tooltip key={value} label={label}>
                <UnstyledButton
                  className="status-item"
                  data-active={view === value || undefined}
                  aria-label={label}
                  aria-pressed={view === value}
                  onClick={() => setFolderView({ view: value })}
                >
                  <Icon size={14} />
                </UnstyledButton>
              </Tooltip>
            ))}
          </Group>
        </StatusBar>
      )}

      {notes.isPending ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : empty ? (
        <Paper withBorder radius="md" p="xl" ta="center" style={{ borderStyle: 'dashed' }}>
          <Stack align="center" gap="sm">
            <Text fw={500}>{folder ? 'This folder is empty' : 'Nothing here yet'}</Text>
            {editable && (
              <>
                <Text size="sm" c="dimmed" maw={440}>
                  Create a note of any type: markdown, link, checklist, mind map, plain text or code. Notes of different
                  types can live together in the same folder. You can also drop files here to import them.
                </Text>
                <Group gap="xs">
                  <Button variant="default" leftSection={<IconFileImport size={16} />} onClick={() => actions.importInto(folderId)}>
                    Import…
                  </Button>
                  <NewNoteMenu folderId={folderId} />
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      ) : (
        <div {...sorting.container}>
          {view === 'grid' ? (
            <CardGrid minWidth={CARD_WIDTHS[cardSize]!}>
              {notes.data?.map((n) => (
                <NoteSlot key={n.id} {...sorting.item(n)}>
                  <NoteCard note={n} />
                </NoteSlot>
              ))}
            </CardGrid>
          ) : view === 'masonry' ? (
            <Masonry
              minWidth={CARD_WIDTHS[cardSize]!}
              items={(notes.data ?? []).map((n) => ({
                key: n.id,
                node: (
                  <NoteSlot {...sorting.item(n)}>
                    <NoteCard note={n} masonry />
                  </NoteSlot>
                ),
              }))}
            />
          ) : view === 'compact' ? (
            <CardGrid minWidth={CARD_WIDTHS[cardSize]!}>
              {notes.data?.map((n) => (
                <NoteSlot key={n.id} {...sorting.item(n)}>
                  <CompactNoteCard note={n} />
                </NoteSlot>
              ))}
            </CardGrid>
          ) : (
            <Paper withBorder radius="md">
              {notes.data?.map((n, i) => (
                <NoteSlot key={n.id} {...sorting.item(n)}>
                  <NoteRow note={n} first={i === 0} />
                </NoteSlot>
              ))}
            </Paper>
          )}
        </div>
      )}
    </Stack>
  );
}

export function FolderTile({ folder, subtitle }: { folder: FolderDto; subtitle?: string }) {
  const Icon = folder.isPrivate ? IconLock : folder.shareCount ? IconFolderShare : IconFolder;
  return (
    <PlainLink to="/f/$folderId" params={{ folderId: folder.id }}>
      <Paper withBorder radius="md" px="sm" py="xs">
        <Group gap="xs" wrap="nowrap">
          <Icon
            size={20}
            stroke={1.6}
            color={folder.isPrivate ? 'var(--mantine-color-orange-6)' : 'var(--mantine-color-yellow-6)'}
            style={{ flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Text size="sm" fw={500} truncate>
              {folder.name}
            </Text>
            {subtitle && (
              <Text size="xs" c="dimmed" truncate>
                {subtitle}
              </Text>
            )}
          </div>
          {folder.noteCount > 0 && (
            <Text size="xs" c="dimmed">
              {folder.noteCount}
            </Text>
          )}
        </Group>
      </Paper>
    </PlainLink>
  );
}

type DropSide = 'before' | 'after';
type SlotProps = HTMLAttributes<HTMLDivElement> & {
  draggable?: boolean;
  'data-axis'?: 'x' | 'y';
  'data-drop'?: DropSide;
  'data-dragging'?: boolean;
};
/** Marks our own drags (Firefox only starts a drag that carries some data). */
const SORT_DRAG_TYPE = 'application/x-notes-sort';

/**
 * Dragging notes. Notes I can edit can always be dragged onto a folder in the sidebar to move them.
 * With the custom order (`enabled`), every note can also be dragged within the page to reorder my
 * view: a line shows where it will go (left/right of a card, `axis` 'x'; above/below a row, 'y').
 * Pinned notes stay above the others, so a note is moved within its own group.
 */
function useNoteSorting(notes: NoteSummaryDto[], enabled: boolean, axis: 'x' | 'y', onReorder: (ids: string[]) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: DropSide } | null>(null);
  const dragged = enabled && dragId ? notes.find((n) => n.id === dragId) : undefined;
  const reset = () => {
    setDragId(null);
    setDrop(null);
  };

  // On the whole list, so letting go in the gap between cards still drops where the line is.
  const container: HTMLAttributes<HTMLDivElement> = {
    onDragOver: (e) => {
      if (!dragged || !drop) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
    },
    onDrop: (e) => {
      if (!dragged || !drop) return;
      e.preventDefault();
      const rest = notes.filter((n) => n.id !== dragged.id);
      const at = rest.findIndex((n) => n.id === drop.id) + (drop.side === 'after' ? 1 : 0);
      const ids = [...rest.slice(0, at), dragged, ...rest.slice(at)].map((n) => n.id);
      if (ids.some((id, i) => id !== notes[i]!.id)) onReorder(ids);
      reset();
    },
  };

  const item = (note: NoteSummaryDto): SlotProps => {
    const movable = canEdit(note.permission);
    if (!enabled && !movable) return {};
    return {
      draggable: true,
      onDragStart: (e) => {
        e.dataTransfer.setData(SORT_DRAG_TYPE, note.id);
        if (movable) e.dataTransfer.setData(NOTE_DRAG_TYPE, note.id);
        e.dataTransfer.effectAllowed = 'move';
        // After the browser has taken its picture of the card, so the picture is not dimmed.
        if (enabled) setTimeout(() => setDragId(note.id));
      },
      onDragEnd: reset,
      ...(enabled && {
        'data-axis': axis,
        'data-drop': drop?.id === note.id ? drop.side : undefined,
        'data-dragging': dragId === note.id || undefined,
        onDragOver: (e) => {
          if (!dragged || dragged.id === note.id || dragged.pinned !== note.pinned) {
            if (dragged) setDrop(null);
            return;
          }
          const r = e.currentTarget.getBoundingClientRect();
          const first = axis === 'x' ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
          const side = first ? 'before' : 'after';
          if (drop?.id !== note.id || drop.side !== side) setDrop({ id: note.id, side });
        },
      }),
    };
  };

  return { container, item };
}

/** Holds one note (card or row) in the list; the drop line of a custom-order drag is drawn on it. */
function NoteSlot({ children, ...props }: SlotProps & { children: ReactNode }) {
  return (
    <div className="note-slot" {...props}>
      {children}
    </div>
  );
}

function NoteMenu({ note }: { note: NoteSummaryDto }) {
  const actions = useActions();
  const patch = usePatchNote();
  const editable = canEdit(note.permission);
  const owner = note.permission === 'owner';
  if (!editable && !noteOpenUrl(note)) return null;
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="md" aria-label="Note actions" onClick={(e) => e.stopPropagation()}>
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <OpenNoteMenuItem note={note} />
        {owner && (
          <Menu.Item
            leftSection={<IconShare size={16} />}
            onClick={() => actions.share({ kind: 'note', id: note.id, name: displayTitle(note) })}
          >
            Share…
          </Menu.Item>
        )}
        {editable && (
          <>
            <Menu.Item
              leftSection={note.pinned ? <IconPinnedOff size={16} /> : <IconPin size={16} />}
              onClick={() => patch.mutate({ id: note.id, pinned: !note.pinned }, { onError: notifyError })}
            >
              {note.pinned ? 'Unpin' : 'Pin to top'}
            </Menu.Item>
            <Menu.Item leftSection={<IconArrowsMove size={16} />} onClick={() => actions.moveNote(note)}>
              Move to…
            </Menu.Item>
          </>
        )}
        {owner && (
          <>
            <Menu.Divider />
            <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => actions.trashNote(note)}>
              Move to trash
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

const editedLine = (note: NoteSummaryDto) =>
  `Edited ${relativeTime(note.updatedAt)}${note.updatedByName ? ` by ${note.updatedByName}` : ''}`;

function NoteFlags({ note }: { note: NoteSummaryDto }) {
  return (
    <>
      {note.shareCount > 0 && (
        <Tooltip label={`Shared with ${note.shareCount}`}>
          <IconUsers size={14} color="var(--mantine-color-dimmed)" aria-label="Shared" />
        </Tooltip>
      )}
      {note.permission === 'view' && (
        <Tooltip label="View only">
          <IconEye size={14} color="var(--mantine-color-dimmed)" aria-label="View only" />
        </Tooltip>
      )}
      {note.pinned && <IconPin size={14} color="var(--mantine-color-dimmed)" aria-label="Pinned" />}
    </>
  );
}

/**
 * A note as a card. Grid cards in a row share one height (short previews); masonry cards take the
 * height their content needs (longer text, the preview image at its own shape).
 */
function NoteCard({ note, masonry = false }: { note: NoteSummaryDto; masonry?: boolean }) {
  const openNote = useOpenNote();
  const open = () => openNote(note);
  const type = getClientNoteType(note.type);
  const image = type?.cardImage?.(note.meta);
  const Body = type?.CardBody;
  return (
    <Card withBorder radius="md" padding="sm" className="note-card" style={{ cursor: 'pointer' }} onClick={open}>
      <Group gap="xs" wrap="nowrap" align="center">
        <NoteIcon note={note} size={26} />
        <NoteTitleLink
          note={note}
          c="var(--mantine-color-text)"
          underline="never"
          fw={600}
          size="sm"
          truncate="end"
          title={displayTitle(note)}
          display="block"
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={(e) => e.stopPropagation()}
        >
          {displayTitle(note)}
        </NoteTitleLink>
        <NoteFlags note={note} />
        <NoteMenu note={note} />
      </Group>
      {/* Title row always comes first; the preview image sits full-width below it, at the same 6px gap as other card bodies. */}
      {image && (
        <Card.Section mt={6} mb={4}>
          {masonry ? (
            <Image src={image} alt="" mah={360} fit="cover" draggable={false} />
          ) : (
            <Image src={image} alt="" h={140} fit="cover" draggable={false} />
          )}
        </Card.Section>
      )}
      {Body ? (
        <Body title={note.title} excerpt={note.excerpt} meta={note.meta} expanded={masonry} />
      ) : (
        <Text
          size="xs"
          c="dimmed"
          lineClamp={masonry ? 10 : 3}
          mt={6}
          mih={18}
          ff={note.type === 'code' ? 'monospace' : undefined}
          style={{ overflowWrap: 'anywhere' }}
        >
          {note.excerpt || ' '}
        </Text>
      )}
      {/* Grid cards in a row share one height; the footer (type left, edit line right) sits at the bottom of each. */}
      <Group justify="space-between" wrap="nowrap" gap="xs" mt="auto" pt={8}>
        <NoteTypeGlyph type={note.type} />
        <Tooltip label={fullDate(note.updatedAt)} openDelay={400}>
          <Text size="xs" c="dimmed" ta="right" truncate="end">
            {editedLine(note)}
          </Text>
        </Tooltip>
      </Group>
    </Card>
  );
}

/** Compact view: a small card with the note's icon, its name on one line and the "…" menu. */
function CompactNoteCard({ note }: { note: NoteSummaryDto }) {
  const openNote = useOpenNote();
  const title = displayTitle(note);
  return (
    // A Card (not a Paper) so it has the same background as the other card views.
    <Card
      withBorder
      radius="md"
      padding="xs"
      px="sm"
      className="note-card"
      style={{ cursor: 'pointer' }}
      onClick={() => openNote(note)}
     
    >
      <Group gap="xs" wrap="nowrap">
        <NoteIcon note={note} size={26} />
        <NoteTitleLink
          note={note}
          c="var(--mantine-color-text)"
          underline="never"
          fw={500}
          size="sm"
          truncate="end"
          display="block"
          title={title}
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={(e) => e.stopPropagation()}
        >
          {title}
        </NoteTitleLink>
        {/* Same "…" menu as the other views (link notes: "Open note", since a click opens the page). */}
        <NoteMenu note={note} />
      </Group>
    </Card>
  );
}

function NoteRow({ note, first }: { note: NoteSummaryDto; first: boolean }) {
  const openNote = useOpenNote();
  return (
    <Group
      gap="sm"
      wrap="nowrap"
      px="sm"
      py={8}
      style={{ cursor: 'pointer', borderTop: first ? undefined : '1px solid var(--mantine-color-default-border)' }}
      onClick={() => openNote(note)}
     
    >
      <NoteIcon note={note} size={24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <NoteTitleLink
          note={note}
          c="var(--mantine-color-text)"
          fw={500}
          size="sm"
          truncate="end"
          display="block"
          onClick={(e) => e.stopPropagation()}
        >
          {displayTitle(note)}
        </NoteTitleLink>
        {note.excerpt && (
          <Text size="xs" c="dimmed" truncate="end">
            {note.excerpt}
          </Text>
        )}
      </div>
      <NoteFlags note={note} />
      <Group gap={6} wrap="nowrap" visibleFrom="xs">
        <NoteTypeGlyph type={note.type} />
        <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          {editedLine(note)}
        </Text>
      </Group>
      <NoteMenu note={note} />
    </Group>
  );
}
