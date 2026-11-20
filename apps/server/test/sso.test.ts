import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@notes/shared';
import { client, makeApp } from './helpers';

/**
 * A fake identity provider: OpenID Connect (discovery, JWKS, token endpoint issuing signed ID
 * tokens, PKCE checked) and GitHub's OAuth endpoints, on one local HTTP server.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');

let server: http.Server;
let base = '';
let issuer = '';
/** Codes the "user" approved at the provider: what the token endpoint answers for each. */
const codes = new Map<string, { challenge: string; claims?: Record<string, unknown>; github?: { id: number; login: string; name?: string } }>();
const githubTokens = new Map<string, { id: number; login: string; name?: string }>();

function idToken(claims: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
  const body = b64(JSON.stringify({ iss: issuer, aud: 'notes', iat: now, exp: now + 300, ...claims }));
  return `${head}.${body}.${b64(sign('sha256', Buffer.from(`${head}.${body}`), privateKey))}`;
}

const pkceOk = (verifier: string | null, challenge: string) =>
  !!verifier && createHash('sha256').update(verifier).digest('base64url') === challenge;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url!, base);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === '/realm/.well-known/openid-configuration') {
        return json(200, {
          issuer,
          authorization_endpoint: `${base}/realm/authorize`,
          token_endpoint: `${base}/realm/token`,
          jwks_uri: `${base}/realm/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url.pathname === '/realm/jwks') return json(200, { keys: [jwk] });
      if (url.pathname === '/realm/token') {
        const form = new URLSearchParams(raw);
        const entry = codes.get(form.get('code') ?? '');
        codes.delete(form.get('code') ?? '');
        if (!entry?.claims || !pkceOk(form.get('code_verifier'), entry.challenge)) return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken(entry.claims) });
      }
      if (url.pathname === '/login/oauth/access_token') {
        const body = JSON.parse(raw) as { code: string; code_verifier: string; client_secret: string };
        const entry = codes.get(body.code);
        codes.delete(body.code);
        if (!entry?.github || body.client_secret !== 'gh-secret' || !pkceOk(body.code_verifier, entry.challenge)) {
          return json(200, { error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' });
        }
        const token = `gho_${body.code}`;
        githubTokens.set(token, entry.github);
        return json(200, { access_token: token, token_type: 'bearer', scope: '' });
      }
      if (url.pathname === '/user') {
        const user = githubTokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
        return user ? json(200, user) : json(401, { message: 'Bad credentials' });
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  issuer = `${base}/realm`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
  codes.clear();
});

async function start(env: Record<string, string> = {}) {
  ({ app } = await makeApp({
    BASE_URL: 'https://notes.example/',
    OIDC_ISSUER: issuer,
    OIDC_CLIENT_ID: 'notes',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_NAME: 'Authentik',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    GITHUB_URL: base,
    GITHUB_API_URL: base,
    ...env,
  }));
}

const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => res.cookies.find((c) => c.name === name)?.value;

/**
 * Runs a whole sign-in: start in the app, "approve" at the provider, come back to the callback.
 * Returns the callback response (a redirect) and the session cookie it set, if any.
 */
async function signInWith(
  provider: 'oidc' | 'github',
  approve: { claims?: Record<string, unknown>; github?: { id: number; login: string; name?: string } },
  opts: { mode?: 'login' | 'link'; session?: string; returnTo?: string; tamper?: (q: URLSearchParams) => void } = {},
) {
  const sessionCookie = opts.session ? `notes_sid=${opts.session}` : undefined;
  const started = await app.inject({
    method: 'POST',
    url: `/api/auth/sso/${provider}/start`,
    payload: { mode: opts.mode ?? 'login', ...(opts.returnTo && { returnTo: opts.returnTo }) },
    headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE, ...(sessionCookie && { cookie: sessionCookie }) },
  });
  expect(started.statusCode, started.body).toBe(200);
  const auth = new URL(started.json().url);
  const code = `code-${Math.random().toString(36).slice(2)}`;
  codes.set(code, {
    challenge: auth.searchParams.get('code_challenge')!,
    ...(approve.claims && { claims: { nonce: auth.searchParams.get('nonce'), ...approve.claims } }),
    ...(approve.github && { github: approve.github }),
  });
  const query = new URLSearchParams({ code, state: auth.searchParams.get('state')! });
  opts.tamper?.(query);
  const cookies = [`notes_sso=${cookieOf(started, 'notes_sso')}`, sessionCookie].filter(Boolean).join('; ');
  const res = await app.inject({ method: 'GET', url: `/api/auth/sso/${provider}/callback?${query}`, headers: { cookie: cookies } });
  return { res, auth, session: cookieOf(res, 'notes_sid') || undefined, location: String(res.headers.location ?? '') };
}

/** The error message the app shows after a failed sign-in. */
const ssoError = (location: string) => new URL(location, 'https://notes.example').searchParams.get('sso_error') ?? '';

const me = (session: string | undefined) =>
  app.inject({ method: 'GET', url: '/api/me', headers: { cookie: `notes_sid=${session}` } }).then((r) => r.json());

describe('sign-in with OpenID Connect', () => {
  it('creates the first account (admin) on first sign-in and signs the same person in again later', async () => {
    await start();
    const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
    expect(status.json().providers).toEqual([
      { id: 'oidc', name: 'Authentik' },
      { id: 'github', name: 'GitHub' },
    ]);

    const first = await signInWith('oidc', { claims: { sub: 'u-1', preferred_username: 'jane', name: 'Jane Doe', email: 'jane@x.org' } });
    expect(first.res.statusCode).toBe(302);
    expect(first.location).toBe('/');
    // The authorization request used PKCE and asked for the configured scopes.
    expect(first.auth.searchParams.get('code_challenge_method')).toBe('S256');
    expect(first.auth.searchParams.get('scope')).toBe('openid profile email');
    expect(first.auth.searchParams.get('redirect_uri')).toBe('https://notes.example/api/auth/sso/oidc/callback');
    const user = await me(first.session);
    expect(user).toMatchObject({ username: 'jane', displayName: 'Jane Doe', role: 'admin', hasPassword: false });

    const again = await signInWith('oidc', { claims: { sub: 'u-1', preferred_username: 'renamed' } }, { returnTo: '/f/abc' });
    expect(again.location).toBe('/f/abc');
    expect((await me(again.session)).id).toBe(user.id);

    // No password: password sign-in never works for this account.
    expect((await client(app).login('jane', '')).statusCode).toBe(400);
    expect((await client(app).login('jane', 'anything-at-all')).statusCode).toBe(401);
  });

  it('refuses forged, replayed, cross-browser and tampered callbacks', async () => {
    await start();
    // A callback with a state the server never issued.
    const forged = await app.inject({ method: 'GET', url: '/api/auth/sso/oidc/callback?code=x&state=nope', headers: { cookie: 'notes_sso=nope' } });
    expect(forged.headers.location).toMatch(/^\/login\?sso_error=/);
    expect(cookieOf(forged, 'notes_sid')).toBeFalsy();

    // Wrong PKCE verifier / code: the token endpoint refuses, nobody is signed in.
    const badCode = await signInWith('oidc', { claims: { sub: 'u-2' } }, { tamper: (q) => q.set('code', 'unknown') });
    expect(badCode.location).toMatch(/^\/login\?sso_error=/);
    expect(badCode.session).toBeFalsy();

    // An ID token for a different nonce (e.g. replayed from another sign-in) is rejected.
    const wrongNonce = await signInWith('oidc', { claims: { sub: 'u-2', nonce: 'other' } });
    expect(wrongNonce.session).toBeFalsy();

    // Only paths inside the app are used after signing in.
    const offsite = await signInWith('oidc', { claims: { sub: 'u-3' } }, { returnTo: '//evil.example/x' });
    expect(offsite.location).toBe('/');

    // The provider reporting a cancelled sign-in.
    const cancelled = await signInWith('oidc', { claims: { sub: 'u-3' } }, { tamper: (q) => (q.delete('code'), q.set('error', 'access_denied')) });
    expect(ssoError(cancelled.location)).toContain('Sign-in was cancelled');
  });

  it('a state can only be used once and only together with its cookie', async () => {
    await start();
    const started = await app.inject({
      method: 'POST',
      url: '/api/auth/sso/oidc/start',
      payload: { mode: 'login' },
      headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
    });
    const state = new URL(started.json().url).searchParams.get('state')!;
    // Started in another browser: the callback has no matching cookie.
    const noCookie = await app.inject({ method: 'GET', url: `/api/auth/sso/oidc/callback?code=x&state=${state}` });
    expect(noCookie.headers.location).toMatch(/expired/);
    // That attempt is used up now, also with the right cookie.
    const replay = await app.inject({ method: 'GET', url: `/api/auth/sso/oidc/callback?code=x&state=${state}`, headers: { cookie: `notes_sso=${state}` } });
    expect(replay.headers.location).toMatch(/expired/);
  });
});

describe('sign-in with GitHub', () => {
  it('without open registration, only connected accounts can sign in', async () => {
    await start({ ALLOW_REGISTRATION: 'false' });
    const alice = client(app);
    await alice.register('alice');
    const session = alice.cookie()!.replace('notes_sid=', '');
    const octo = { id: 583231, login: 'octocat', name: 'The Octocat' };

    const unknown = await signInWith('github', { github: octo });
    expect(ssoError(unknown.location)).toContain('No account is connected to this GitHub account');
    expect(unknown.session).toBeFalsy();

    // Alice connects her GitHub account in Settings…
    const linked = await signInWith('github', { github: octo }, { mode: 'link', session });
    expect(linked.location).toBe('/settings?sso_linked=github');
    expect((await alice.get('/api/me/identities')).json()).toEqual([expect.objectContaining({ provider: 'github', label: 'octocat' })]);

    // …and can then sign in with it.
    const viaGithub = await signInWith('github', { github: octo });
    expect((await me(viaGithub.session)).username).toBe('alice');

    // The same GitHub account cannot be connected to a second user.
    const bob = client(app);
    await app.inject({ method: 'POST', url: '/api/admin/users', payload: { username: 'bob', password: 'password123' }, headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE, cookie: alice.cookie()! } });
    await bob.login('bob');
    const taken = await signInWith('github', { github: octo }, { mode: 'link', session: bob.cookie()!.replace('notes_sid=', '') });
    expect(ssoError(taken.location)).toContain('already connected to another user');
  });

  it('accounts made through a provider can set a password, and keep at least one way to sign in', async () => {
    await start();
    const { session } = await signInWith('github', { github: { id: 1, login: 'Jane Doe!' } });
    const user = await me(session);
    expect(user.username).toBe('Jane.Doe');
    const headers = { [CSRF_HEADER]: CSRF_HEADER_VALUE, cookie: `notes_sid=${session}` };

    // The only way to sign in cannot be removed.
    const unlink = () => app.inject({ method: 'DELETE', url: '/api/me/identities/github', headers });
    expect((await unlink()).statusCode).toBe(409);

    // Setting a first password needs no current password; afterwards the GitHub link can go.
    const setPw = await app.inject({ method: 'POST', url: '/api/me/password', payload: { newPassword: 'a-new-password' }, headers });
    expect(setPw.statusCode).toBe(204);
    expect((await me(session)).hasPassword).toBe(true);
    expect((await unlink()).statusCode).toBe(204);
    expect((await client(app).login('Jane.Doe', 'a-new-password')).statusCode).toBe(200);
  });

  it('is off unless configured', async () => {
    ({ app } = await makeApp({ BASE_URL: 'https://notes.example/' }));
    expect((await app.inject({ method: 'GET', url: '/api/auth/status' })).json().providers).toEqual([]);
    const res = await app.inject({ method: 'POST', url: '/api/auth/sso/github/start', payload: { mode: 'login' }, headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE } });
    expect(res.statusCode).toBe(404);
  });
});
