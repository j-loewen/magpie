import { useEffect, useState, type FormEvent } from 'react';
import { Button, Container, Group, Modal, NumberInput, Paper, PasswordInput, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMantineColorScheme } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IdentityDto, PrivacyStatusDto, SsoProvider, Theme, UserDto } from '@notes/shared';
import { api, errorMessage } from '../api';
import { meKey, startSso, useAuthStatus, useMe, useUpdatePrefs } from '../auth';
import { IconBrandGithub, IconFileExport, IconFileImport, IconKey, IconTrashX } from '@tabler/icons-react';
import type { PruneResultDto } from '@notes/shared';
import { usePruneStorage, useStorage } from '../data';
import { useActions } from '../components/Actions';
import { SecretModal, usePrivacy } from '../components/Privacy';

const notifyError = (err: unknown) => notifications.show({ color: 'red', title: 'Error', message: errorMessage(err) });

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Paper withBorder radius="md" p="lg">
      <Title order={3} size="h4">
        {title}
      </Title>
      {description && (
        <Text size="sm" c="dimmed" mt={4}>
          {description}
        </Text>
      )}
      <Stack mt="md">{children}</Stack>
    </Paper>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  if (!me) return null;
  return (
    <Container size="sm" px={0}>
      <Stack>
        <Title order={2}>Settings</Title>
        <ProfileSection me={me} />
        <AppearanceSection me={me} />
        <PrivateFoldersSection me={me} />
        <TransferSection />
        {me.role === 'admin' && <StorageSection />}
        <SignInMethodsSection me={me} />
        <PasswordSection me={me} />
      </Stack>
    </Container>
  );
}

function ProfileSection({ me }: { me: UserDto }) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me.displayName);
  const save = useMutation({
    mutationFn: () => api<UserDto>('/api/me/profile', 'PATCH', { displayName }),
    onSuccess: (user) => {
      qc.setQueryData(meKey, user);
      notifications.show({ message: 'Profile saved' });
    },
    onError: notifyError,
  });
  return (
    <Section title="Profile">
      <TextInput label="Username" value={me.username} disabled />
      <TextInput label="Display name" maxLength={64} value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
      <Group justify="flex-end">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!displayName.trim() || displayName === me.displayName}>
          Save
        </Button>
      </Group>
    </Section>
  );
}

function AppearanceSection({ me }: { me: UserDto }) {
  const updatePrefs = useUpdatePrefs();
  const { setColorScheme } = useMantineColorScheme();
  return (
    <Section title="Appearance">
      <div>
        <Text size="sm" fw={500} mb={4}>
          Theme
        </Text>
        <SegmentedControl
          value={me.prefs.theme}
          onChange={(value) => {
            const theme = value as Theme;
            setColorScheme(theme === 'system' ? 'auto' : theme);
            updatePrefs.mutate({ theme }, { onError: notifyError });
          }}
          data={[
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
            { label: 'System', value: 'system' },
          ]}
        />
      </div>
    </Section>
  );
}

