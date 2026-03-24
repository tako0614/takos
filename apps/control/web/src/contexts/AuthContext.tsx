import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { rpc, rpcJson } from '../lib/rpc';
import { getErrorMessage } from '../lib/errors';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from '../hooks/useToast';
import type { User, UserSettings, Workspace } from '../types';
import { normalizeWorkspaces } from '../lib/workspaces';
import {
  authStateAtom,
  userAtom,
  userSettingsAtom,
  workspacesAtom,
  workspacesLoadedAtom,
  redirectToLogin,
  type AuthState,
  type FetchWorkspacesOptions,
} from '../store/auth';

interface AuthContextValue {
  authState: AuthState;
  user: User | null;
  userSettings: UserSettings | null;
  workspaces: Workspace[];
  workspacesLoaded: boolean;
  setUserSettings: (settings: UserSettings | null) => void;
  fetchUser: () => Promise<void>;
  fetchWorkspaces: (currentUser?: User | null, options?: FetchWorkspacesOptions) => Promise<Workspace[]>;
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
  const workspaces = useAtomValue(workspacesAtom);
  const workspacesLoaded = useAtomValue(workspacesLoadedAtom);

  const setAuthState = useSetAtom(authStateAtom);
  const setUser = useSetAtom(userAtom);
  const setWorkspaces = useSetAtom(workspacesAtom);
  const setWorkspacesLoaded = useSetAtom(workspacesLoadedAtom);
  const setUserSettingsAtom = useSetAtom(userSettingsAtom);

  const { t } = useI18n();
  const { showToast } = useToast();

  const fetchWorkspaces = useCallback(async (
    currentUser?: User | null,
    options?: FetchWorkspacesOptions,
  ): Promise<Workspace[]> => {
    const {
      notifyOnError = true,
      throwOnError = false,
    } = options ?? {};

    try {
      const res = await rpc.spaces.$get();
      const data = await rpcJson<{ spaces: Workspace[] }>(res);
      let allWorkspaces = normalizeWorkspaces(data.spaces || []);

      const hasPersonal = allWorkspaces.some((w) => w.kind === 'user');
      if (!hasPersonal && currentUser) {
        const virtualPersonal: Workspace = {
          id: currentUser.username,
          name: currentUser.name || currentUser.username,
          slug: currentUser.username,
          description: null,
          kind: 'user',
          is_personal: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        allWorkspaces = [virtualPersonal, ...allWorkspaces];
      }

      setWorkspaces(allWorkspaces);
      return allWorkspaces;
    } catch (error) {
      if (notifyOnError) {
        showToast('error', getErrorMessage(error, t('failedToLoad') || 'Failed to load'));
      }
      if (throwOnError) {
        throw error;
      }
      return [];
    } finally {
      setWorkspacesLoaded(true);
    }
  }, [showToast, t, setWorkspaces, setWorkspacesLoaded]);

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
    setWorkspacesLoaded(false);
    try {
      const res = await rpc.me.$get();
      if (res.ok) {
        const data = await rpcJson<User>(res);
        setUser(data);
        setAuthState('authenticated');
        await Promise.all([
          fetchWorkspaces(data),
          fetchUserSettings(),
        ]);
      } else {
        setWorkspacesLoaded(false);
        setAuthState('login');
      }
    } catch {
      setWorkspacesLoaded(false);
      setAuthState('login');
    }
  }, [fetchWorkspaces, fetchUserSettings, setUser, setAuthState, setWorkspacesLoaded]);

  const handleLogin = useCallback(() => {
    redirectToLogin();
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST' });
    setUser(null);
    setWorkspaces([]);
    setWorkspacesLoaded(false);
    setAuthState('login');
  }, [setUser, setWorkspaces, setWorkspacesLoaded, setAuthState]);

  return useMemo((): AuthContextValue => ({
    authState,
    user,
    userSettings,
    workspaces,
    workspacesLoaded,
    setUserSettings,
    fetchUser,
    fetchWorkspaces,
    fetchUserSettings,
    handleLogin,
    handleLogout,
    redirectToLogin,
  }), [
    authState,
    user,
    userSettings,
    workspaces,
    workspacesLoaded,
    setUserSettings,
    fetchUser,
    fetchWorkspaces,
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
