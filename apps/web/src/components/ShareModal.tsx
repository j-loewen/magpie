import { useState } from 'react';
import { ActionIcon, Avatar, Button, Group, Loader, Modal, Select, Stack, Text, Tooltip } from '@mantine/core';
import { IconUserPlus, IconX } from '@tabler/icons-react';
import type { SharePermission } from '@notes/shared';
import { useShareActions, useShares, useUsers } from '../data';
import { notifyError } from '../lib/notify';

const PERMISSIONS = [
  { value: 'view', label: 'Can view' },
  { value: 'edit', label: 'Can edit' },
];

export interface ShareTarget {
  kind: 'folder' | 'note';
  id: string;
  name: string;
}

/** Owner's dialog: who has access, add people, change or remove their permission. */
export function ShareModal({ target, onClose }: { target: ShareTarget | null; onClose: () => void }) {
  return (
    <Modal opened={target !== null} onClose={onClose} title={target ? `Share "${target.name}"` : ''} size="md">
      {target && <ShareBody key={`${target.kind}-${target.id}`} target={target} />}
    </Modal>
  );
}

function ShareBody({ target }: { target: ShareTarget }) {
  const users = useUsers();
  const shares = useShares(target.kind, target.id);
  const { share, unshare } = useShareActions(target.kind, target.id);
  const [userId, setUserId] = useState<string | null>(null);
  const [permission, setPermission] = useState<SharePermission>('view');

  const sharedIds = new Set(shares.data?.map((s) => s.user.id));
  const candidates = (users.data ?? [])
    .filter((u) => !sharedIds.has(u.id))
    .map((u) => ({ value: u.id, label: u.displayName === u.username ? u.username : `${u.displayName} (@${u.username})` }));

  const add = () => {
    if (!userId) return;
    share.mutate({ userId, permission }, { onSuccess: () => setUserId(null), onError: notifyError });
  };

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {target.kind === 'folder'
          ? 'People you add see this folder with all its subfolders and notes under "Shared with me". Only you can delete it or change sharing.'
          : 'People you add see this note under "Shared with me". Only you can delete it or change sharing.'}
      </Text>

      <Group gap="xs" align="flex-end" wrap="nowrap">
        <Select
          style={{ flex: 1 }}
          label="Add people"
          placeholder={candidates.length ? 'Choose a user' : users.isPending ? 'Loading…' : 'No other users'}
          data={candidates}
          value={userId}
          onChange={setUserId}
          searchable
          nothingFoundMessage="No matching user"
          disabled={candidates.length === 0}
          comboboxProps={{ withinPortal: false }}
        />
        <Select
          w={120}
          data={PERMISSIONS}
          value={permission}
          onChange={(v) => v && setPermission(v as SharePermission)}
          allowDeselect={false}
          aria-label="Permission"
          comboboxProps={{ withinPortal: false }}
        />
        <Button leftSection={<IconUserPlus size={16} />} onClick={add} disabled={!userId} loading={share.isPending}>
          Share
        </Button>
      </Group>

      <Stack gap={6}>
        <Text size="sm" fw={500}>
          People with access
        </Text>
        {shares.isPending ? (
          <Loader size="sm" />
        ) : shares.data?.length === 0 ? (
          <Text size="sm" c="dimmed">
            Not shared with anyone yet.
          </Text>
        ) : (
          shares.data?.map((s) => (
            <Group key={s.user.id} gap="sm" wrap="nowrap">
              <Avatar size={30} radius="xl" color="initials" name={s.user.displayName} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {s.user.displayName}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  @{s.user.username}
                </Text>
              </div>
              <Select
                w={120}
                size="xs"
                data={PERMISSIONS}
                value={s.permission}
                allowDeselect={false}
                aria-label={`Permission for ${s.user.username}`}
                onChange={(v) => v && share.mutate({ userId: s.user.id, permission: v as SharePermission }, { onError: notifyError })}
                comboboxProps={{ withinPortal: false }}
              />
              <Tooltip label="Stop sharing">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={`Stop sharing with ${s.user.username}`}
                  onClick={() => unshare.mutate(s.user.id, { onError: notifyError })}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))
        )}
      </Stack>
    </Stack>
  );
}
