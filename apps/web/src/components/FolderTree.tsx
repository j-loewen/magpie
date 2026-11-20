import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ActionIcon, Menu, Tree, useTree, type TreeNodeData } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  IconArrowsMove,
  IconChevronRight,
  IconDots,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFileExport,
  IconFileImport,
  IconFolderShare,
  IconHome,
  IconLock,
  IconLockOpen,
  IconLogout2,
  IconPencil,
  IconShare,
  IconTrash,
  IconUsersGroup,
} from '@tabler/icons-react';
import { canEdit, type FolderDto } from '@notes/shared';
import { useMe } from '../auth';
import { useFolderIndex, type FolderIndex } from '../data';
import { NOTE_DRAG_TYPE } from '../lib/notify';
import { useActions } from './Actions';
import classes from './FolderTree.module.css';

const ROOT = '__root__';
const SHARED = '__shared__';
const isNoteDrag = (e: DragEvent) => e.dataTransfer.types.includes(NOTE_DRAG_TYPE);

function toNodes(index: FolderIndex, folders: FolderDto[]): TreeNodeData[] {
  return folders.map((f) => ({ value: f.id, label: f.name, children: toNodes(index, index.children(f.id)) }));
}

export function FolderTree({ onNavigate }: { onNavigate?: () => void }) {
  const index = useFolderIndex();
  const actions = useActions();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeId =
    pathname === '/' ? ROOT : pathname === '/shared' ? SHARED : (pathname.match(/^\/f\/([^/]+)/)?.[1] ?? null);
  const [noteDropTarget, setNoteDropTarget] = useState<string | null>(null);

  const [expanded, setExpanded] = useLocalStorage<Record<string, boolean>>({
    key: 'notes.tree.expanded',
    defaultValue: { [ROOT]: true, [SHARED]: true },
    getInitialValueInEffect: false,
  });
  const tree = useTree({
    initialExpandedState: { [SHARED]: true, ...expanded, [ROOT]: true },
    onExpandedStateChange: setExpanded,
  });

  // Top level: my folders under "Home", other people's shared folders under "Shared with me".
  const data = useMemo<TreeNodeData[]>(() => {
    const roots = index.children(null);
    const mine = roots.filter((f) => f.ownerId === me?.id);
    const shared = roots.filter((f) => f.ownerId !== me?.id);
    return [
      { value: ROOT, label: 'Home', children: toNodes(index, mine) },
      ...(shared.length ? [{ value: SHARED, label: 'Shared with me', children: toNodes(index, shared) }] : []),
    ];
  }, [index, me?.id]);

  // "Shared with me" only exists once something is shared; open it the first time it shows up.
  const hasShared = data.length > 1;
  const sharedOpened = useRef(false);
  useEffect(() => {
    if (hasShared && !sharedOpened.current) {
      sharedOpened.current = true;
      tree.expand(SHARED);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShared]);

  // Reveal the folder being viewed.
  useEffect(() => {
    if (activeId && activeId !== ROOT && activeId !== SHARED) for (const f of index.path(activeId).slice(0, -1)) tree.expand(f.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, index]);

  const open = (value: string) => {
    onNavigate?.();
    if (value === ROOT) void navigate({ to: '/' });
    else if (value === SHARED) void navigate({ to: '/shared' });
    else void navigate({ to: '/f/$folderId', params: { folderId: value } });
  };

  /** Where a dragged folder may go: a folder of the same owner that I can edit, or my top level for my own folders. */
  const canDropFolder = (dragged: FolderDto, targetValue: string) => {
    if (targetValue === SHARED) return false;
    if (targetValue === ROOT) return dragged.ownerId === me?.id && dragged.permission === 'owner';
    const target = index.byId.get(targetValue);
    return Boolean(target && target.ownerId === dragged.ownerId && canEdit(target.permission) && !index.isWithin(target.id, dragged.id));
  };

  return (
    <Tree
      data={data}
      tree={tree}
      levelOffset={14}
      expandOnClick={false}
      expandOnSpace={false}
      allowDrop={({ draggedNode, targetNode, position }) => {
        const dragged = index.byId.get(draggedNode);
        if (!dragged || !canEdit(dragged.permission)) return false;
        // Folders are sorted by name, so before/after just means "same parent as the target".
        const parent = position === 'inside' ? targetNode : (index.byId.get(targetNode)?.parentId ?? (dragged.ownerId === me?.id ? ROOT : SHARED));
        return canDropFolder(dragged, parent);
      }}
      onDragDrop={({ draggedNode, targetNode, position }) => {
        const folder = index.byId.get(draggedNode);
        if (!folder) return;
        const target = position === 'inside' ? targetNode : (index.byId.get(targetNode)?.parentId ?? ROOT);
        const parentId = target === ROOT ? null : target;
        if (parentId !== folder.parentId) actions.moveFolderTo(folder, parentId);
      }}
      renderNode={({ node, expanded: isOpen, hasChildren, elementProps }) => {
        const folder = index.byId.get(node.value);
        const Icon =
          node.value === ROOT
            ? IconHome
            : node.value === SHARED
              ? IconUsersGroup
              : folder?.isPrivate
                ? IconLock
                : folder?.shareCount
                  ? IconFolderShare
                  : isOpen && hasChildren
                    ? IconFolderOpen
                    : IconFolder;
        const droppable = node.value !== SHARED && (!folder || canEdit(folder.permission));
        const cls = [
          elementProps.className,
          classes.node,
          activeId === node.value && classes.active,
          noteDropTarget === node.value && classes.dropTarget,
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <div
            {...elementProps}
            draggable={Boolean(folder && canEdit(folder.permission)) && elementProps.draggable}
            className={cls}
            onClick={(e) => {
              elementProps.onClick(e);
              open(node.value);
            }}
            // Notes dragged from the note list can be dropped onto folders I can edit.
            onDragOver={(e) => {
              if (!isNoteDrag(e)) return elementProps.onDragOver?.(e);
              if (!droppable) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setNoteDropTarget(node.value);
            }}
            onDragLeave={(e) => {
              if (!isNoteDrag(e)) return elementProps.onDragLeave?.(e);
              setNoteDropTarget(null);
            }}
            onDrop={(e) => {
              if (!isNoteDrag(e)) return elementProps.onDrop?.(e);
              e.preventDefault();
              setNoteDropTarget(null);
              actions.moveNoteTo(e.dataTransfer.getData(NOTE_DRAG_TYPE), node.value === ROOT ? null : node.value);
            }}
          >
            <ActionIcon
              variant="transparent"
              color="gray"
              size="sm"
              aria-label={isOpen ? 'Collapse' : 'Expand'}
              style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation();
                tree.toggleExpanded(node.value);
              }}
            >
              <IconChevronRight size={14} className={`${classes.chevron} ${isOpen ? classes.chevronOpen : ''}`} />
            </ActionIcon>
            <Icon size={17} stroke={1.6} style={{ flexShrink: 0 }} />
            <span className={classes.label}>{node.label}</span>
            {folder && folder.noteCount > 0 && <span className={classes.count}>{folder.noteCount}</span>}
            {node.value !== SHARED && <FolderMenu folder={folder ?? null} isSharedRoot={Boolean(folder && folder.ownerId !== me?.id && !folder.parentId)} />}
          </div>
        );
      }}
    />
  );
}

