import { rpcJson } from "../lib/rpc.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { withTimeout } from "../lib/withTimeout.ts";
import { parseSpacesResponse } from "../lib/space-response.ts";
import {
  parseCurrentUserResponse,
  parseLogoutResponse,
  parseUserSettingsResponse,
} from "../lib/auth-response.ts";
import { getTranslation } from "../i18n.ts";
import { detectLanguage } from "../lib/locale.ts";
import type { TranslationKey, TranslationParams } from "./i18n.ts";
import type { Space, User, UserSettings } from "../types/index.ts";

export type AuthState = "loading" | "login" | "authenticated";

export type FetchSpacesOptions = {
  notifyOnError?: boolean;
  throwOnError?: boolean;
  fallbackSpaces?: readonly Space[];
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
let logoutRequest: Promise<void> | null = null;

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
    getTranslation(detectLanguage(), "requestTimedOut"),
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

export async function fetchUserSettings(
  fallback: UserSettings | null = null,
): Promise<UserSettings | null> {
  try {
    const res = await fetchApi("/api/me/settings");
    return parseUserSettingsResponse(await rpcJson<unknown>(res));
  } catch {
    return fallback;
  }
}

export async function fetchSpaces(
  deps: AuthActionDeps,
  _currentUser?: User | null,
  options?: FetchSpacesOptions,
): Promise<Space[]> {
  const {
    notifyOnError = true,
    throwOnError = false,
    fallbackSpaces,
  } = options ?? {};

  try {
    const res = await fetchApi("/api/spaces");
    return parseSpacesResponse(await rpcJson<unknown>(res));
  } catch (error) {
    if (notifyOnError) {
      deps.showToast(
        "error",
        getErrorMessage(error, deps.t("failedToLoad")),
      );
    }
    if (throwOnError) {
      throw error;
    }
    return fallbackSpaces ? [...fallbackSpaces] : [];
  }
}

export async function loadAuthSnapshot(
  deps: AuthActionDeps,
): Promise<AuthSnapshot> {
  const fallbackError = deps.t("failedToLoad");

  try {
    const res = await fetchApi("/api/me");
    if (res.ok) {
      const user = parseCurrentUserResponse(await rpcJson<unknown>(res));
      const [spaces, userSettings] = await Promise.all([
        fetchSpaces(deps, user, {
          notifyOnError: false,
          throwOnError: true,
        }),
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

async function performLogout(): Promise<void> {
  const response = await withTimeout(
    (signal) =>
      fetch("/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json" },
        signal,
      }),
    AUTH_BOOT_TIMEOUT_MS,
    getTranslation(detectLanguage(), "requestTimedOut"),
  );
  if (!response.ok) {
    throw new Error(getTranslation(detectLanguage(), "failedToLogout"));
  }
  parseLogoutResponse(await response.json());
}

export function handleLogout(): Promise<void> {
  if (logoutRequest) return logoutRequest;
  const request = performLogout();
  logoutRequest = request;
  void request.finally(() => {
    if (logoutRequest === request) logoutRequest = null;
  }).catch(() => undefined);
  return request;
}

export function redirectToLogin(returnTo?: string): void {
  const url = new URL("/auth/oidc/login", globalThis.location.origin);
  if (returnTo) {
    url.searchParams.set("return_to", returnTo);
  }
  globalThis.location.href = url.toString();
}
