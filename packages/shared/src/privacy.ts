import { z } from 'zod';

export const SECRET_KINDS = ['pin', 'password'] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

const pin = z.string().regex(/^\d{4,12}$/, 'A PIN is 4 to 12 digits');
const password = z.string().min(4, 'At least 4 characters').max(128, 'At most 128 characters');

/** Set or change the private-folder secret. Always confirmed with the account password. */
export const setSecretSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pin'), secret: pin, accountPassword: z.string().min(1) }),
  z.object({ kind: z.literal('password'), secret: password, accountPassword: z.string().min(1) }),
]);
export type SetSecretInput = z.infer<typeof setSecretSchema>;

export const removeSecretSchema = z.object({ accountPassword: z.string().min(1) });

export const unlockSchema = z.object({ secret: z.string().min(1).max(128) });

export interface PrivacyStatusDto {
  /** A PIN/password is set, so folders can be made private. */
  hasSecret: boolean;
  kind: SecretKind | null;
  /** Private folders are visible in this session until then (server clock); null = locked. */
  unlockedUntil: string | null;
  /**
   * Milliseconds left until they lock, as of the response. Clients count down from this rather than
   * from unlockedUntil, so a browser clock that differs from the server's does not shift the timer.
   */
  unlockedForMs: number | null;
  /** Wrong PINs locked unlocking until then. */
  lockedOutUntil: string | null;
}
