import { useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useI18n } from '../store/i18n';
import { useToast } from '../store/toast';
import type { User, Space, UserSettings } from '../types';
import {
  authStateAtom,
  userAtom,
  userSettingsAtom,
  spacesAtom,
  spacesLoadedAtom,
  fetchUserAtom,
  fetchSpacesAtom,
  fetchUserSettingsAtom,
  handleLogoutAtom,
  redirectToLogin,
  type AuthState,
  type AuthActionDeps,
  type FetchSpacesOptions,
} from '../store/auth';

export interface AuthContextValue {
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

  const dispatchFetchUser = useSetAtom(fetchUserAtom);
  const dispatchFetchSpaces = useSetAtom(fetchSpacesAtom);
  const dispatchFetchUserSettings = useSetAtom(fetchUserSettingsAtom);
  const dispatchLogout = useSetAtom(handleLogoutAtom);

  const { t } = useI18n();
  const { showToast } = useToast();

  const deps: AuthActionDeps = useMemo(() => ({ showToast, t }), [showToast, t]);

  const fetchUser = useCallback(
    () => dispatchFetchUser(deps),
    [dispatchFetchUser, deps],
  );

  const fetchSpaces = useCallback(
    (currentUser?: User | null, options?: FetchSpacesOptions) =>
      dispatchFetchSpaces({ currentUser, options, deps }),
    [dispatchFetchSpaces, deps],
  );

  const fetchUserSettings = useCallback(
    () => dispatchFetchUserSettings(),
    [dispatchFetchUserSettings],
  );

  const handleLogin = useCallback(() => {
    redirectToLogin();
  }, []);

  const handleLogout = useCallback(
    () => dispatchLogout(),
    [dispatchLogout],
  );

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
