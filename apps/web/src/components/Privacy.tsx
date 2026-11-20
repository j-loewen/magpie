import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Menu,
  Modal,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useInterval } from '@mantine/hooks';
import { IconClockPlus, IconLock, IconLockOpen } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrivacyStatusDto, SecretKind, SetSecretInput } from '@notes/shared';
import { api, errorMessage } from '../api';
import { useMe } from '../auth';
import { useFolderIndex } from '../data';
import { useNoteDialog, useNoteSearch } from '../lib/note-dialog';
import { notifyError } from '../lib/notify';

const privacyKey = ['privacy'] as const;
/** Lock a few seconds before the server does, so open notes can still be saved. */
const LOCK_EARLY_MS = 4000;
const WARN_BEFORE_MS = 60_000;

export function usePrivacy() {
  return useQuery({ queryKey: privacyKey, queryFn: () => api<PrivacyStatusDto>('/api/privacy'), staleTime: 30_000 });
}

interface PrivacyContext {
  status: PrivacyStatusDto | undefined;
  unlocked: boolean;
  /** When private folders lock, on this browser's clock; null = locked. */
  until: number | null;
  /** Opens the PIN prompt; resolves true once unlocked. */
  requestUnlock: () => Promise<boolean>;
  /** Opens PIN setup; resolves true once a PIN exists. */
  requestSetup: () => Promise<boolean>;
  lockNow: () => Promise<void>;
  /** Called (and awaited) right before locking, e.g. to save an open note. Returns an unsubscribe function. */
  onBeforeLock: (fn: () => Promise<void>) => () => void;
}

const Ctx = createContext<PrivacyContext | null>(null);

export function usePrivacyContext() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePrivacyContext outside PrivacyProvider');
  return ctx;
}

/** Saves pending work (via `fn`) before private folders lock. */
export function useBeforeLock(fn: () => Promise<void>) {
  const { onBeforeLock } = usePrivacyContext();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onBeforeLock(() => ref.current()), [onBeforeLock]);
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const openNote = useNoteSearch().note;
  const noteDialog = useNoteDialog();
  const index = useFolderIndex();
  const { data: status, dataUpdatedAt } = usePrivacy();
  const [dialog, setDialog] = useState<'unlock' | 'setup' | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const beforeLock = useRef(new Set<() => Promise<void>>());
  const locking = useRef(false);

  // The time left as of when the status arrived (fetched or set from a response), so a browser clock
  // that differs from the server's does not shift the countdown.
  const until =
    status?.unlockedForMs != null
      ? dataUpdatedAt + status.unlockedForMs
      : status?.unlockedUntil
        ? new Date(status.unlockedUntil).getTime()
        : null;
  const unlocked = until !== null && until > Date.now();

  /** Anything that depends on what is visible must be fetched again. */
  const refreshAll = useCallback(() => {
    for (const key of [['folders'], ['notes'], ['note'], ['trash'], ['search']]) void qc.invalidateQueries({ queryKey: key });
  }, [qc]);

  const applyStatus = useCallback(
    (next: PrivacyStatusDto) => {
      qc.setQueryData(privacyKey, next);
      refreshAll();
    },
    [qc, refreshAll],
  );

  /** Are the page being viewed and the note open in the note dialog inside a private folder? */
  const viewingPrivate = useCallback(() => {
    const isPrivate = (id: string | null | undefined) => Boolean(id && index.path(id).some((f) => f.isPrivate));
    const noteFolder = openNote ? qc.getQueryData<{ folderId: string | null }>(['note', openNote])?.folderId : undefined;
    return { page: isPrivate(pathname.match(/^\/f\/([^/]+)/)?.[1]), note: isPrivate(noteFolder) };
  }, [pathname, openNote, qc, index]);

  const lockNow = useCallback(async () => {
    if (locking.current) return;
    locking.current = true;
    try {
      await Promise.allSettled([...beforeLock.current].map((fn) => fn()));
      const leave = viewingPrivate();
      applyStatus(await api<PrivacyStatusDto>('/api/privacy/lock', 'POST'));
      notifications.hide('privacy-warning');
      // Leaving the page also closes the note dialog.
      if (leave.page) void navigate({ to: '/' });
      else if (leave.note) noteDialog.close();
    } catch (err) {
      notifyError(err);
    } finally {
      locking.current = false;
    }
  }, [applyStatus, navigate, noteDialog, viewingPrivate]);

  const keepUnlocked = useCallback(async () => {
    try {
      qc.setQueryData(privacyKey, await api<PrivacyStatusDto>('/api/privacy/extend', 'POST'));
      notifications.hide('privacy-warning');
    } catch (err) {
      notifyError(err);
    }
  }, [qc]);

  // Timers: warn a minute before, lock shortly before the server does.
  useEffect(() => {
    if (!until) return;
    const now = Date.now();
    const lockIn = Math.max(0, until - now - LOCK_EARLY_MS);
    const warnIn = until - now - WARN_BEFORE_MS;
    const lockTimer = setTimeout(() => void lockNow(), lockIn);
    const warnTimer =
      warnIn > 0
        ? setTimeout(
            () =>
              notifications.show({
                id: 'privacy-warning',
                color: 'orange',
                autoClose: WARN_BEFORE_MS - LOCK_EARLY_MS,
                title: 'Private folders lock in a minute',
                message: (
                  <Button size="compact-xs" variant="light" color="orange" mt={4} onClick={() => void keepUnlocked()}>
                    Keep unlocked
                  </Button>
                ),
              }),
            warnIn,
          )
        : undefined;
    // Background tabs may delay timers: check again whenever the tab becomes visible.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= until - LOCK_EARLY_MS) void lockNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(lockTimer);
      clearTimeout(warnTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [until, lockNow, keepUnlocked]);

  const open = (kind: 'unlock' | 'setup') =>
    new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setDialog(kind);
    });
  const close = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setDialog(null);
  };

  const onBeforeLock = useCallback((fn: () => Promise<void>) => {
    beforeLock.current.add(fn);
    return () => void beforeLock.current.delete(fn);
  }, []);

  const value: PrivacyContext = {
    status,
    unlocked,
    until,
    requestUnlock: () => (unlocked ? Promise.resolve(true) : open('unlock')),
    requestSetup: () => (status?.hasSecret ? Promise.resolve(true) : open('setup')),
    lockNow,
    onBeforeLock,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <UnlockModal
        opened={dialog === 'unlock'}
        kind={status?.kind ?? 'pin'}
        onClose={() => close(false)}
        onUnlocked={(next) => {
          applyStatus(next);
          close(true);
        }}
      />
      <SecretModal
        opened={dialog === 'setup'}
        onClose={() => close(false)}
        onSaved={(next) => {
          qc.setQueryData(privacyKey, next);
          close(true);
        }}
      />
    </Ctx.Provider>
  );
}

