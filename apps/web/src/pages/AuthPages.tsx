import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, Link, useNavigate } from '@tanstack/react-router';
import { Alert, Anchor, Button, Center, Divider, Group, Loader, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconBrandGithub, IconKey } from '@tabler/icons-react';
import type { SsoProvider, SsoProviderDto } from '@notes/shared';
import { errorMessage } from '../api';
import { startSso, useAuthStatus, useLogin, useMe, useRegister } from '../auth';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeControls';

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Center mih="100dvh" p="md">
      <Stack w="100%" maw={400} gap="lg">
        <Group justify="space-between">
          <Logo height={36} />
          <ThemeToggle />
        </Group>
        <Paper withBorder radius="md" p="xl" shadow="sm">
          <Title order={2} size="h3" mb={subtitle ? 4 : 'md'}>
            {title}
          </Title>
          {subtitle && (
            <Text c="dimmed" size="sm" mb="md">
              {subtitle}
            </Text>
          )}
          {children}
        </Paper>
      </Stack>
    </Center>
  );
}

const PROVIDER_ICON: Record<SsoProvider, typeof IconKey> = { github: IconBrandGithub, oidc: IconKey };

/** "Sign in with GitHub" etc. for each provider set up on the server, then an "or" divider. */
function ProviderButtons({ providers, verb }: { providers: SsoProviderDto[]; verb: string }) {
  const [busy, setBusy] = useState<SsoProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (providers.length === 0) return null;
  const go = (p: SsoProvider) => {
    setBusy(p);
    setError(null);
    // On success the browser leaves for the provider's page.
    startSso(p, 'login').catch((err) => {
      setBusy(null);
      setError(errorMessage(err));
    });
  };
  return (
    <Stack gap="xs" mb="md">
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={18} />}>
          {error}
        </Alert>
      )}
      {providers.map((p) => {
        const Icon = PROVIDER_ICON[p.id];
        return (
          <Button key={p.id} variant="default" fullWidth leftSection={<Icon size={18} />} loading={busy === p.id} disabled={busy !== null && busy !== p.id} onClick={() => go(p.id)}>
            {verb} {p.name}
          </Button>
        );
      })}
      <Divider label="or" labelPosition="center" />
    </Stack>
  );
}

/** Message from a failed provider sign-in (the server redirects here with ?sso_error=…). */
function useSsoError() {
  const [message] = useState(() => new URLSearchParams(window.location.search).get('sso_error'));
  return message;
}

export function LoginPage() {
  const me = useMe();
  const status = useAuthStatus();
  const login = useLogin();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const ssoError = useSsoError();

  if (me.isPending || status.isPending) return <Center mih="100dvh"><Loader /></Center>;
  if (me.data) return <Navigate to="/" />;
  // With sign-in providers, the first admin can also be created by signing in through one.
  if (status.data?.needsSetup && !status.data.providers.length) return <Navigate to="/register" />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password }, { onSuccess: () => void navigate({ to: '/' }) });
  };

  return (
    <AuthCard title="Sign in">
      {ssoError && (
        <Alert color="red" icon={<IconAlertCircle size={18} />} mb="md">
          {ssoError}
        </Alert>
      )}
      <ProviderButtons providers={status.data?.providers ?? []} verb="Sign in with" />
      <form onSubmit={submit}>
        <Stack>
          {login.isError && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {errorMessage(login.error)}
            </Alert>
          )}
          <TextInput label="Username" autoComplete="username" required autoFocus value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
          <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <Button type="submit" loading={login.isPending} fullWidth>
            Sign in
          </Button>
          {status.data?.registrationOpen && (
            <Text size="sm" ta="center">
              No account yet?{' '}
              <Anchor component={Link} to="/register">
                Create one
              </Anchor>
            </Text>
          )}
        </Stack>
      </form>
    </AuthCard>
  );
}

export function RegisterPage() {
  const me = useMe();
  const status = useAuthStatus();
  const register = useRegister();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  if (me.isPending || status.isPending) return <Center mih="100dvh"><Loader /></Center>;
  if (me.data) return <Navigate to="/" />;

  if (!status.data?.registrationOpen) {
    return (
      <AuthCard title="Registration is closed">
        <Text size="sm" mb="md">
          New accounts can only be created by an administrator.
        </Text>
        <Button component={Link} to="/login" variant="light" fullWidth>
          Back to sign in
        </Button>
      </AuthCard>
    );
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch) return;
    register.mutate(
      { username, password, displayName: displayName || undefined },
      { onSuccess: () => void navigate({ to: '/' }) },
    );
  };

  const setup = status.data.needsSetup;
  return (
    <AuthCard
      title={setup ? 'Welcome! Create the admin account' : 'Create account'}
      subtitle={setup ? 'This is the first account on this server, so it becomes the administrator.' : undefined}
    >
      <ProviderButtons providers={status.data.providers} verb="Sign up with" />
      <form onSubmit={submit}>
        <Stack>
          {register.isError && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {errorMessage(register.error)}
            </Alert>
          )}
          <TextInput label="Username" description="Letters, digits, dot, dash, underscore" autoComplete="username" required autoFocus minLength={3} maxLength={32} value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
          <TextInput label="Display name" placeholder="Optional" maxLength={64} value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} />
          <PasswordInput label="Password" description="At least 8 characters" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          <PasswordInput label="Confirm password" autoComplete="new-password" required error={mismatch && 'Passwords do not match'} value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          <Button type="submit" loading={register.isPending} fullWidth>
            Create account
          </Button>
          {!setup && (
            <Text size="sm" ta="center">
              Already have an account?{' '}
              <Anchor component={Link} to="/login">
                Sign in
              </Anchor>
            </Text>
          )}
        </Stack>
      </form>
    </AuthCard>
  );
}
