import * as oidc from 'openid-client';
import type { FastifyBaseLogger } from 'fastify';
import type { SsoProvider, SsoProviderDto } from '@notes/shared';
import type { AppConfig, GithubConfig, OidcConfig } from '../config';

/** Who signed in at the provider. */
export interface ExternalIdentity {
  provider: SsoProvider;
  /** Stable account id: "<issuer> <sub>" for OIDC, the numeric user id for GitHub. */
  subject: string;
  /** Shown in Settings: GitHub login, email or username at the provider. */
  label: string;
  /** Suggested username and display name for a new account. */
  username?: string;
  displayName?: string;
}

/** A sign-in that was started and waits for the provider to send the user back. */
export interface PendingSignIn {
  provider: SsoProvider;
  mode: 'login' | 'link';
  /** For `link`: the user the provider account is connected to. */
  userId?: string;
  returnTo: string;
  codeVerifier: string;
  nonce: string;
  expires: number;
}

export class SsoError extends Error {}

const PENDING_MS = 10 * 60 * 1000;
const PENDING_MAX = 1000;
const HTTP_TIMEOUT = 10_000;

/**
 * Sign-in with an OpenID Connect provider and with GitHub (plain OAuth 2, not OIDC). The OIDC
 * side (discovery, PKCE, state, nonce, ID token checks) is done by openid-client.
 */
