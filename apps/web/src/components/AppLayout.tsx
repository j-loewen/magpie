import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, Outlet, Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { ActionIcon, AppShell, Avatar, Burger, Button, Center, Divider, Group, Kbd, Loader, Menu, NavLink, ScrollArea, Stack, Text, TextInput, Title, Tooltip, UnstyledButton } from '@mantine/core';
import { useDisclosure, useHotkeys, useOs } from '@mantine/hooks';
import { IconBrandGithub, IconChevronDown, IconCloudOff, IconLogout, IconSearch, IconSettings, IconTrash, IconUsers, IconUsersGroup } from '@tabler/icons-react';
import { useLogout, useMe } from '../auth';
import { useLiveUpdates, type LiveStatus } from '../live';
import { ActionsProvider } from './Actions';
import { PrivacyButton, PrivacyProvider } from './Privacy';
import { FolderTree } from './FolderTree';
import { NoteDialog } from './NoteDialog';
import { ThemeToggle } from './ThemeControls';
import { InstallMenuItem } from './InstallApp';
import { Logo } from './Logo';
import { STATUS_BAR_HEIGHT, StatusBarProvider, useStatusBarHost } from './StatusBar';

/** The project's source, issues and releases. */
const GITHUB_URL = 'https://github.com/j-loewen/magpie';

export function AppLayout() {
  const { data: me, isPending, isError, refetch, isFetching } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const [opened, { toggle, close }] = useDisclosure();
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const live = useLiveUpdates(Boolean(me));
  const statusBar = useStatusBarHost();
  // Pages scroll inside the content panel, not the window: a new page starts at the top.
  // (Search changes, like opening a note dialog, keep the position.)
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => content.current?.scrollTo(0, 0), [pathname]);

  if (isPending) return <Center mih="100dvh"><Loader /></Center>;
  // Network error (offline, server down): not a reason to send the user to the sign-in page.
  if (isError && !me) {
    return (
      <Center mih="100dvh" p="md">
        <Stack align="center" gap="sm" maw={360} ta="center">
          <IconCloudOff size={40} stroke={1.5} color="var(--mantine-color-dimmed)" />
          <Title order={3}>Can't reach the server</Title>
          <Text c="dimmed" size="sm">
            Check your connection. Notes are stored on your server, so they need it to open.
          </Text>
          <Button variant="light" loading={isFetching} onClick={() => void refetch()}>
            Try again
          </Button>
        </Stack>
      </Center>
    );
  }
  if (!me) return <Navigate to="/login" />;

  return (
    <PrivacyProvider>
    <ActionsProvider>
    <StatusBarProvider value={statusBar.target}>
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      // Status bar across the bottom, always there; pages fill it with what they have.
      footer={{ height: STATUS_BAR_HEIGHT }}
      // Like VS Code: no lines between header, sidebar and status bar; the sidebar and the page sit
      // in rounded panels on the app's frame colour (see .app-* in styles.css).
      withBorder={false}
      padding={0}
      classNames={{ root: 'app-frame', header: 'app-chrome', footer: 'app-chrome', navbar: 'app-navbar', main: 'app-main' }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Toggle sidebar" />
            {/* A flex box, not inline: inline, the logo would sit on the text baseline and end up too high. */}
            <UnstyledButton component={Link} to="/" onClick={close} style={{ display: 'flex', alignItems: 'center' }}>
              <Logo height={30} />
            </UnstyledButton>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <LiveIndicator status={live} />
            <PrivacyButton />
            <ThemeToggle />
            <Menu position="bottom-end" width={200}>
              <Menu.Target>
                <UnstyledButton aria-label="User menu">
                  <Group gap={6} wrap="nowrap">
                    <Avatar size={30} radius="xl" color="initials" name={me.displayName} />
                    <Text size="sm" fw={500} visibleFrom="xs">
                      {me.displayName}
                    </Text>
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>@{me.username}</Menu.Label>
                <Menu.Item component={Link} to="/settings" leftSection={<IconSettings size={16} />}>
                  Settings
                </Menu.Item>
                {me.role === 'admin' && (
                  <Menu.Item component={Link} to="/admin/users" leftSection={<IconUsers size={16} />}>
                    Users
                  </Menu.Item>
                )}
                <InstallMenuItem />
                <Menu.Item
                  component="a"
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  leftSection={<IconBrandGithub size={16} />}
                >
                  Magpie on GitHub
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  color="red"
                  leftSection={<IconLogout size={16} />}
                  onClick={() => logout.mutate(undefined, { onSuccess: () => void navigate({ to: '/login' }) })}
                >
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar>
        <div className="app-panel app-sidebar">
        <AppShell.Section mb="xs">
          <SidebarSearch onSearch={close} />
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea}>
          <FolderTree onNavigate={close} />
        </AppShell.Section>
        <AppShell.Section>
          <Divider my={6} />
          <NavLink
            label="Shared with me"
            leftSection={<IconUsersGroup size={18} />}
            component={Link}
            to="/shared"
            onClick={close}
            active={pathname === '/shared'}
          />
          <NavLink
            label="Trash"
            leftSection={<IconTrash size={18} />}
            component={Link}
            to="/trash"
            onClick={close}
            active={pathname === '/trash'}
          />
        </AppShell.Section>
        </div>
      </AppShell.Navbar>

      <AppShell.Main>
        <div ref={content} className="app-panel app-content">
          <Outlet />
        </div>
      </AppShell.Main>

      <AppShell.Footer>
        <div ref={statusBar.ref} className="status-bar" />
      </AppShell.Footer>
    </AppShell>
    </StatusBarProvider>
    <NoteDialog />
    </ActionsProvider>
    </PrivacyProvider>
  );
}

function SidebarSearch({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const os = useOs();
  useHotkeys([['mod+K', () => input.current?.focus()]], []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    onSearch();
    void navigate({ to: '/search', search: { q: q.trim() } });
    setQ('');
    input.current?.blur();
  };
  return (
    <form onSubmit={submit} role="search">
      <TextInput
        ref={input}
        placeholder="Search"
        aria-label="Search"
        leftSection={<IconSearch size={16} />}
        rightSection={<Kbd size="xs">{os === 'macos' ? '⌘' : 'Ctrl'}+K</Kbd>}
        rightSectionWidth={64}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
    </form>
  );
}

/** Shown only when live updates have been unavailable for a while (brief reconnects stay silent). */
function LiveIndicator({ status }: { status: LiveStatus }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status === 'live') {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 10_000);
    return () => clearTimeout(t);
  }, [status]);
  if (!show) return null;
  return (
    <Tooltip label="Live updates are paused (reconnecting). Changes made elsewhere show up after a reload." multiline w={260}>
      <ActionIcon variant="subtle" color="orange" size="lg" aria-label="Live updates paused" onClick={() => window.location.reload()}>
        <IconCloudOff size={20} />
      </ActionIcon>
    </Tooltip>
  );
}
