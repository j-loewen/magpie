import { ActionIcon, Card, Center, Group, Image, Loader, Menu, SimpleGrid, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconDots, IconLogout2, IconUsersGroup } from '@tabler/icons-react';
import type { SharedItemDto } from '@notes/shared';
import { displayTitle, getClientNoteType } from '@notes/note-types/client';
import { useFolderIndex, useSharedWithMe } from '../data';
import { useActions } from '../components/Actions';
import { NoteIcon, NoteTitleLink, NoteTypeGlyph, OpenNoteMenuItem, useOpenNote } from '../components/notes-ui';
import { fullDate, relativeTime } from '../lib/format';
import { StatusBar, StatusText, countLabel } from '../components/StatusBar';
import { FolderTile } from './FolderPage';

const permissionText = (p: SharedItemDto['permission']) => (p === 'edit' ? 'Can edit' : 'View only');

/** Everything other people shared directly with me: whole folders and single notes. */
export function SharedPage() {
  const shared = useSharedWithMe();
  const index = useFolderIndex();
  const folders = shared.data?.filter((i) => i.kind === 'folder') ?? [];
  const notes = shared.data?.filter((i) => i.kind === 'note') ?? [];

  return (
    <Stack>
      {shared.data && (
        <StatusBar>
          <StatusText>{countLabel(shared.data.length, 'item')} shared with you</StatusText>
        </StatusBar>
      )}
      <div>
        <Title order={2}>Shared with me</Title>
        <Text size="sm" c="dimmed">
          Folders and notes other people shared with you. Shared folders also appear in the sidebar.
        </Text>
      </div>

      {shared.isPending ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : shared.data?.length === 0 ? (
        <Center py={60}>
          <Stack align="center" gap="xs">
            <ThemeIcon size={56} radius="xl" variant="light" color="gray">
              <IconUsersGroup size={30} />
            </ThemeIcon>
            <Text c="dimmed">Nothing has been shared with you yet.</Text>
          </Stack>
        </Center>
      ) : (
        <>
          {folders.length > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                Folders
              </Text>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 4 }} spacing="sm">
                {folders.map((item) => {
                  const folder = index.byId.get(item.id);
                  return folder ? (
                    <Group key={item.id} gap={4} wrap="nowrap" align="stretch">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <FolderTile folder={folder} subtitle={`${item.owner.displayName} · ${permissionText(item.permission)}`} />
                      </div>
                      <LeaveMenu item={item} />
                    </Group>
                  ) : null;
                })}
              </SimpleGrid>
            </Stack>
          )}
          {notes.length > 0 && (
            <Stack gap="xs">
              <Text size="sm" fw={600} c="dimmed" tt="uppercase">
                Notes
              </Text>
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 4 }} spacing="sm">
                {notes.map((item) => (
                  <SharedNoteCard key={item.id} item={item} />
                ))}
              </SimpleGrid>
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}

function LeaveMenu({ item }: { item: SharedItemDto }) {
  const actions = useActions();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="sm" mt={4} aria-label="Shared item actions" onClick={(e) => e.stopPropagation()}>
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        {item.kind === 'note' && <OpenNoteMenuItem note={{ id: item.id, type: item.type ?? '', meta: item.meta }} />}
        <Menu.Item
          leftSection={<IconLogout2 size={16} />}
          onClick={() => actions.leaveShare({ kind: item.kind, id: item.id, name: item.name || 'Untitled' })}
        >
          Remove from Shared with me
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

function SharedNoteCard({ item }: { item: SharedItemDto }) {
  const openNote = useOpenNote();
  const note = { id: item.id, type: item.type ?? '', title: item.name, meta: item.meta, icon: item.icon, color: item.color };
  const type = getClientNoteType(note.type);
  const image = type?.cardImage?.(item.meta);
  const Body = type?.CardBody;
  return (
    <Card
      withBorder
      radius="md"
      padding="sm"
      className="note-card"
      style={{ cursor: 'pointer' }}
      onClick={() => openNote(note)}
    >
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
        <LeaveMenu item={item} />
      </Group>
      {image && (
        <Card.Section mt={6} mb={4}>
          <Image src={image} alt="" h={140} fit="cover" draggable={false} />
        </Card.Section>
      )}
      {Body ? (
        <Body title={item.name} excerpt={item.excerpt ?? ''} meta={item.meta} />
      ) : (
        <Text size="xs" c="dimmed" lineClamp={3} mt={6} ff={item.type === 'code' ? 'monospace' : undefined}>
          {item.excerpt || ' '}
        </Text>
      )}
      <Group gap={6} wrap="nowrap" mt="auto" pt={6}>
        <NoteTypeGlyph type={note.type} />
        <Tooltip label={`Shared ${fullDate(item.sharedAt)}`} openDelay={400}>
          <Text size="xs" c="dimmed" truncate="end">
            {item.owner.displayName} · {permissionText(item.permission)} · shared {relativeTime(item.sharedAt)}
          </Text>
        </Tooltip>
      </Group>
    </Card>
  );
}
