import {
  type ControlForwarder,
  defineControlForwarder,
} from "./in-process-control-routes.ts";

// ---------------------------------------------------------------------------
// account
// ---------------------------------------------------------------------------

const ACCOUNT_UPSTREAM_PREFIXES = [
  "/api/auth",
  "/api/me",
] as const;

const AUTH_UPSTREAM_PATHS = new Set([
  "/auth/oidc/login",
  "/auth/oidc/callback",
  "/auth/logout",
]);

const REMOVED_ACCOUNT_PATH_PREFIXES = [
  "/api/me/personal-access-tokens",
] as const;

function accountBackendPath(pathname: string): string | null {
  if (AUTH_UPSTREAM_PATHS.has(pathname)) return pathname;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return null;
  if (
    REMOVED_ACCOUNT_PATH_PREFIXES.some((prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  ) {
    return null;
  }
  return ACCOUNT_UPSTREAM_PREFIXES.some((prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
    ? pathname
    : null;
}

// ---------------------------------------------------------------------------
// app-installations
// ---------------------------------------------------------------------------

function appInstallationsBackendPath(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (
    parts.length < 4 ||
    parts[0] !== "api" ||
    parts[1] !== "spaces" ||
    parts[3] !== "app-installations"
  ) {
    return null;
  }

  return pathname.replace(/^\/api/, "");
}

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

const PROFILE_API_PREFIX = "/api/users";

function profileBackendPath(pathname: string): string | null {
  return pathname === PROFILE_API_PREFIX ||
      pathname.startsWith(`${PROFILE_API_PREFIX}/`)
    ? pathname
    : null;
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

const RUNS_API_PREFIX = "/api/runs";
const ARTIFACTS_API_PREFIX = "/api/artifacts";

function runsBackendPath(pathname: string, method: string): string | null {
  if (isAppsApiOwnedRunsPath(pathname, method)) {
    return null;
  }
  return pathname === RUNS_API_PREFIX ||
      pathname.startsWith(`${RUNS_API_PREFIX}/`) ||
      pathname === ARTIFACTS_API_PREFIX ||
      pathname.startsWith(`${ARTIFACTS_API_PREFIX}/`)
    ? pathname
    : null;
}

function isAppsApiOwnedRunsPath(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "POST") return false;
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return false;
  if (
    upperMethod === "GET" &&
    parts.length === 3 && parts[1] === "runs" && parts[2].length > 0
  ) {
    return true;
  }
  if (
    upperMethod === "GET" &&
    parts.length === 4 &&
    parts[1] === "runs" &&
    parts[2].length > 0 &&
    (parts[3] === "events" || parts[3] === "replay" || parts[3] === "sse" ||
      parts[3] === "ws")
  ) {
    return true;
  }
  if (
    upperMethod === "POST" &&
    parts.length === 4 &&
    parts[1] === "runs" &&
    parts[2].length > 0 &&
    parts[3] === "cancel"
  ) {
    return true;
  }
  if (
    (upperMethod === "GET" || upperMethod === "POST") &&
    parts.length === 4 &&
    parts[1] === "runs" &&
    parts[2].length > 0 &&
    parts[3] === "artifacts"
  ) {
    return true;
  }
  return upperMethod === "GET" &&
    parts.length === 3 &&
    parts[1] === "artifacts" &&
    parts[2].length > 0;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

const SETUP_API_PREFIX = "/api/setup";

function setupBackendPath(pathname: string): string | null {
  return pathname === SETUP_API_PREFIX ||
      pathname.startsWith(`${SETUP_API_PREFIX}/`)
    ? pathname
    : null;
}

// ---------------------------------------------------------------------------
// space-tools
// ---------------------------------------------------------------------------

function spaceToolsBackendPath(
  pathname: string,
  method: string,
): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (method.toUpperCase() === "GET" && isSpaceToolsReadPath(parts)) {
    return null;
  }
  return parts.length >= 4 &&
      parts[0] === "api" &&
      parts[1] === "spaces" &&
      parts[3] === "tools"
    ? pathname
    : null;
}

function isSpaceToolsReadPath(parts: string[]): boolean {
  return (parts.length === 4 || parts.length === 5) &&
    parts[0] === "api" &&
    parts[1] === "spaces" &&
    parts[3] === "tools";
}

// ---------------------------------------------------------------------------
// threads
// ---------------------------------------------------------------------------

const THREADS_API_PREFIX = "/api/threads";

function threadsBackendPath(pathname: string, method: string): string | null {
  if (isAppsApiOwnedThreadsPath(pathname, method)) {
    return null;
  }
  if (
    pathname === THREADS_API_PREFIX ||
    pathname.startsWith(`${THREADS_API_PREFIX}/`)
  ) {
    return pathname;
  }

  const parts = pathname.split("/").filter(Boolean);
  return parts.length >= 4 &&
      parts[0] === "api" &&
      parts[1] === "spaces" &&
      parts[3] === "threads"
    ? pathname
    : null;
}

function isAppsApiOwnedThreadsPath(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase();
  if (
    upperMethod !== "GET" &&
    upperMethod !== "POST" &&
    upperMethod !== "PATCH" &&
    upperMethod !== "DELETE"
  ) return false;
  const parts = pathname.split("/").filter(Boolean);
  if (upperMethod !== "GET") {
    if (
      upperMethod === "POST" &&
      parts.length === 4 &&
      parts[0] === "api" &&
      parts[1] === "spaces" &&
      parts[2].length > 0 &&
      parts[3] === "threads"
    ) return true;
    if (parts[0] !== "api" || parts[1] !== "threads" || !parts[2]) return false;
    if (
      (upperMethod === "PATCH" || upperMethod === "DELETE") &&
      parts.length === 3
    ) return true;
    if (upperMethod === "POST" && parts.length === 4) {
      return parts[3] === "messages" ||
        parts[3] === "runs" ||
        parts[3] === "share" ||
        parts[3] === "archive" ||
        parts[3] === "unarchive";
    }
    return upperMethod === "POST" &&
      parts.length === 6 &&
      parts[3] === "shares" &&
      parts[4].length > 0 &&
      parts[5] === "revoke";
  }
  if (
    parts.length === 3 &&
    parts[0] === "api" &&
    parts[1] === "threads" &&
    parts[2].length > 0
  ) {
    return true;
  }
  if (
    parts.length === 4 &&
    parts[0] === "api" &&
    parts[1] === "spaces" &&
    parts[2].length > 0 &&
    parts[3] === "threads"
  ) {
    return true;
  }
  if (
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "spaces" &&
    parts[2].length > 0 &&
    parts[3] === "threads" &&
    parts[4] === "search"
  ) {
    return true;
  }
  if (
    parts.length === 5 &&
    parts[0] === "api" &&
    parts[1] === "threads" &&
    parts[2].length > 0 &&
    parts[3] === "messages" &&
    parts[4] === "search"
  ) {
    return true;
  }
  return parts.length === 4 &&
    parts[0] === "api" &&
    parts[1] === "threads" &&
    parts[2].length > 0 &&
    (parts[3] === "runs" ||
      parts[3] === "history" ||
      parts[3] === "export" ||
      parts[3] === "messages" ||
      parts[3] === "shares");
}

// ---------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------

/**
 * Ordered registry of in-process control-path forwarders. The public dispatch
 * middleware iterates this array in order and delegates the first match, so
 * adding a forwarder is a single descriptor line. The `name` doubles as the
 * `NOT_FOUND` label, and `matchTarget` carries the path/method ownership rule.
 *
 * Order matches the historical hand-chained dispatch: account →
 * app-installations → profile → setup → runs → space-tools → threads. The
 * matchers are mutually exclusive by path prefix, so order is not behaviorally
 * significant, but it is preserved to keep the dispatch identical.
 */
export const CONTROL_FORWARDERS: readonly ControlForwarder[] = [
  defineControlForwarder({
    name: "account",
    matchTarget: (pathname) => accountBackendPath(pathname),
  }),
  defineControlForwarder({
    name: "app-installations",
    matchTarget: (pathname) => appInstallationsBackendPath(pathname),
  }),
  defineControlForwarder({
    name: "profile",
    matchTarget: (pathname) => profileBackendPath(pathname),
  }),
  defineControlForwarder({
    name: "setup",
    matchTarget: (pathname) => setupBackendPath(pathname),
  }),
  defineControlForwarder({
    name: "runs",
    matchTarget: (pathname, method) => runsBackendPath(pathname, method),
  }),
  // 404 label is intentionally "tools" (not "space-tools") to match the prior
  // forwarder envelope.
  defineControlForwarder({
    name: "tools",
    matchTarget: (pathname, method) => spaceToolsBackendPath(pathname, method),
  }),
  defineControlForwarder({
    name: "threads",
    matchTarget: (pathname, method) => threadsBackendPath(pathname, method),
  }),
];
