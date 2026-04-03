import { rpcJson } from "../lib/rpc.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { withTimeout } from "../lib/withTimeout.ts";
import { normalizeSpaces } from "../lib/spaces.ts";
import type { TranslationKey, TranslationParams } from "./i18n.ts";
import type { Space, User, UserSettings } from "../types/index.ts";

export type AuthState = "loading" | "login" | "authenticated";

export type FetchSpacesOptions = {
  notifyOnError?: boolean;
  throwOnError?: boolean;
};

export type AuthActionDeps = {
  showToast: (type: "error" | "success", message: string) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export interface AuthSnapshot {
  authState: AuthState;
  user: User | null;
  userSettings: UserSettings | null;
  spaces: Space[];
  spacesLoaded: boolean;
  bootstrapError: string | null;
}

const AUTH_BOOT_TIMEOUT_MS = 10000;

export const INITIAL_AUTH_SNAPSHOT: AuthSnapshot = {
  authState: "loading",
  user: null,
  userSettings: null,
  spaces: [],
  spacesLoaded: false,
  bootstrapError: null,
};

async function fetchApi(
  path: string,
  timeoutMs = AUTH_BOOT_TIMEOUT_MS,
): Promise<Response> {
  return await withTimeout(
    (signal) =>
      fetch(path, {
        headers: { Accept: "application/json" },
        signal,
      }),
    timeoutMs,
    "Request timed out",
  );
}

async function readApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const data = await response.clone().json() as { error?: string };
    if (typeof data.error === "string" && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore malformed error bodies and fall back to a generic message.
  }
  return fallback;
}

function buildVirtualPersonalSpace(currentUser: User): Space {
  const timestamp = new Date().toISOString();
  return {
    id: currentUser.username,
    name: currentUser.name || currentUser.username,
    slug: currentUser.username,
    description: null,
    kind: "user",
    is_personal: true,
    owner_principal_id: currentUser.username,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export async function fetchUserSettings(): Promise<UserSettings | null> {
  try {
    const res = await fetchApi("/api/me/settings");
    return await rpcJson<UserSettings>(res);
  } catch {
    return null;
  }
}

export async function fetchSpaces(
  deps: AuthActionDeps,
  currentUser?: User | null,
  options?: FetchSpacesOptions,
): Promise<Space[]> {
  const { notifyOnError = true, throwOnError = false } = options ?? {};

  try {
    const res = await fetchApi("/api/spaces");
    const data = await rpcJson<{ spaces: Space[] }>(res);
    let allSpaces = normalizeSpaces(data.spaces || []);

    const hasPersonal = allSpaces.some((space) => space.kind === "user");
    if (!hasPersonal && currentUser) {
      allSpaces = [buildVirtualPersonalSpace(currentUser), ...allSpaces];
    }

    return allSpaces;
  } catch (error) {
    if (notifyOnError) {
      deps.showToast(
        "error",
        getErrorMessage(error, deps.t("failedToLoad") || "Failed to load"),
      );
    }
    if (throwOnError) {
      throw error;
    }
    if (currentUser) {
      return [buildVirtualPersonalSpace(currentUser)];
    }
    return [];
  }
}

export async function loadAuthSnapshot(
  deps: AuthActionDeps,
): Promise<AuthSnapshot> {
  const fallbackError = deps.t("failedToLoad") || "Failed to load";

  try {
    const res = await fetchApi("/api/me");
    if (res.ok) {
      const user = await rpcJson<User>(res);
      const [spaces, userSettings] = await Promise.all([
        fetchSpaces(deps, user),
        fetchUserSettings(),
      ]);

      return {
        authState: "authenticated",
        user,
        userSettings,
        spaces,
        spacesLoaded: true,
        bootstrapError: null,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        ...INITIAL_AUTH_SNAPSHOT,
        authState: "login",
      };
    }

    return {
      ...INITIAL_AUTH_SNAPSHOT,
      bootstrapError: await readApiErrorMessage(res, fallbackError),
    };
  } catch (error) {
    return {
      ...INITIAL_AUTH_SNAPSHOT,
      bootstrapError: getErrorMessage(error, fallbackError),
    };
  }
}

export async function handleLogout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
}

export function redirectToLogin(returnTo?: string): void {
  const url = new URL("/auth/login", globalThis.location.origin);
  if (returnTo) {
    url.searchParams.set("return_to", returnTo);
  }
  globalThis.location.href = url.toString();
}
