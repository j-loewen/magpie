import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  host: string;
  port: number;
  /** Directory holding app.db and uploaded files. */
  dataDir: string;
  /** SQLite file path, or ':memory:' (tests). Defaults to <dataDir>/app.db. */
  databasePath: string;
  /** ALLOW_REGISTRATION env. The very first account can always register. */
  allowRegistration: boolean;
  baseUrl: string | undefined;
  cookieSecure: boolean;
  sessionDays: number;
  /** Trashed items are deleted permanently after this many days. */
  trashDays: number;
  trustProxy: boolean;
  /** Fetch page title, description, image and JSON-LD for link notes. */
  linkPreviews: boolean;
  /** Allow link previews of private/LAN addresses (off by default: SSRF protection). */
  linkPreviewAllowLan: boolean;
  /** FlareSolverr base URL; pages refused by bot protection are fetched through it. */
  flaresolverrUrl: string | undefined;
  /**
   * Secret that encrypts the database and stored files (ENCRYPTION_KEY, or read from the file in
   * ENCRYPTION_KEY_FILE). Required in production; without it (dev, tests) data is stored plain.
   */
  encryptionKey: string | undefined;
  /** Live-refresh stream heartbeat (ms); also how quickly a stream ends after logout. */
  liveHeartbeatMs: number;
  /** Sign-in with an OpenID Connect provider (Authentik, Keycloak, Google, Entra ID, …). */
  oidc: OidcConfig | undefined;
  /** Sign-in with GitHub (OAuth app). */
  github: GithubConfig | undefined;
  /** Built SPA to serve; undefined = API only (dev uses the Vite dev server). */
  webDist: string | undefined;
  logLevel: string;
}

export interface OidcConfig {
  issuer: string;
  clientId: string;
  /** Omit for public clients (PKCE only). */
  clientSecret: string | undefined;
  /** Provider name on the sign-in button, e.g. "Authentik". */
  name: string;
  scopes: string;
}

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  /** github.com and its API; only changed by tests. */
  webUrl: string;
  apiUrl: string;
}

/** Sign-in providers need BASE_URL: it is part of the redirect address registered with them. */
function ssoConfig(env: NodeJS.ProcessEnv, baseUrl: string | undefined) {
  const issuer = env.OIDC_ISSUER?.trim();
  const oidcId = env.OIDC_CLIENT_ID?.trim();
  const githubId = env.GITHUB_CLIENT_ID?.trim();
  const githubSecret = env.GITHUB_CLIENT_SECRET?.trim();
  let oidc: OidcConfig | undefined;
  let github: GithubConfig | undefined;
  if (issuer || oidcId) {
    if (!issuer || !oidcId) console.warn('OIDC sign-in disabled: set both OIDC_ISSUER and OIDC_CLIENT_ID');
    else if (!baseUrl) console.warn('OIDC sign-in disabled: BASE_URL is required');
    else {
      oidc = {
        issuer,
        clientId: oidcId,
        clientSecret: env.OIDC_CLIENT_SECRET?.trim() || undefined,
        name: env.OIDC_NAME?.trim() || 'Single sign-on',
        scopes: env.OIDC_SCOPES?.trim() || 'openid profile email',
      };
    }
  }
  if (githubId || githubSecret) {
    if (!githubId || !githubSecret) console.warn('GitHub sign-in disabled: set both GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET');
    else if (!baseUrl) console.warn('GitHub sign-in disabled: BASE_URL is required');
    else {
      github = {
        clientId: githubId,
        clientSecret: githubSecret,
        webUrl: (env.GITHUB_URL?.trim() || 'https://github.com').replace(/\/+$/, ''),
        apiUrl: (env.GITHUB_API_URL?.trim() || 'https://api.github.com').replace(/\/+$/, ''),
      };
    }
  }
  return { oidc, github };
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function httpUrl(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  try {
    const url = new URL(v);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    // Fall through.
  }
  console.warn(`Ignoring FLARESOLVERR_URL: "${v}" is not an http(s) URL`);
  return undefined;
}

/** Shortest accepted encryption key (`openssl rand -hex 32` gives 64 characters). */
export const MIN_KEY_LENGTH = 32;

function encryptionKey(env: NodeJS.ProcessEnv): string | undefined {
  const file = env.ENCRYPTION_KEY_FILE?.trim();
  let key = env.ENCRYPTION_KEY?.trim() || undefined;
  if (file) {
    try {
      key = fs.readFileSync(file, 'utf8').trim();
    } catch (err) {
      throw new Error(`Cannot read ENCRYPTION_KEY_FILE (${file}): ${(err as Error).message}`);
    }
  }
  if (key === undefined || key === '') {
    if (env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY is required: it encrypts the database and stored files. Generate one with: openssl rand -hex 32');
    }
    return undefined;
  }
  if (key.length < MIN_KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY is too short: use at least ${MIN_KEY_LENGTH} characters (openssl rand -hex 32)`);
  }
  return key;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.DATA_DIR ?? './data');
  const baseUrl = env.BASE_URL?.trim() || undefined;
  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 3000),
    dataDir,
    databasePath: env.DATABASE_PATH ?? path.join(dataDir, 'app.db'),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    baseUrl,
    cookieSecure: bool(env.COOKIE_SECURE, baseUrl?.startsWith('https://') ?? false),
    sessionDays: int(env.SESSION_DAYS, 30),
    trashDays: Math.max(1, int(env.TRASH_DAYS, 30)),
    trustProxy: bool(env.TRUST_PROXY, false),
    linkPreviews: bool(env.LINK_PREVIEWS, true),
    linkPreviewAllowLan: bool(env.LINK_PREVIEW_ALLOW_LAN, false),
    flaresolverrUrl: httpUrl(env.FLARESOLVERR_URL),
    encryptionKey: encryptionKey(env),
    liveHeartbeatMs: Math.max(50, int(env.LIVE_HEARTBEAT_MS, 25_000)),
    ...ssoConfig(env, baseUrl),
    webDist: env.WEB_DIST,
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
