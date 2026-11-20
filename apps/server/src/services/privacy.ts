import { eq } from 'drizzle-orm';
import type { PrivacyStatusDto, SetSecretInput } from '@notes/shared';
import type { Db } from '../db';
import { folderPrivate, sessions, userPrivacy, type SessionRow, type UserRow } from '../db/schema';
import { hashPassword, verifyPassword } from '../auth/password';
import { badRequest, HttpError } from '../lib/errors';

const MINUTE = 60_000;

const privacyRow = (db: Db, userId: string) => db.select().from(userPrivacy).where(eq(userPrivacy.userId, userId)).get();

export const isUnlocked = (session: SessionRow) =>
  Boolean(session.privateUnlockedUntil && session.privateUnlockedUntil.getTime() > Date.now());

export function privacyStatus(db: Db, user: UserRow, session: SessionRow): PrivacyStatusDto {
  const row = privacyRow(db, user.id);
  const until = row && isUnlocked(session) ? session.privateUnlockedUntil! : null;
  return {
    hasSecret: Boolean(row),
    kind: row?.kind ?? null,
    unlockedUntil: until ? until.toISOString() : null,
    unlockedForMs: until ? Math.max(0, until.getTime() - Date.now()) : null,
    lockedOutUntil: row?.lockedUntil && row.lockedUntil.getTime() > Date.now() ? row.lockedUntil.toISOString() : null,
  };
}

async function confirmAccountPassword(user: UserRow, password: string) {
  // Accounts made through GitHub/OIDC have no password until they set one in Settings.
  if (!user.passwordHash) throw badRequest('Set an account password first (Settings → Password)');
  if (!(await verifyPassword(user.passwordHash, password))) throw badRequest('Your account password is wrong');
}

/** Set or change the PIN/password. Requires the account password, so an unattended session cannot change it. */
export async function setSecret(db: Db, user: UserRow, input: SetSecretInput) {
  await confirmAccountPassword(user, input.accountPassword);
  const secretHash = await hashPassword(input.secret);
  db.insert(userPrivacy)
    .values({ userId: user.id, secretHash, kind: input.kind })
    .onConflictDoUpdate({
      target: userPrivacy.userId,
      set: { secretHash, kind: input.kind, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() },
    })
    .run();
}

/** Removes the PIN; all private folders become normal folders again. */
export async function removeSecret(db: Db, user: UserRow, accountPassword: string) {
  await confirmAccountPassword(user, accountPassword);
  db.transaction((tx) => {
    tx.delete(folderPrivate).where(eq(folderPrivate.userId, user.id)).run();
    tx.delete(userPrivacy).where(eq(userPrivacy.userId, user.id)).run();
    tx.update(sessions).set({ privateUnlockedUntil: null }).where(eq(sessions.userId, user.id)).run();
  });
}

/** Lockout after every 5 wrong attempts in a row: 1, 2, 4, 8 … up to 60 minutes. */
const lockoutMinutes = (failures: number) => Math.min(60, 2 ** (Math.floor(failures / 5) - 1));

export async function unlock(db: Db, user: UserRow, session: SessionRow, secret: string, minutes: number) {
  const row = privacyRow(db, user.id);
  if (!row) throw badRequest('No PIN or password is set for private folders');
  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    const wait = Math.ceil((row.lockedUntil.getTime() - Date.now()) / MINUTE);
    throw new HttpError(429, 'locked_out', `Too many wrong attempts. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
  }
  if (!(await verifyPassword(row.secretHash, secret))) {
    const failures = row.failedAttempts + 1;
    const lockedUntil = failures % 5 === 0 ? new Date(Date.now() + lockoutMinutes(failures) * MINUTE) : row.lockedUntil;
    db.update(userPrivacy).set({ failedAttempts: failures, lockedUntil }).where(eq(userPrivacy.userId, user.id)).run();
    throw badRequest(row.kind === 'pin' ? 'Wrong PIN' : 'Wrong password');
  }
  db.update(userPrivacy).set({ failedAttempts: 0, lockedUntil: null }).where(eq(userPrivacy.userId, user.id)).run();
  return setUnlockedUntil(db, session, new Date(Date.now() + minutes * MINUTE));
}

/** "Keep unlocked": restart the timer, only while still unlocked. */
export function extend(db: Db, session: SessionRow, minutes: number) {
  if (!isUnlocked(session)) throw new HttpError(403, 'locked', 'Private folders are locked');
  return setUnlockedUntil(db, session, new Date(Date.now() + minutes * MINUTE));
}

export const lock = (db: Db, session: SessionRow) => setUnlockedUntil(db, session, null);

function setUnlockedUntil(db: Db, session: SessionRow, until: Date | null) {
  db.update(sessions).set({ privateUnlockedUntil: until }).where(eq(sessions.id, session.id)).run();
  session.privateUnlockedUntil = until;
  return until;
}
