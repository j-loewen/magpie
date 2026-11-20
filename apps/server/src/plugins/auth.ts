import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@notes/shared';
import type { AppConfig } from '../config';
import type { Db } from '../db';
import { getSession, SESSION_COOKIE, type ActiveSession } from '../auth/sessions';
import { forbidden, unauthorized } from '../lib/errors';
import type { Viewer } from '../services/access';
import { isUnlocked } from '../services/privacy';

declare module 'fastify' {
  interface FastifyRequest {
    auth: ActiveSession | null;
    sessionToken: string | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string, expires: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    expires,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
}

/** Returns the logged-in session or throws 401. */
export function requireUser(req: FastifyRequest): ActiveSession {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** The logged-in user as seen by access checks: their id and whether private folders are unlocked. */
export function requireViewer(req: FastifyRequest): Viewer {
  const { user, session } = requireUser(req);
  return { id: user.id, unlocked: isUnlocked(session) };
}

/** Returns the logged-in admin session or throws 401/403. */
export function requireAdmin(req: FastifyRequest): ActiveSession {
  const auth = requireUser(req);
  if (auth.user.role !== 'admin') throw forbidden('Admin only');
  return auth;
}

async function authPlugin(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;
  app.decorateRequest('auth', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;

    // CSRF: browsers cannot add a custom header cross-site without a CORS preflight, which we never allow.
    if (!SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      throw forbidden('Missing client header');
    }

    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const auth = getSession(db, token, config.sessionDays);
    if (!auth) {
      clearSessionCookie(reply, config);
      return;
    }
    req.auth = auth;
    req.sessionToken = token;
    if (auth.renewedUntil) setSessionCookie(reply, config, token, auth.renewedUntil);
  });
}

export default fp(authPlugin, { name: 'auth', dependencies: ['@fastify/cookie'] });
