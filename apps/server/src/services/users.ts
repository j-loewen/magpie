import { and, count, eq, sql } from 'drizzle-orm';
import {
  DEFAULT_PREFS,
  type AdminCreateUserInput,
  type IdentityDto,
  type SsoProvider,
  type RegisterInput,
  type Role,
  type UpdatePrefsInput,
  type UserDto,
} from '@notes/shared';
import type { Db } from '../db';
import { userIdentities, users, type UserRow } from '../db/schema';
import type { ExternalIdentity } from '../auth/sso';
import { hashPassword } from '../auth/password';
import { conflict, forbidden, notFound } from '../lib/errors';

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    prefs: { ...DEFAULT_PREFS, ...row.prefs },
    hasPassword: row.passwordHash !== '',
    createdAt: row.createdAt.toISOString(),
  };
}

export const countUsers = (db: Db) => db.select({ n: count() }).from(users).get()?.n ?? 0;
const countAdmins = (db: Db) =>
  db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()?.n ?? 0;

export const findUserByUsername = (db: Db, username: string) =>
  db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .get();

export const findUserById = (db: Db, id: string) => db.select().from(users).where(eq(users.id, id)).get();

export const listUsers = (db: Db) => db.select().from(users).orderBy(users.createdAt).all();

function insertUser(db: Db, input: { username: string; displayName?: string; passwordHash: string; role: Role }) {
  if (findUserByUsername(db, input.username)) throw conflict('Username is already taken');
  return db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      username: input.username,
      displayName: input.displayName || input.username,
      passwordHash: input.passwordHash,
      role: input.role,
    })
    .returning()
    .get();
}

/**
 * Public sign-up. The first account ever created becomes admin; after that, sign-up is only
 * possible when ALLOW_REGISTRATION is on. Count + insert run in one transaction so two
 * simultaneous first sign-ups cannot both become admin.
 */
export async function registerUser(db: Db, input: RegisterInput, allowRegistration: boolean) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(
    (tx) => {
      const isFirst = countUsers(tx as unknown as Db) === 0;
      if (!isFirst && !allowRegistration) throw forbidden('Registration is disabled');
      return insertUser(tx as unknown as Db, { ...input, passwordHash, role: isFirst ? 'admin' : 'user' });
    },
    { behavior: 'immediate' },
  );
}

export async function adminCreateUser(db: Db, input: AdminCreateUserInput) {
  const passwordHash = await hashPassword(input.password);
  return insertUser(db, { ...input, passwordHash });
}

/** Guard used by demote and delete: there must always be at least one admin left. */
function assertNotLastAdmin(db: Db, target: UserRow) {
  if (target.role === 'admin' && countAdmins(db) <= 1) {
    throw conflict('The last remaining admin cannot be demoted or deleted');
  }
}

export async function adminUpdateUser(
  db: Db,
  id: string,
  patch: { role?: Role; displayName?: string; password?: string },
) {
  const target = findUserById(db, id);
  if (!target) throw notFound('User not found');
  if (patch.role === 'user') assertNotLastAdmin(db, target);
  const passwordHash = patch.password ? await hashPassword(patch.password) : undefined;
  return db
    .update(users)
    .set({
      ...(patch.role && { role: patch.role }),
      ...(patch.displayName && { displayName: patch.displayName }),
      ...(passwordHash && { passwordHash }),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning()
    .get();
}

export function adminDeleteUser(db: Db, id: string, actingUserId: string) {
  if (id === actingUserId) throw forbidden('You cannot delete your own account here');
  const target = findUserById(db, id);
  if (!target) throw notFound('User not found');
  assertNotLastAdmin(db, target);
  db.delete(users).where(eq(users.id, id)).run();
}

export function updatePrefs(db: Db, user: UserRow, patch: UpdatePrefsInput) {
  return db
    .update(users)
    .set({ prefs: { ...user.prefs, ...patch }, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning()
    .get();
}

export async function changePassword(db: Db, userId: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId)).run();
}

// ---- Sign-in providers (OIDC, GitHub) ------------------------------------------------------

export const findIdentity = (db: Db, provider: SsoProvider, subject: string) =>
  db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.provider, provider), eq(userIdentities.subject, subject)))
    .get();

export const listIdentities = (db: Db, userId: string): IdentityDto[] =>
  db
    .select()
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId))
    .orderBy(userIdentities.createdAt)
    .all()
    .map((i) => ({ provider: i.provider, label: i.label, createdAt: i.createdAt.toISOString() }));

/** A free username based on what the provider suggests ("Jane Doe" → "Jane.Doe", then "Jane.Doe-2", …). */
function freeUsername(db: Db, suggestion: string | undefined): string {
  let base = (suggestion ?? '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 28);
  if (base.length < 3) base = `user${base}`.slice(0, 28).padEnd(4, '0');
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!findUserByUsername(db, name)) return name;
  }
}

/**
 * New account for someone signing in through a provider for the first time. Same rules as public
 * sign-up: the first account becomes admin, later ones need ALLOW_REGISTRATION. No password is
 * set (an empty hash never verifies); one can be added in Settings.
 */
export function registerSsoUser(db: Db, identity: ExternalIdentity, allowRegistration: boolean) {
  return db.transaction(
    (tx) => {
      const t = tx as unknown as Db;
      const isFirst = countUsers(t) === 0;
      if (!isFirst && !allowRegistration) return null;
      const username = freeUsername(t, identity.username);
      const user = t
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          username,
          displayName: (identity.displayName || username).slice(0, 64),
          passwordHash: '',
          role: isFirst ? 'admin' : 'user',
        })
        .returning()
        .get();
      t.insert(userIdentities).values({ provider: identity.provider, subject: identity.subject, userId: user.id, label: identity.label }).run();
      return user;
    },
    { behavior: 'immediate' },
  );
}

/** Connect a provider account to a user (Settings → Sign-in methods). */
export function linkIdentity(db: Db, userId: string, identity: ExternalIdentity) {
  const existing = findIdentity(db, identity.provider, identity.subject);
  if (existing?.userId === userId) return;
  if (existing) throw conflict('This account is already connected to another user');
  const mine = db
    .select()
    .from(userIdentities)
    .where(and(eq(userIdentities.userId, userId), eq(userIdentities.provider, identity.provider)))
    .get();
  if (mine) throw conflict('Another account of this provider is already connected; disconnect it first');
  db.insert(userIdentities).values({ provider: identity.provider, subject: identity.subject, userId, label: identity.label }).run();
}

/** Disconnect a provider. Refused when it is the only way left to sign in. */
export function unlinkIdentity(db: Db, user: UserRow, provider: SsoProvider) {
  const all = db.select().from(userIdentities).where(eq(userIdentities.userId, user.id)).all();
  if (!all.some((i) => i.provider === provider)) throw notFound('Not connected');
  if (!user.passwordHash && all.length === 1) {
    throw conflict('Set a password first: otherwise you could no longer sign in');
  }
  db.delete(userIdentities).where(and(eq(userIdentities.userId, user.id), eq(userIdentities.provider, provider))).run();
}
