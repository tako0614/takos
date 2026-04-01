import { atom } from 'jotai/vanilla';
import { rpc, rpcJson } from '../lib/rpc.ts';
import { getErrorMessage } from '../lib/errors.ts';
import { normalizeSpaces } from '../lib/spaces.ts';
import type { TranslationKey, TranslationParams } from './i18n.ts';
import type { User, UserSettings, Space } from '../types/index.ts';

export type AuthState = 'loading' | 'login' | 'authenticated';

export type FetchSpacesOptions = {
  notifyOnError?: boolean;
  throwOnError?: boolean;
};

/** Deps injected from React context hooks that atoms cannot access directly */
export type AuthActionDeps = {
  showToast: (type: 'error' | 'success', message: string) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

// ---------------------------------------------------------------------------
// Primitive atoms
// ---------------------------------------------------------------------------

export const authStateAtom = atom<AuthState>('loading');
export const userAtom = atom<User | null>(null);
export const userSettingsAtom = atom<UserSettings | null>(null);
export const spacesAtom = atom<Space[]>([]);
export const spacesLoadedAtom = atom<boolean>(false);

// ---------------------------------------------------------------------------
// Write atoms (actions)
// ---------------------------------------------------------------------------

export const fetchUserSettingsAtom = atom(
  null,
  async (_get, set): Promise<UserSettings | null> => {
    try {
      const res = await rpc.me.settings.$get();
      const data = await rpcJson<UserSettings>(res);
      set(userSettingsAtom, data);
      return data;
    } catch {
      return null;
    }
  },
);

export const fetchSpacesAtom = atom(
  null,
  async (
    _get,
    set,
    {
      currentUser,
      options,
      deps,
    }: {
      currentUser?: User | null;
      options?: FetchSpacesOptions;
      deps: AuthActionDeps;
    },
  ): Promise<Space[]> => {
    const { notifyOnError = true, throwOnError = false } = options ?? {};

    try {
      const res = await rpc.spaces.$get();
      const data = await rpcJson<{ spaces: Space[] }>(res);
      let allSpaces = normalizeSpaces(data.spaces || []);

      const hasPersonal = allSpaces.some((w) => w.kind === 'user');
      if (!hasPersonal && currentUser) {
        const virtualPersonal: Space = {
          id: currentUser.username,
          name: currentUser.name || currentUser.username,
          slug: currentUser.username,
          description: null,
          kind: 'user',
          is_personal: true,
          owner_principal_id: currentUser.username,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        allSpaces = [virtualPersonal, ...allSpaces];
      }

      set(spacesAtom, allSpaces);
      return allSpaces;
    } catch (error) {
      if (notifyOnError) {
        deps.showToast('error', getErrorMessage(error, deps.t('failedToLoad') || 'Failed to load'));
      }
      if (throwOnError) {
        throw error;
      }
      return [];
    } finally {
      set(spacesLoadedAtom, true);
    }
  },
);

export const fetchUserAtom = atom(
  null,
  async (_get, set, deps: AuthActionDeps): Promise<void> => {
    set(spacesLoadedAtom, false);
    try {
      const res = await rpc.me.$get();
      if (res.ok) {
        const data = await rpcJson<User>(res);
        set(userAtom, data);
        set(authStateAtom, 'authenticated');
        await Promise.all([
          set(fetchSpacesAtom, { currentUser: data, deps }),
          set(fetchUserSettingsAtom),
        ]);
      } else {
        set(spacesLoadedAtom, false);
        set(authStateAtom, 'login');
      }
    } catch {
      set(spacesLoadedAtom, false);
      set(authStateAtom, 'login');
    }
  },
);

export const handleLogoutAtom = atom(
  null,
  async (_get, set): Promise<void> => {
    await fetch('/auth/logout', { method: 'POST' });
    set(userAtom, null);
    set(spacesAtom, []);
    set(spacesLoadedAtom, false);
    set(authStateAtom, 'login');
  },
);

// ---------------------------------------------------------------------------
// Plain helpers
// ---------------------------------------------------------------------------

export function redirectToLogin(returnTo?: string): void {
  const url = new URL('/auth/login', globalThis.location.origin);
  if (returnTo) {
    url.searchParams.set('return_to', returnTo);
  }
  globalThis.location.href = url.toString();
}
