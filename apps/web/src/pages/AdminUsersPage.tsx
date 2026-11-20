import { useState, type FormEvent } from 'react';
import { Navigate } from '@tanstack/react-router';
import { ActionIcon, Badge, Button, Group, Menu, Modal, PasswordInput, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots, IconKey, IconPlus, IconShield, IconShieldOff, IconTrash } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCreateUserInput, AdminUpdateUserInput, Role, UserDto } from '@notes/shared';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';

const usersKey = ['admin', 'users'] as const;
const notifyError = (err: unknown) => notifications.show({ color: 'red', title: 'Error', message: errorMessage(err) });

export function AdminUsersPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: usersKey, queryFn: () => api<UserDto[]>('/api/admin/users'), enabled: me?.role === 'admin' });
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<UserDto | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: usersKey });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminUpdateUserInput }) =>
      api<UserDto>(`/api/admin/users/${id}`, 'PATCH', patch),
    onSuccess: (user) => {
      void refresh();
      // Demoting yourself removes access to this page.
      if (user.id === me?.id) void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/admin/users/${id}`, 'DELETE'),
    onSuccess: () => {
      void refresh();
      notifications.show({ message: 'User deleted' });
    },
    onError: notifyError,
  });

  if (me && me.role !== 'admin') return <Navigate to="/" />;

  const setRole = (user: UserDto, role: Role) => update.mutate({ id: user.id, patch: { role } });
  const confirmDelete = (user: UserDto) => {
    if (window.confirm(`Delete "${user.username}" and all of their notes? This cannot be undone.`)) remove.mutate(user.id);
  };

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Users</Title>
          <Text size="sm" c="dimmed">
            Admins manage accounts. They cannot see other users' notes unless the notes are shared with them.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
          New user
        </Button>
      </Group>

      <Table.ScrollContainer minWidth={520}>
        <Table verticalSpacing="sm" highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>User</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Created</Table.Th>
              <Table.Th w={48} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {users.data?.map((user) => (
              <Table.Tr key={user.id}>
                <Table.Td>
                  <Text size="sm" fw={500}>
                    {user.displayName} {user.id === me?.id && <Text span c="dimmed" size="xs">(you)</Text>}
                  </Text>
                  <Text size="xs" c="dimmed">
                    @{user.username}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={user.role === 'admin' ? 'grape' : 'gray'}>
                    {user.role}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm">{new Date(user.createdAt).toLocaleDateString()}</Text>
                </Table.Td>
                <Table.Td>
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <ActionIcon variant="subtle" color="gray" aria-label={`Actions for ${user.username}`}>
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {user.role === 'user' ? (
                        <Menu.Item leftSection={<IconShield size={16} />} onClick={() => setRole(user, 'admin')}>
                          Make admin
                        </Menu.Item>
                      ) : (
                        <Menu.Item leftSection={<IconShieldOff size={16} />} onClick={() => setRole(user, 'user')}>
                          Remove admin
                        </Menu.Item>
                      )}
                      <Menu.Item leftSection={<IconKey size={16} />} onClick={() => setResetFor(user)}>
                        Reset password
                      </Menu.Item>
                      {user.id !== me?.id && (
                        <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => confirmDelete(user)}>
                          Delete
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      <CreateUserModal opened={createOpen} onClose={() => setCreateOpen(false)} onCreated={refresh} />
      <ResetPasswordModal user={resetFor} onClose={() => setResetFor(null)} />
    </Stack>
  );
}

function CreateUserModal({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<AdminCreateUserInput>({ username: '', password: '', displayName: '', role: 'user' });
  const create = useMutation({
    mutationFn: () => api<UserDto>('/api/admin/users', 'POST', { ...form, displayName: form.displayName || undefined }),
    onSuccess: (user) => {
      notifications.show({ message: `Created ${user.username}` });
      setForm({ username: '', password: '', displayName: '', role: 'user' });
      onCreated();
      onClose();
    },
    onError: notifyError,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Modal opened={opened} onClose={onClose} title="New user">
      <form onSubmit={submit}>
        <Stack>
          <TextInput label="Username" required minLength={3} maxLength={32} value={form.username} onChange={(e) => setForm({ ...form, username: e.currentTarget.value })} />
          <TextInput label="Display name" placeholder="Optional" maxLength={64} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.currentTarget.value })} />
          <PasswordInput label="Initial password" description="At least 8 characters" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.currentTarget.value })} />
          <Select label="Role" data={[{ value: 'user', label: 'User' }, { value: 'admin', label: 'Admin' }]} value={form.role} allowDeselect={false} onChange={(v) => setForm({ ...form, role: (v as Role) ?? 'user' })} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending}>
              Create
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserDto | null; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api<UserDto>(`/api/admin/users/${user!.id}`, 'PATCH', { password }),
    onSuccess: () => {
      notifications.show({ message: `Password reset for ${user?.username}. They were signed out everywhere.` });
      setPassword('');
      onClose();
    },
    onError: notifyError,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate();
  };
  return (
    <Modal opened={user !== null} onClose={onClose} title={`Reset password for ${user?.username ?? ''}`}>
      <form onSubmit={submit}>
        <Stack>
          <PasswordInput label="New password" description="At least 8 characters" required minLength={8} autoFocus value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={reset.isPending}>
              Reset password
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
