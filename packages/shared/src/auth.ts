import { z } from 'zod';

/** Header every mutating request must carry (CSRF defence together with SameSite cookies). */
export const CSRF_HEADER = 'x-notes-client';
export const CSRF_HEADER_VALUE = '1';

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(32, 'At most 32 characters')
  .regex(/^[a-zA-Z0-9._-]+$/, 'Only letters, digits, dot, dash and underscore');

export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(256, 'At most 256 characters');

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(64).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthStatus {
  /** True when no account exists yet: the next registration becomes admin. */
  needsSetup: boolean;
  /** True when the sign-up page may be used right now. */
  registrationOpen: boolean;
  /** Sign-in providers configured on this server. */
  providers: SsoProviderDto[];
}

// ---- Sign-in with OpenID Connect / GitHub ----------------------------------------------

export const SSO_PROVIDERS = ['oidc', 'github'] as const;
export type SsoProvider = (typeof SSO_PROVIDERS)[number];

export interface SsoProviderDto {
  id: SsoProvider;
  /** Button label, e.g. "GitHub" or the OIDC_NAME setting. */
  name: string;
}

export const ssoStartSchema = z.object({
  /** login: sign in (or sign up) · link: connect the provider account to the signed-in user. */
  mode: z.enum(['login', 'link']),
  /** Where to go after signing in: a path within the app. */
  returnTo: z.string().max(500).optional(),
});
export type SsoStartInput = z.infer<typeof ssoStartSchema>;

/** A provider account connected to my account (Settings → Sign-in methods). */
export interface IdentityDto {
  provider: SsoProvider;
  /** Account name at the provider, e.g. the GitHub login or an email address. */
  label: string;
  createdAt: string;
}
