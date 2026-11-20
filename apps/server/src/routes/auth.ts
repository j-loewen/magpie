import type { FastifyInstance, FastifyReply } from 'fastify';
import { loginSchema, registerSchema, SSO_PROVIDERS, ssoStartSchema, type AuthStatus, type SsoProvider } from '@notes/shared';
import type { AppConfig } from '../config';
import type { Db } from '../db';
import { DUMMY_HASH, verifyPassword } from '../auth/password';
import { createSession, deleteSession } from '../auth/sessions';
import { SsoError, type SsoService } from '../auth/sso';
import { badRequest, notFound, parse, unauthorized } from '../lib/errors';
import { clearSessionCookie, requireUser, setSessionCookie } from '../plugins/auth';
import {
  countUsers,
  findIdentity,
  findUserById,
  findUserByUsername,
  linkIdentity,
  listIdentities,
  registerSsoUser,
  registerUser,
  toUserDto,
  unlinkIdentity,
} from '../services/users';

const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

/** Ties a provider callback to the browser that started the sign-in (login CSRF protection). */
const STATE_COOKIE = 'notes_sso';
const STATE_PATH = '/api/auth/sso/';

type ProviderParams = { Params: { provider: string } };

/** Only paths inside the app: never another site ("//evil.example", "/\evil.example"). */
const safeReturnTo = (value: string | undefined) => (value && /^\/(?![/\\])/.test(value) ? value : '/');

export async function authRoutes(app: FastifyInstance, { db, config, sso }: { db: Db; config: AppConfig; sso: SsoService }) {
  const provider = (raw: string): SsoProvider => {
    const p = SSO_PROVIDERS.find((id) => id === raw);
    if (!p || !sso.isEnabled(p)) throw notFound('This sign-in method is not set up on this server');
    return p;
  };
  const signIn = (reply: FastifyReply, userId: string, userAgent: string | undefined) => {
    const { token, expiresAt } = createSession(db, userId, config.sessionDays, userAgent);
    setSessionCookie(reply, config, token, expiresAt);
  };

  app.get('/api/auth/status', async (): Promise<AuthStatus> => {
    const needsSetup = countUsers(db) === 0;
    return { needsSetup, registrationOpen: needsSetup || config.allowRegistration, providers: sso.providers() };
  });

  app.post('/api/auth/register', { config: authRateLimit }, async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const user = await registerUser(db, input, config.allowRegistration);
    signIn(reply, user.id, req.headers['user-agent']);
    return reply.code(201).send(toUserDto(user));
  });

  app.post('/api/auth/login', { config: authRateLimit }, async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const user = findUserByUsername(db, input.username);
    // Accounts without a password (made through a provider) never match, in the same time.
    const ok = await verifyPassword(user?.passwordHash || DUMMY_HASH, input.password);
    if (!user || !user.passwordHash || !ok) throw unauthorized('Wrong username or password');
    signIn(reply, user.id, req.headers['user-agent']);
    return toUserDto(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) deleteSession(db, req.sessionToken);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  // ---- Sign-in with OIDC / GitHub

  /** Start a sign-in (or connecting an account): returns the provider's page to go to. */
  app.post<ProviderParams>('/api/auth/sso/:provider/start', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const p = provider(req.params.provider);
    const input = parse(ssoStartSchema, req.body);
    const userId = input.mode === 'link' ? requireUser(req).user.id : undefined;
    let started: { url: string; state: string };
    try {
      started = await sso.start(p, { mode: input.mode, userId, returnTo: safeReturnTo(input.returnTo) });
    } catch (err) {
      if (err instanceof SsoError) throw badRequest(err.message);
      throw err;
    }
    reply.setCookie(STATE_COOKIE, started.state, {
      httpOnly: true,
      // Lax: sent on the top-level redirect back from the provider.
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: STATE_PATH,
      maxAge: 10 * 60,
    });
    return { url: started.url };
  });

  /** The provider sends the user back here. Always answers with a redirect into the app. */
  app.get<ProviderParams>('/api/auth/sso/:provider/callback', async (req, reply) => {
    const query = new URLSearchParams(req.url.split('?')[1] ?? '');
    const state = query.get('state') ?? '';
    const cookieState = req.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: STATE_PATH, httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
    const fail = (mode: 'login' | 'link', message: string) =>
      reply.redirect(`${mode === 'link' ? '/settings' : '/login'}?${new URLSearchParams({ sso_error: message })}`);

    const p = SSO_PROVIDERS.find((id) => id === req.params.provider);
    // Each attempt is used up by its first callback, and only counts in the browser that started it.
    const pending = p && state ? sso.take(state, p) : undefined;
    if (!p || !pending || cookieState !== state) {
      return fail('login', 'The sign-in expired or was started in another browser. Please try again.');
    }

    let identity;
    try {
      identity = await sso.finish(pending, state, query);
    } catch (err) {
      if (!(err instanceof SsoError)) req.log.error({ err }, 'sign-in callback failed');
      return fail(pending.mode, err instanceof SsoError ? err.message : 'Sign-in failed');
    }
    const name = sso.name(p);

    if (pending.mode === 'link') {
      // Still signed in as the user who started connecting the account.
      if (req.auth?.user.id !== pending.userId) return fail('link', 'You were signed out meanwhile. Please sign in and try again.');
      try {
        linkIdentity(db, pending.userId!, identity);
      } catch (err) {
        return fail('link', err instanceof Error ? err.message : 'Could not connect the account');
      }
      return reply.redirect(`/settings?${new URLSearchParams({ sso_linked: p })}`);
    }

    const linked = findIdentity(db, identity.provider, identity.subject);
    const user = linked ? findUserById(db, linked.userId) : registerSsoUser(db, identity, config.allowRegistration);
    if (!user) {
      return fail(
        'login',
        `No account is connected to this ${name} account. Sign in with your password, then connect ${name} under Settings → Sign-in methods.`,
      );
    }
    signIn(reply, user.id, req.headers['user-agent']);
    return reply.redirect(pending.returnTo);
  });

  // ---- My sign-in methods

  app.get('/api/me/identities', async (req) => listIdentities(db, requireUser(req).user.id));

  app.delete<ProviderParams>('/api/me/identities/:provider', async (req, reply) => {
    const { user } = requireUser(req);
    const p = SSO_PROVIDERS.find((id) => id === req.params.provider);
    if (!p) throw notFound('Not connected');
    unlinkIdentity(db, user, p);
    return reply.code(204).send();
  });
}