function UnlockModal({
  opened,
  kind,
  onClose,
  onUnlocked,
}: {
  opened: boolean;
  kind: SecretKind;
  onClose: () => void;
  onUnlocked: (status: PrivacyStatusDto) => void;
}) {
  const { data: me } = useMe();
  const [secret, setSecret] = useState('');
  const unlock = useMutation({
    mutationFn: () => api<PrivacyStatusDto>('/api/privacy/unlock', 'POST', { secret }),
    onSuccess: onUnlocked,
    onSettled: () => setSecret(''),
  });
  useEffect(() => {
    if (opened) unlock.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (secret) unlock.mutate();
  };
  const label = kind === 'pin' ? 'PIN' : 'Password';
  return (
    <Modal opened={opened} onClose={onClose} title="Show private folders" size="sm">
      <form onSubmit={submit}>
        <Stack>
          <Text size="sm" c="dimmed">
            Private folders stay visible in this browser for {me?.prefs.unlockMinutes ?? 10} minutes.
          </Text>
          {unlock.isError && (
            <Alert color="red" py="xs">
              {errorMessage(unlock.error)}
            </Alert>
          )}
          <PasswordInput
            label={label}
            data-autofocus
            autoComplete="off"
            inputMode={kind === 'pin' ? 'numeric' : undefined}
            value={secret}
            onChange={(e) => setSecret(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={unlock.isPending} leftSection={<IconLockOpen size={16} />} disabled={!secret}>
              Unlock
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

/** Set or change the PIN/password (also used from Settings). */
export function SecretModal({
  opened,
  onClose,
  onSaved,
}: {
  opened: boolean;
  onClose: () => void;
  onSaved: (status: PrivacyStatusDto) => void;
}) {
  const { data: current } = usePrivacy();
  const [kind, setKind] = useState<SecretKind>('pin');
  const [secret, setSecret] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  useEffect(() => {
    if (!opened) return;
    setKind(current?.kind ?? 'pin');
    setSecret('');
    setConfirm('');
    setAccountPassword('');
  }, [opened, current?.kind]);

  const save = useMutation({
    mutationFn: () => api<PrivacyStatusDto>('/api/privacy/secret', 'PUT', { kind, secret, accountPassword } as SetSecretInput),
    onSuccess: (status) => {
      notifications.show({ message: current?.hasSecret ? 'PIN changed' : 'PIN set. You can now make folders private.' });
      onSaved(status);
    },
  });
  const pinInvalid = kind === 'pin' && secret !== '' && !/^\d{4,12}$/.test(secret);
  const mismatch = confirm !== '' && confirm !== secret;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pinInvalid && !mismatch && secret && confirm) save.mutate();
  };
  const word = kind === 'pin' ? 'PIN' : 'password';

  return (
    <Modal opened={opened} onClose={onClose} title={current?.hasSecret ? 'Change private-folder PIN' : 'Set up private folders'}>
      <form onSubmit={submit}>
        <Stack>
          <Text size="sm" c="dimmed">
            Private folders are hidden until you enter this {word}. It is separate from your login password.
          </Text>
          <SegmentedControl
            value={kind}
            onChange={(v) => setKind(v as SecretKind)}
            data={[
              { value: 'pin', label: 'PIN (digits)' },
              { value: 'password', label: 'Password' },
            ]}
          />
          {save.isError && (
            <Alert color="red" py="xs">
              {errorMessage(save.error)}
            </Alert>
          )}
          <PasswordInput
            label={kind === 'pin' ? 'New PIN' : 'New password'}
            description={kind === 'pin' ? '4 to 12 digits' : 'At least 4 characters'}
            inputMode={kind === 'pin' ? 'numeric' : undefined}
            autoComplete="off"
            data-autofocus
            error={pinInvalid && 'Use 4 to 12 digits'}
            value={secret}
            onChange={(e) => setSecret(e.currentTarget.value)}
          />
          <PasswordInput
            label={`Repeat ${word}`}
            inputMode={kind === 'pin' ? 'numeric' : undefined}
            autoComplete="off"
            error={mismatch && `The ${word}s do not match`}
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
          />
          <PasswordInput
            label="Your account password"
            description="Confirms it is really you"
            autoComplete="current-password"
            value={accountPassword}
            onChange={(e) => setAccountPassword(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!secret || !confirm || !accountPassword || pinInvalid || mismatch}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Header control: lock icon while locked, countdown with lock/extend menu while unlocked. */
export function PrivacyButton() {
  const { status, unlocked, until, requestUnlock, lockNow } = usePrivacyContext();
  const { data: me } = useMe();
  const qc = useQueryClient();
  // Re-renders every second while unlocked; the time itself is read at render, so the first frame
  // after unlocking or extending is already right.
  const [, setTick] = useState(0);
  const ticker = useInterval(() => setTick((t) => t + 1), 1000);
  useEffect(() => {
    if (unlocked) ticker.start();
    else ticker.stop();
    return ticker.stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  if (!status?.hasSecret) return null;
  if (!unlocked) {
    return (
      <Tooltip label="Show private folders">
        <ActionIcon variant="default" size="lg" onClick={() => void requestUnlock()} aria-label="Show private folders">
          <IconLock size={18} stroke={1.6} />
        </ActionIcon>
      </Tooltip>
    );
  }
  const left = (until ?? 0) - Date.now();
  const extend = async () => {
    try {
      qc.setQueryData(privacyKey, await api<PrivacyStatusDto>('/api/privacy/extend', 'POST'));
      notifications.hide('privacy-warning');
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Menu position="bottom-end" width={230}>
      <Menu.Target>
        <UnstyledButton aria-label="Private folders are visible">
          <Group
            gap={6}
            px={10}
            h={34}
            wrap="nowrap"
            style={{
              borderRadius: 'var(--mantine-radius-md)',
              background: 'var(--mantine-color-orange-light)',
              color: 'var(--mantine-color-orange-light-color)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <IconLockOpen size={16} />
            <Text size="sm" fw={600} inherit>
              {mmss(left)}
            </Text>
          </Group>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Private folders are visible</Menu.Label>
        <Menu.Item leftSection={<IconLock size={16} />} onClick={() => void lockNow()}>
          Lock now
        </Menu.Item>
        <Menu.Item leftSection={<IconClockPlus size={16} />} onClick={() => void extend()}>
          Keep unlocked ({me?.prefs.unlockMinutes ?? 10} min)
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