function PrivateFoldersSection({ me }: { me: UserDto }) {
  const qc = useQueryClient();
  const updatePrefs = useUpdatePrefs();
  const { data: privacy } = usePrivacy();
  const [secretOpen, setSecretOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const remove = useMutation({
    mutationFn: () => api<PrivacyStatusDto>('/api/privacy/secret', 'DELETE', { accountPassword }),
    onSuccess: (status) => {
      qc.setQueryData(['privacy'], status);
      for (const key of [['folders'], ['notes'], ['trash'], ['search']]) void qc.invalidateQueries({ queryKey: key });
      setRemoveOpen(false);
      notifications.show({ message: 'PIN removed. All private folders are normal folders again.' });
    },
    onError: notifyError,
  });
  const word = privacy?.kind === 'password' ? 'password' : 'PIN';

  return (
    <Section
      title="Private folders"
      description="Private folders are hidden everywhere (sidebar, search, trash) until you enter your PIN. Unlocking applies to this browser only."
    >
      <Group justify="space-between">
        <Text size="sm">
          {privacy?.hasSecret ? `A private-folder ${word} is set.` : 'No PIN set yet. Set one to start making folders private.'}
        </Text>
        <Group gap="xs">
          <Button variant={privacy?.hasSecret ? 'default' : 'filled'} onClick={() => setSecretOpen(true)}>
            {privacy?.hasSecret ? `Change ${word}` : 'Set PIN'}
          </Button>
          {privacy?.hasSecret && (
            <Button variant="subtle" color="red" onClick={() => setRemoveOpen(true)}>
              Remove
            </Button>
          )}
        </Group>
      </Group>
      <NumberInput
        label="Stay unlocked for"
        description="After you enter the PIN, private folders stay visible for this many minutes."
        suffix=" min"
        min={1}
        max={1440}
        maw={260}
        value={me.prefs.unlockMinutes}
        onChange={(value) => {
          if (typeof value === 'number' && value >= 1 && value <= 1440) {
            updatePrefs.mutate({ unlockMinutes: value }, { onError: notifyError });
          }
        }}
      />
      <SecretModal
        opened={secretOpen}
        onClose={() => setSecretOpen(false)}
        onSaved={(status) => {
          qc.setQueryData(['privacy'], status);
          setSecretOpen(false);
        }}
      />
      <Modal opened={removeOpen} onClose={() => setRemoveOpen(false)} title={`Remove private-folder ${word}?`}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <Stack>
            <Text size="sm">All private folders become normal, visible folders. Nothing is deleted.</Text>
            <PasswordInput
              label="Your account password"
              data-autofocus
              autoComplete="current-password"
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setRemoveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" color="red" loading={remove.isPending} disabled={!accountPassword}>
                Remove {word}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Section>
  );
}

function TransferSection() {
  const actions = useActions();
  return (
    <Section
      title="Import & export"
      description="Export downloads a zip with all your notes: a file the app can import again, plus every note as a readable file (Markdown, text, code) in your folder structure. Private folders are included only while they are unlocked. Notes shared with you are not included."
    >
      <Group gap="xs">
        <Button variant="default" leftSection={<IconFileExport size={16} />} onClick={() => actions.exportFolder(null)}>
          Export all my notes
        </Button>
        <Button variant="default" leftSection={<IconFileImport size={16} />} onClick={() => actions.importInto(null)}>
          Import…
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        Import accepts exports from this app, browser bookmarks, Markdown, text and code files (or a zip of them), and OPML
        or FreeMind mind maps. Folders and single notes can also be exported from their menu.
      </Text>
    </Section>
  );
}

const megabytes = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(bytes ? 1 : 0, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function pruneSummary(r: PruneResultDto): string {
  const parts = [
    r.noteFolders && `files of ${r.noteFolders} deleted ${r.noteFolders === 1 ? 'note' : 'notes'}`,
    r.strayFiles && `${r.strayFiles} leftover ${r.strayFiles === 1 ? 'file' : 'files'}`,
    r.missingFiles && `${r.missingFiles} broken file ${r.missingFiles === 1 ? 'entry' : 'entries'}`,
    r.sessions && `${r.sessions} expired ${r.sessions === 1 ? 'login' : 'logins'}`,
  ].filter(Boolean);
  const db = `Database ${megabytes(r.databaseBytesBefore)} → ${megabytes(r.databaseBytesAfter)}.`;
  return parts.length ? `Removed ${parts.join(', ')} (${megabytes(r.bytesFreed)} freed). ${db}` : `Nothing unused was found. ${db}`;
}

/** Admins: disk space used on the server and a clean-up of everything no longer used. */
function StorageSection() {
  const storage = useStorage(true);
  const prune = usePruneStorage();
  const [result, setResult] = useState<string | null>(null);
  const s = storage.data;
  return (
    <Section
      title="Storage (admin)"
      description="Space used on the server. Clean-up removes the files of permanently deleted notes, leftover files and expired logins, and compacts the database. Notes in anyone's trash are not touched."
    >
      {s && (
        <Stack gap={4}>
          <Group justify="space-between" maw={420}>
            <Text size="sm">Preview images and icons</Text>
            <Text size="sm" c="dimmed">
              {s.files.count} {s.files.count === 1 ? 'file' : 'files'} · {megabytes(s.files.bytes)}
            </Text>
          </Group>
          <Group justify="space-between" maw={420}>
            <Text size="sm">Database</Text>
            <Text size="sm" c="dimmed">
              {megabytes(s.databaseBytes)}
            </Text>
          </Group>
        </Stack>
      )}
      <Group>
        <Button
          variant="default"
          leftSection={<IconTrashX size={16} />}
          loading={prune.isPending}
          onClick={() =>
            prune.mutate(undefined, {
              onSuccess: (r) => {
                setResult(pruneSummary(r));
                notifications.show({ message: 'Storage cleaned up.' });
              },
              onError: notifyError,
            })
          }
        >
          Clean up now
        </Button>
      </Group>
      {result && (
        <Text size="sm" c="dimmed">
          {result}
        </Text>
      )}
    </Section>
  );
}

const PROVIDER_ICON: Record<SsoProvider, typeof IconKey> = { github: IconBrandGithub, oidc: IconKey };

/** Connect or disconnect GitHub / the OIDC provider. Shown when the server has any set up. */
function SignInMethodsSection({ me }: { me: UserDto }) {
  const qc = useQueryClient();
  const status = useAuthStatus();
  const identities = useQuery({ queryKey: ['identities'], queryFn: () => api<IdentityDto[]>('/api/me/identities') });
  const [busy, setBusy] = useState<SsoProvider | null>(null);
  const unlink = useMutation({
    mutationFn: (provider: SsoProvider) => api<void>(`/api/me/identities/${provider}`, 'DELETE'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['identities'] }),
    onError: notifyError,
  });

  // Back from the provider: report how connecting went, then tidy the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('sso_error');
    const linked = params.get('sso_linked');
    if (error) notifications.show({ color: 'red', title: 'Could not connect the account', message: error, autoClose: false });
    if (linked) notifications.show({ message: 'Account connected. You can now sign in with it.' });
    if (error || linked) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const providers = status.data?.providers ?? [];
  if (providers.length === 0) return null;
  const connected = identities.data ?? [];
  return (
    <Section title="Sign-in methods" description="Sign in with these accounts instead of your password.">
      {providers.map((p) => {
        const Icon = PROVIDER_ICON[p.id];
        const identity = connected.find((i) => i.provider === p.id);
        // Without a password, the last connected account is the only way to sign in.
        const lastWay = !me.hasPassword && connected.length === 1 && Boolean(identity);
        return (
          <Group key={p.id} justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
              <Icon size={22} style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={500}>
                  {p.name}
                </Text>
                <Text size="xs" c="dimmed" truncate="end">
                  {identity ? `Connected as ${identity.label}` : 'Not connected'}
                </Text>
              </div>
            </Group>
            {identity ? (
              <Button
                variant="default"
                size="xs"
                disabled={lastWay}
                title={lastWay ? 'Set a password first, so you can still sign in' : undefined}
                loading={unlink.isPending && unlink.variables === p.id}
                onClick={() => unlink.mutate(p.id)}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                variant="default"
                size="xs"
                loading={busy === p.id}
                onClick={() => {
                  setBusy(p.id);
                  startSso(p.id, 'link').catch((err) => {
                    setBusy(null);
                    notifyError(err);
                  });
                }}
              >
                Connect
              </Button>
            )}
          </Group>
        );
      })}
    </Section>
  );
}

function PasswordSection({ me }: { me: UserDto }) {
  const qc = useQueryClient();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  // Accounts made through GitHub/OIDC start without a password and can set one here.
  const first = !me.hasPassword;
  const change = useMutation({
    mutationFn: () => api<void>('/api/me/password', 'POST', { ...(!first && { currentPassword }), newPassword }),
    onSuccess: () => {
      setCurrent('');
      setNew('');
      setConfirm('');
      void qc.invalidateQueries({ queryKey: meKey });
      notifications.show({ message: first ? 'Password set. You can now also sign in with it.' : 'Password changed. Other sessions were signed out.' });
    },
    onError: notifyError,
  });
  const mismatch = confirm.length > 0 && confirm !== newPassword;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch) change.mutate();
  };
  return (
    <Section
      title={first ? 'Set a password' : 'Change password'}
      description={
        first
          ? `Your account has no password yet. With one, you can also sign in as "${me.username}" without a provider, and set up private folders.`
          : 'Changing your password signs you out on all other devices.'
      }
    >
      <form onSubmit={submit}>
        <Stack>
          {!first && (
            <PasswordInput label="Current password" autoComplete="current-password" required value={currentPassword} onChange={(e) => setCurrent(e.currentTarget.value)} />
          )}
          <PasswordInput label="New password" description="At least 8 characters" autoComplete="new-password" required minLength={8} value={newPassword} onChange={(e) => setNew(e.currentTarget.value)} />
          <PasswordInput label="Confirm new password" autoComplete="new-password" required error={mismatch && 'Passwords do not match'} value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button type="submit" loading={change.isPending}>
              {first ? 'Set password' : 'Change password'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Section>
  );
}