/** Folder actions, limited to what my permission allows. `folder` null = "Home". */
export function FolderMenuItems({
  folder,
  isSharedRoot,
  newFolder = true,
}: {
  folder: FolderDto | null;
  isSharedRoot: boolean;
  /** Offer "New folder / subfolder" (false on the notes pane: folders are made in the sidebar). */
  newFolder?: boolean;
}) {
  const actions = useActions();
  const owner = !folder || folder.permission === 'owner';
  const editable = !folder || canEdit(folder.permission);
  return (
    <>
      {newFolder && editable && (
        <Menu.Item leftSection={<IconFolderPlus size={16} />} onClick={() => actions.createFolder(folder?.id ?? null)}>
          New {folder ? 'subfolder' : 'folder'}
        </Menu.Item>
      )}
      {folder && (
        <>
          {owner && (
            <Menu.Item leftSection={<IconShare size={16} />} onClick={() => actions.share({ kind: 'folder', id: folder.id, name: folder.name })}>
              Share…
            </Menu.Item>
          )}
          {editable && (
            <>
              <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => actions.renameFolder(folder)}>
                Rename
              </Menu.Item>
              <Menu.Item leftSection={<IconArrowsMove size={16} />} onClick={() => actions.moveFolder(folder)}>
                Move to…
              </Menu.Item>
            </>
          )}
          <Menu.Item
            leftSection={folder.isPrivate ? <IconLockOpen size={16} /> : <IconLock size={16} />}
            onClick={() => actions.setFolderPrivate(folder, !folder.isPrivate)}
          >
            {folder.isPrivate ? 'Make not private' : 'Make private'}
          </Menu.Item>
        </>
      )}
      {(folder || (newFolder && editable)) && <Menu.Divider />}
      {editable && (
        <Menu.Item leftSection={<IconFileImport size={16} />} onClick={() => actions.importInto(folder?.id ?? null)}>
          Import…
        </Menu.Item>
      )}
      <Menu.Item leftSection={<IconFileExport size={16} />} onClick={() => actions.exportFolder(folder)}>
        {folder ? 'Export as zip' : 'Export all as zip'}
      </Menu.Item>
      {folder && (
        <>
          {isSharedRoot && (
            <Menu.Item
              leftSection={<IconLogout2 size={16} />}
              onClick={() => actions.leaveShare({ kind: 'folder', id: folder.id, name: folder.name })}
            >
              Remove from Shared with me
            </Menu.Item>
          )}
          {owner && (
            <>
              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => actions.trashFolder(folder)}>
                Move to trash
              </Menu.Item>
            </>
          )}
        </>
      )}
    </>
  );
}

function FolderMenu({ folder, isSharedRoot }: { folder: FolderDto | null; isSharedRoot: boolean }) {
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          className={classes.actions}
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Folder actions"
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <FolderMenuItems folder={folder} isSharedRoot={isSharedRoot} />
      </Menu.Dropdown>
    </Menu>
  );
}
