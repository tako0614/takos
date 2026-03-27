import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { rpc, rpcJson } from '../lib/rpc';
import { getErrorMessage } from '../lib/errors';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from '../hooks/useToast';
import type { User, UserSettings, Space } from '../types';
import { normalizeSpaces } from '../lib/spaces';
import {
  authStateAtom,
  userAtom,
  userSettingsAtom,
  spacesAtom,
  spacesLoadedAtom,
  redirectToLogin,
  type AuthState,
  type FetchSpacesOptions,
} from '../store/auth';

interface AuthContextValue {
  authState: AuthState;
  user: User | null;
  userSettings: UserSettings | null;
  spaces: Space[];
  spacesLoaded: boolean;
  setUserSettings: (settings: UserSettings | null) => void;
  fetchUser: () => Promise<void>;
  fetchSpaces: (currentUser?: User | null, options?: FetchSpacesOptions) => Promise<Space[]>;
  fetchUserSettings: () => Promise<UserSettings | null>;
  handleLogin: () => void;
  handleLogout: () => Promise<void>;
  redirectToLogin: (returnTo?: string) => void;
}

export function useAuth(): AuthContextValue {
  const authState = useAtomValue(authStateAtom);
  const user = useAtomValue(userAtom);
  const userSettings = useAtomValue(userSettingsAtom);
  const setUserSettings = useSetAtom(userSettingsAtom);
  const spaces = useAtomValue(spacesAtom);
  const spacesLoaded = useAtomValue(spacesLoadedAtom);

  const setAuthState = useSetAtom(authStateAtom);
  const setUser = useSetAtom(userAtom);
  const setSpaces = useSetAtom(spacesAtom);
  const setSpacesLoaded = useSetAtom(spacesLoadedAtom);
  const setUserSettingsAtom = useSetAtom(userSettingsAtom);

  const { t } = useI18n();
  const { showToast } = useToast();

  const fetchSpaces = useCallback(async (
    currentUser?: User | null,
    options?: FetchSpacesOptions,
  ): Promise<Space[]> => {
    const {
      notifyOnError = true,
      throwOnError = false,
    } = options ?? {};

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
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        allSpaces = [virtualPersonal, ...allSpaces];
      }

      setSpaces(allSpaces);
      return allSpaces;
    } catch (error) {
      if (notifyOnError) {
        showToast('error', getErrorMessage(error, t('failedToLoad') || 'Failed to load'));
      }
      if (throwOnError) {
        throw error;
      }
      return [];
    } finally {
      setSpacesLoaded(true);
    }
  }, [showToast, t, setSpaces, setSpacesLoaded]);

  const fetchUserSettings = useCallback(async (): Promise<UserSettings | null> => {
    try {
      const res = await rpc.me.settings.$get();
      const data = await rpcJson<UserSettings>(res);
      setUserSettingsAtom(data);
      return data;
    } catch {
      return null;
    }
  }, [setUserSettingsAtom]);

  const fetchUser = useCallback(async () => {
    setSpacesLoaded(false);
    try {
      const res = await rpc.me.$get();
      if (res.ok) {
        const data = await rpcJson<User>(res);
        setUser(data);
        setAuthState('authenticated');
        await Promise.all([
          fetchSpaces(data),
          fetchUserSettings(),
        ]);
      } else {
        setSpacesLoaded(false);
        setAuthState('login');
      }
    } catch {
      setSpacesLoaded(false);
      setAuthState('login');
    }
  }, [fetchSpaces, fetchUserSettings, setUser, setAuthState, setSpacesLoaded]);

  const handleLogin = useCallback(() => {
    redirectToLogin();
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
    setSpaces([]);
    setSpacesLoaded(false);
    setAuthState('login');
  }, [setUser, setSpaces, setSpacesLoaded, setAuthState]);

  return useMemo((): AuthContextValue => ({
    authState,
    user,
    userSettings,
    spaces,
    spacesLoaded,
    setUserSettings,
    fetchUser,
    fetchSpaces,
    fetchUserSettings,
    handleLogin,
    handleLogout,
    redirectToLogin,
  }), [
    authState,
    user,
    userSettings,
    spaces,
    spacesLoaded,
    setUserSettings,
    fetchUser,
    fetchSpaces,
    fetchUserSettings,
    handleLogin,
    handleLogout,
  ]);
}

/** Jotai atoms are global — AuthProvider fetches user on mount for initialization */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { fetchUser } = useAuth();
  useEffect(() => {
    fetchUser();
  }, []);
  return <>{children}</>;
}

/** Initialization component — call fetchUser on mount */
export function AuthInit() {
  const { fetchUser } = useAuth();
  useEffect(() => {
    fetchUser();
  }, []);
  return null;
}