export class SsoService {
  private pending = new Map<string, PendingSignIn>();
  private oidcConfig: Promise<oidc.Configuration> | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly log: FastifyBaseLogger,
  ) {}

  providers(): SsoProviderDto[] {
    return [
      ...(this.config.oidc ? [{ id: 'oidc' as const, name: this.config.oidc.name }] : []),
      ...(this.config.github ? [{ id: 'github' as const, name: 'GitHub' }] : []),
    ];
  }

  name(provider: SsoProvider): string {
    return this.providers().find((p) => p.id === provider)?.name ?? provider;
  }

  isEnabled(provider: SsoProvider) {
    return this.providers().some((p) => p.id === provider);
  }

  /** The address the provider sends the user back to (must be registered with the provider). */
  redirectUri(provider: SsoProvider): string {
    const base = this.config.baseUrl!;
    // Relative to BASE_URL, also when it has a path but no trailing slash.
    return new URL(`api/auth/sso/${provider}/callback`, base.endsWith('/') ? base : `${base}/`).toString();
  }

  /** Address of the provider's sign-in page, and the state that identifies this attempt. */
  async start(provider: SsoProvider, request: Pick<PendingSignIn, 'mode' | 'userId' | 'returnTo'>): Promise<{ url: string; state: string }> {
    const state = oidc.randomState();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const nonce = oidc.randomNonce();
    let url: URL;
    if (provider === 'oidc') {
      const cfg = await this.oidc();
      url = oidc.buildAuthorizationUrl(cfg, {
        redirect_uri: this.redirectUri('oidc'),
        scope: this.config.oidc!.scopes,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
    } else {
      const gh = this.github();
      url = new URL('/login/oauth/authorize', gh.webUrl);
      url.search = new URLSearchParams({
        client_id: gh.clientId,
        redirect_uri: this.redirectUri('github'),
        // No scopes: only the public profile (id, login, name), which is all that is used.
        state,
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
      }).toString();
    }
    this.remember(state, { provider, ...request, codeVerifier, nonce, expires: Date.now() + PENDING_MS });
    return { url: url.toString(), state };
  }

  /** The sign-in this callback belongs to; each can be finished once. */
  take(state: string, provider: SsoProvider): PendingSignIn | undefined {
    const p = this.pending.get(state);
    this.pending.delete(state);
    return p && p.provider === provider && p.expires > Date.now() ? p : undefined;
  }

  /** Exchange the code from the callback for the provider account. */
  async finish(pending: PendingSignIn, state: string, query: URLSearchParams): Promise<ExternalIdentity> {
    const error = query.get('error');
    if (error) {
      throw new SsoError(error === 'access_denied' ? 'Sign-in was cancelled' : query.get('error_description') || `Sign-in failed (${error})`);
    }
    return pending.provider === 'oidc' ? this.finishOidc(pending, state, query) : this.finishGithub(pending, query);
  }

  // ---- OpenID Connect

  private oidc(): Promise<oidc.Configuration> {
    const c = this.config.oidc!;
    // Discovered once; a failure (provider down at startup) is retried on the next sign-in.
    this.oidcConfig ??= discover(c, this.log).catch((err) => {
      this.oidcConfig = undefined;
      this.log.error({ err, issuer: c.issuer }, 'OIDC discovery failed');
      throw new SsoError(`${c.name} is not reachable right now`);
    });
    return this.oidcConfig;
  }

  private async finishOidc(pending: PendingSignIn, state: string, query: URLSearchParams): Promise<ExternalIdentity> {
    const cfg = await this.oidc();
    const current = new URL(this.redirectUri('oidc'));
    current.search = query.toString();
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      tokens = await oidc.authorizationCodeGrant(cfg, current, {
        pkceCodeVerifier: pending.codeVerifier,
        expectedState: state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
    } catch (err) {
      this.log.warn({ err }, 'OIDC code exchange failed');
      throw new SsoError(`${this.config.oidc!.name} sign-in failed`);
    }
    const claims = tokens.claims()!;
    let info: Record<string, unknown> = { ...claims };
    // Some providers only put the profile into the userinfo response.
    if (!claims.preferred_username && !claims.email && !claims.name) {
      try {
        info = { ...info, ...(await oidc.fetchUserInfo(cfg, tokens.access_token, claims.sub)) };
      } catch (err) {
        this.log.debug({ err }, 'OIDC userinfo unavailable');
      }
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
    const email = str(info.email);
    const username = str(info.preferred_username) ?? (email ? email.split('@')[0] : undefined);
    return {
      provider: 'oidc',
      subject: `${claims.iss} ${claims.sub}`,
      label: str(info.preferred_username) ?? email ?? claims.sub,
      username,
      displayName: str(info.name) ?? username,
    };
  }

  // ---- GitHub (OAuth 2)

  private github(): GithubConfig {
    return this.config.github!;
  }

  private async finishGithub(pending: PendingSignIn, query: URLSearchParams): Promise<ExternalIdentity> {
    const gh = this.github();
    const code = query.get('code');
    if (!code) throw new SsoError('GitHub sign-in failed (no code)');
    const tokenRes = await fetch(new URL('/login/oauth/access_token', gh.webUrl), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: gh.clientId,
        client_secret: gh.clientSecret,
        code,
        redirect_uri: this.redirectUri('github'),
        code_verifier: pending.codeVerifier,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    }).catch(() => {
      throw new SsoError('GitHub is not reachable right now');
    });
    // GitHub reports errors with HTTP 200 and an `error` field.
    const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!tokenRes.ok || !token.access_token) {
      this.log.warn({ status: tokenRes.status, error: token.error }, 'GitHub code exchange failed');
      throw new SsoError(token.error_description || 'GitHub sign-in failed');
    }
    const userRes = await fetch(new URL('/user', gh.apiUrl), {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token.access_token}`,
        'User-Agent': 'magpie-app',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(HTTP_TIMEOUT),
    }).catch(() => {
      throw new SsoError('GitHub is not reachable right now');
    });
    const user = (await userRes.json().catch(() => ({}))) as { id?: number; login?: string; name?: string | null };
    if (!userRes.ok || typeof user.id !== 'number' || !user.login) throw new SsoError('Could not read the GitHub account');
    return {
      provider: 'github',
      subject: String(user.id),
      label: user.login,
      username: user.login,
      displayName: user.name?.trim() || user.login,
    };
  }

  private remember(state: string, p: PendingSignIn) {
    const now = Date.now();
    for (const [key, value] of this.pending) if (value.expires <= now) this.pending.delete(key);
    // Bounded: abandoned sign-ins cannot grow memory without limit.
    while (this.pending.size >= PENDING_MAX) this.pending.delete(this.pending.keys().next().value!);
    this.pending.set(state, p);
  }
}

async function discover(c: OidcConfig, log: FastifyBaseLogger): Promise<oidc.Configuration> {
  const issuer = new URL(c.issuer);
  // Plain-HTTP issuers (e.g. a provider on the LAN) work, but tokens then travel unencrypted.
  const insecure = issuer.protocol === 'http:';
  if (insecure) log.warn({ issuer: c.issuer }, 'OIDC issuer uses plain HTTP');
  const cfg = await oidc.discovery(
    issuer,
    c.clientId,
    c.clientSecret,
    c.clientSecret ? undefined : oidc.None(),
    { ...(insecure && { execute: [oidc.allowInsecureRequests] }), timeout: HTTP_TIMEOUT / 1000 },
  );
  log.info({ issuer: c.issuer }, 'OIDC provider discovered');
  return cfg;
}
