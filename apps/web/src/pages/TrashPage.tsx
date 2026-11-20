import { Button, Center, Group, Loader, Paper, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconArrowBackUp, IconFolder, IconTrash, IconTrashX } from '@tabler/icons-react';
import { useTrash, useTrashActions } from '../data';
import { NoteTypeIcon } from '../components/notes-ui';
import { StatusBar, StatusText, countLabel } from '../components/StatusBar';
import { fullDate, noteTitle, relativeTime } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';

export function TrashPage() {
  const trash = useTrash();
  const { restore, purge, empty } = useTrashActions();

  const items = [
    ...(trash.data?.folders ?? []).map((f) => ({
      kind: 'folder' as const,
      id: f.id,
      name: f.name,
      deletedAt: f.deletedAt,
      detail: [
        f.folderCount > 0 && `${f.folderCount} ${f.folderCount === 1 ? 'subfolder' : 'subfolders'}`,
        `${f.noteCount} ${f.noteCount === 1 ? 'note' : 'notes'}`,
      ]
        .filter(Boolean)
        .join(', '),
      type: null,
    })),
    ...(trash.data?.notes ?? []).map((n) => ({
      kind: 'note' as const,
      id: n.id,
      name: noteTitle(n.title),
      deletedAt: n.deletedAt,
      detail: null,
      type: n.type,
    })),
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  const confirmPurge = (item: (typeof items)[number]) => {
    if (window.confirm(`Delete "${item.name}" permanently? This cannot be undone.`)) {
      purge.mutate({ kind: item.kind, id: item.id }, { onError: notifyError });
    }
  };
  const confirmEmpty = () => {
    if (window.confirm('Permanently delete everything in the trash? This cannot be undone.')) {
      empty.mutate(undefined, { onSuccess: () => notifyOk('Trash emptied'), onError: notifyError });
    }
  };

  return (
    <Stack>
      {trash.data && (
        <StatusBar>
          <StatusText>{countLabel(items.length, 'item')} in the trash</StatusText>
          <StatusText>Deleted after {trash.data.retentionDays} days</StatusText>
        </StatusBar>
      )}
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Trash</Title>
          {trash.data && (
            <Text size="sm" c="dimmed">
              Items are deleted permanently {trash.data.retentionDays} days after being moved here.
            </Text>
          )}
        </div>
        {items.length > 0 && (
          <Button color="red" variant="light" leftSection={<IconTrashX size={16} />} onClick={confirmEmpty} loading={empty.isPending}>
            Empty trash
          </Button>
        )}
      </Group>

      {trash.isPending ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : items.length === 0 ? (
        <Center py={60}>
          <Stack align="center" gap="xs">
            <ThemeIcon size={56} radius="xl" variant="light" color="gray">
              <IconTrash size={30} />
            </ThemeIcon>
            <Text c="dimmed">The trash is empty.</Text>
          </Stack>
        </Center>
      ) : (
        <Paper withBorder radius="md">
          {items.map((item, i) => (
            <Group
              key={`${item.kind}-${item.id}`}
              wrap="nowrap"
              gap="sm"
              px="sm"
              py={10}
              style={{ borderTop: i ? '1px solid var(--mantine-color-default-border)' : undefined }}
            >
              {item.type ? (
                <NoteTypeIcon type={item.type} size={28} />
              ) : (
                <ThemeIcon variant="light" color="yellow" size={28} radius="md">
                  <IconFolder size={17} />
                </ThemeIcon>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500} truncate="end">
                  {item.name}
                </Text>
                <Tooltip label={fullDate(item.deletedAt)} openDelay={400}>
                  <Text size="xs" c="dimmed" w="fit-content">
                    {item.detail ? `${item.detail} · ` : ''}deleted {relativeTime(item.deletedAt)}
                  </Text>
                </Tooltip>
              </div>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconArrowBackUp size={14} />}
                onClick={() =>
                  restore.mutate(
                    { kind: item.kind, id: item.id },
                    { onSuccess: () => notifyOk(`"${item.name}" restored`), onError: notifyError },
                  )
                }
              >
                Restore
              </Button>
              <Tooltip label="Delete permanently">
                <Button size="xs" variant="subtle" color="red" px={8} onClick={() => confirmPurge(item)} aria-label="Delete permanently">
                  <IconTrashX size={16} />
                </Button>
              </Tooltip>
            </Group>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
