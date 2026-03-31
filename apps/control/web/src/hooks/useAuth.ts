import { useAtomValue, useSetAtom } from 'solid-jotai';
import { useI18n } from '../store/i18n.ts';
import { useToast } from '../store/toast.ts';
import type { User, Space, UserSettings } from '../types/index.ts';
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
} from '../store/auth.ts';

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

  const deps: AuthActionDeps = { showToast, t };

  const fetchUser = () => dispatchFetchUser(deps);

  const fetchSpaces = (currentUser?: User | null, options?: FetchSpacesOptions) =>
    dispatchFetchSpaces({ currentUser, options, deps });

  const fetchUserSettings = () => dispatchFetchUserSettings();

  const handleLogin = () => {
    redirectToLogin();
  };

  const handleLogout = () => dispatchLogout();

  return {
    get authState() { return authState(); },
    get user() { return user(); },
    get userSettings() { return userSettings(); },
    get spaces() { return spaces(); },
    get spacesLoaded() { return spacesLoaded(); },
    setUserSettings,
    fetchUser,
    fetchSpaces,
    fetchUserSettings,
    handleLogin,
    handleLogout,
    redirectToLogin,
  };
}
