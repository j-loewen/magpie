import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthStatus, LoginInput, RegisterInput, SsoProvider, UpdatePrefsInput, UserDto } from '@notes/shared';
import { api, ApiError } from './api';

export const meKey = ['me'] as const;

/** Current user, or null when logged out. */
export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await api<UserDto>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

export function useAuthStatus() {
  return useQuery({ queryKey: ['auth-status'], queryFn: () => api<AuthStatus>('/api/auth/status') });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) => api<UserDto>('/api/auth/login', 'POST', input),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterInput) => api<UserDto>('/api/auth/register', 'POST', input),
    onSuccess: (user) => {
      qc.setQueryData(meKey, user);
      void qc.invalidateQueries({ queryKey: ['auth-status'] });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/api/auth/logout', 'POST'),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(meKey, null);
    },
  });
}

export function useUpdatePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdatePrefsInput) => api<UserDto>('/api/me/prefs', 'PATCH', patch),
    onMutate: (patch) => {
      // Optimistic, so the theme switches instantly.
      const prev = qc.getQueryData<UserDto | null>(meKey);
      if (prev) qc.setQueryData(meKey, { ...prev, prefs: { ...prev.prefs, ...patch } });
      return { prev };
    },
    onError: (_err, _patch, ctx) => ctx?.prev && qc.setQueryData(meKey, ctx.prev),
    onSuccess: (user) => qc.setQueryData(meKey, user),
  });
}

/**
 * Go to the provider's sign-in page. `login` signs in (or up); `link` connects the provider
 * account to the signed-in user. The provider sends the browser back to the server, which
 * redirects into the app (with ?sso_error=… if something went wrong).
 */
export async function startSso(provider: SsoProvider, mode: 'login' | 'link', returnTo?: string) {
  const { url } = await api<{ url: string }>(`/api/auth/sso/${provider}/start`, 'POST', { mode, returnTo });
  window.location.assign(url);
}
