import {
  createContext,
  createMemo,
  createResource,
  type ParentComponent,
  useContext,
} from "solid-js";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import type { Space, User, UserSettings } from "../types/index.ts";
import {
  type AuthActionDeps,
  type AuthSnapshot,
  type AuthState,
  fetchSpaces as fetchSpacesAction,
  type FetchSpacesOptions,
  fetchUserSettings as fetchUserSettingsAction,
  handleLogout as handleLogoutAction,
  INITIAL_AUTH_SNAPSHOT,
  loadAuthSnapshot,
  redirectToLogin,
} from "../store/auth.ts";

export interface AuthContextValue {
  authState: AuthState;
  user: User | null;
  userSettings: UserSettings | null;
  spaces: Space[];
  spacesLoaded: boolean;
  bootstrapError: string | null;
  setUserSettings: (settings: UserSettings | null) => void;
  fetchUser: () => Promise<void>;
  fetchSpaces: (
    currentUser?: User | null,
    options?: FetchSpacesOptions,
  ) => Promise<Space[]>;
  fetchUserSettings: () => Promise<UserSettings | null>;
  handleLogin: (returnTo?: string) => void;
  handleLogout: () => Promise<void>;
  redirectToLogin: (returnTo?: string) => void;
}

const AuthContext = createContext<AuthContextValue>();

function ensureSnapshot(snapshot: AuthSnapshot | undefined): AuthSnapshot {
  return snapshot ?? INITIAL_AUTH_SNAPSHOT;
}

export const AuthProvider: ParentComponent = (props) => {
  const { t } = useI18n();
  const { showToast } = useToast();

  const deps = (): AuthActionDeps => ({ showToast, t });
  const [snapshot, { mutate, refetch }] = createResource(
    async () => await loadAuthSnapshot(deps()),
    { initialValue: INITIAL_AUTH_SNAPSHOT },
  );

  const authSnapshot = createMemo(() => ensureSnapshot(snapshot()));

  const setUserSettings = (settings: UserSettings | null) => {
    mutate((previous) => ({
      ...ensureSnapshot(previous),
      userSettings: settings,
    }));
  };

  const fetchUser = async () => {
    mutate((previous) => ({
      ...ensureSnapshot(previous),
      authState: "loading",
      spacesLoaded: false,
      bootstrapError: null,
    }));
    await refetch();
  };

  const fetchSpaces = async (
    currentUser?: User | null,
    options?: FetchSpacesOptions,
  ) => {
    const snapshotValue = authSnapshot();
    const effectiveUser = currentUser ?? snapshotValue.user;
    const spaces = await fetchSpacesAction(deps(), effectiveUser, options);
    mutate((previous) => ({
      ...ensureSnapshot(previous),
      authState: effectiveUser ? "authenticated" : ensureSnapshot(previous)
        .authState,
      user: effectiveUser ?? ensureSnapshot(previous).user,
      spaces,
      spacesLoaded: true,
    }));
    return spaces;
  };

  const fetchUserSettings = async () => {
    const settings = await fetchUserSettingsAction();
    mutate((previous) => ({
      ...ensureSnapshot(previous),
      userSettings: settings,
    }));
    return settings;
  };

  const handleLogout = async () => {
    await handleLogoutAction();
    mutate(() => ({
      ...INITIAL_AUTH_SNAPSHOT,
      authState: "login",
    }));
  };

  const value: AuthContextValue = {
    get authState() {
      return authSnapshot().authState;
    },
    get user() {
      return authSnapshot().user;
    },
    get userSettings() {
      return authSnapshot().userSettings;
    },
    get spaces() {
      return authSnapshot().spaces;
    },
    get spacesLoaded() {
      return authSnapshot().spacesLoaded;
    },
    get bootstrapError() {
      return authSnapshot().bootstrapError;
    },
    setUserSettings,
    fetchUser,
    fetchSpaces,
    fetchUserSettings,
    handleLogin: (returnTo?: string) => {
      redirectToLogin(returnTo);
    },
    handleLogout,
    redirectToLogin,
  };

  return (
    <AuthContext.Provider value={value}>
      {props.children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
