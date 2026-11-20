import { z } from 'zod';
import { passwordSchema, usernameSchema } from './auth';

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

const prefFields = {
  theme: z.enum(THEMES),
  /** How long private folders stay visible after unlocking, in minutes. */
  unlockMinutes: z.number().int().min(1).max(24 * 60),
};

export const userPrefsSchema = z.object({
  theme: prefFields.theme.default('system'),
  unlockMinutes: prefFields.unlockMinutes.default(10),
});
export type UserPrefs = z.infer<typeof userPrefsSchema>;
export const DEFAULT_PREFS: UserPrefs = userPrefsSchema.parse({});

// Built from the fields without defaults: zod 4 fills defaults into missing keys even after
// .partial(), so a patch of one preference would reset the others.
export const updatePrefsSchema = z.object(prefFields).partial();
export type UpdatePrefsInput = z.infer<typeof updatePrefsSchema>;

export interface UserDto {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  prefs: UserPrefs;
  /** False for accounts created through a sign-in provider that never set a password. */
  hasPassword: boolean;
  createdAt: string;
}

export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(64).optional(),
  role: z.enum(ROLES).default('user'),
});
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

export const adminUpdateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  displayName: z.string().trim().min(1).max(64).optional(),
  /** Admin password reset; logs the user out everywhere. */
  password: passwordSchema.optional(),
});
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export const changePasswordSchema = z.object({
  /** Required when the account has a password (accounts made through GitHub/OIDC may have none). */
  currentPassword: z.string().optional(),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(64),
});

export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}
