import { expect, jest, test } from "bun:test";
import {
  deleteEnv,
  getEnv,
  setEnv,
} from "@takos/worker-platform-utils/runtime-env";
import { fixedClock } from "@takos/worker-platform-utils/clock";
import {
  createOIDCState,
  createSession,
  getOIDCState,
  getSession,
  SESSION_TTL_MS,
} from "../../../application/services/identity/session.ts";
import type { OIDCState } from "../../../shared/types/identity.ts";
import { resolveDurableObject } from "../durable-object-resolver.ts";

async function withInMemorySessionResolver<T>(
  run: () => Promise<T>,
): Promise<T> {
  const previousDisable = getEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
  const previousRedis = getEnv("REDIS_URL");
  const previousEnvironment = getEnv("ENVIRONMENT");
  const previousNodeEnvironment = getEnv("NODE_ENV");
  try {
    setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
    deleteEnv("REDIS_URL");
    deleteEnv("ENVIRONMENT");
    deleteEnv("NODE_ENV");
    return await run();
  } finally {
    if (previousDisable === undefined) {
      deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    } else {
      setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", previousDisable);
    }
    if (previousRedis === undefined) {
      deleteEnv("REDIS_URL");
    } else {
      setEnv("REDIS_URL", previousRedis);
    }
    if (previousEnvironment === undefined) {
      deleteEnv("ENVIRONMENT");
    } else {
      setEnv("ENVIRONMENT", previousEnvironment);
    }
    if (previousNodeEnvironment === undefined) {
      deleteEnv("NODE_ENV");
    } else {
      setEnv("NODE_ENV", previousNodeEnvironment);
    }
  }
}

test("Node SessionDO resolver preserves OIDC state in the selected shard", async () => {
  await withInMemorySessionResolver(async () => {
    const sessionStore = resolveDurableObject(
      "session",
      null,
      "/tmp/session-resolver-default-data-dir",
    );
    const oidcState: OIDCState = {
      state: "state-roundtrip",
      nonce: "nonce-roundtrip",
      code_verifier: "verifier-roundtrip",
      return_to: "/workspace",
      expires_at: Date.now() + 60_000,
      cli_callback: "http://127.0.0.1:43111/callback",
    };

    await createOIDCState(sessionStore, oidcState);

    await expect(getOIDCState(sessionStore, oidcState.state)).resolves.toEqual(
      oidcState,
    );
  });
});

test("Node SessionDO resolver preserves sessions in the selected shard", async () => {
  await withInMemorySessionResolver(async () => {
    const sessionStore = resolveDurableObject("session", null, null);
    const now = Date.now();
    const session = await createSession(
      sessionStore,
      "user_roundtrip",
      fixedClock(now),
    );

    await expect(getSession(sessionStore, session.id)).resolves.toEqual(
      session,
    );
  });
});

test("Node SessionDO resolver fails closed for unsupported Redis state", () => {
  const previousDisable = getEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
  const previousEnvironment = getEnv("ENVIRONMENT");
  const previousNodeEnvironment = getEnv("NODE_ENV");
  try {
    setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
    deleteEnv("ENVIRONMENT");
    deleteEnv("NODE_ENV");
    expect(() =>
      resolveDurableObject("session", "redis://localhost:6379", null),
    ).toThrow(
      "Node SessionDO Redis substrate is unsupported; configure in-memory local state",
    );
  } finally {
    if (previousDisable === undefined) {
      deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    } else {
      setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", previousDisable);
    }
    if (previousEnvironment === undefined) deleteEnv("ENVIRONMENT");
    else setEnv("ENVIRONMENT", previousEnvironment);
    if (previousNodeEnvironment === undefined) deleteEnv("NODE_ENV");
    else setEnv("NODE_ENV", previousNodeEnvironment);
  }
});

test("Node SessionDO resolver fails closed for production-shaped process memory", () => {
  const previousDisable = getEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
  const previousEnvironment = getEnv("ENVIRONMENT");
  const previousNodeEnvironment = getEnv("NODE_ENV");
  try {
    setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
    setEnv("ENVIRONMENT", "production");
    deleteEnv("NODE_ENV");
    expect(() => resolveDurableObject("session", null, "/tmp/session-data"))
      .toThrow(
        "Node SessionDO requires a durable backend in production; process-memory state is development-only",
      );
  } finally {
    if (previousDisable === undefined) deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    else setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", previousDisable);
    if (previousEnvironment === undefined) deleteEnv("ENVIRONMENT");
    else setEnv("ENVIRONMENT", previousEnvironment);
    if (previousNodeEnvironment === undefined) deleteEnv("NODE_ENV");
    else setEnv("NODE_ENV", previousNodeEnvironment);
  }
});

test("Node SessionDO resolver keeps real state when other local bindings use dataDir", async () => {
  const previousDisable = getEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
  const previousEnvironment = getEnv("ENVIRONMENT");
  const previousNodeEnvironment = getEnv("NODE_ENV");
  try {
    deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    deleteEnv("ENVIRONMENT");
    deleteEnv("NODE_ENV");
    const sessionStore = resolveDurableObject(
      "session",
      null,
      "/tmp/session-resolver-state",
    );
    const oidcState: OIDCState = {
      state: "state-data-dir",
      nonce: "nonce-data-dir",
      code_verifier: "verifier-data-dir",
      return_to: "/",
      expires_at: Date.now() + 60_000,
    };

    await createOIDCState(sessionStore, oidcState);
    await expect(
      getOIDCState(sessionStore, oidcState.state),
    ).resolves.toEqual(oidcState);
  } finally {
    if (previousDisable === undefined) {
      deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    } else {
      setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", previousDisable);
    }
    if (previousEnvironment === undefined) deleteEnv("ENVIRONMENT");
    else setEnv("ENVIRONMENT", previousEnvironment);
    if (previousNodeEnvironment === undefined) deleteEnv("NODE_ENV");
    else setEnv("NODE_ENV", previousNodeEnvironment);
  }
});

test("Node SessionDO resolver runs serialized cleanup alarms for OIDC state and sessions", async () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const previousDisable = getEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
  const previousEnvironment = getEnv("ENVIRONMENT");
  const previousNodeEnvironment = getEnv("NODE_ENV");
  jest.useFakeTimers({ now });

  let sessionStore: ReturnType<typeof resolveDurableObject> | undefined;
  try {
    setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
    deleteEnv("ENVIRONMENT");
    deleteEnv("NODE_ENV");
    sessionStore = resolveDurableObject("session", null, null);
    const oidcState: OIDCState = {
      state: "state-expiry-short",
      nonce: "nonce-expiry-short",
      code_verifier: "verifier-expiry-short",
      return_to: "/",
      expires_at: now + 500,
    };
    const laterOidcState: OIDCState = {
      ...oidcState,
      state: "state-expiry-later",
      nonce: "nonce-expiry-later",
      code_verifier: "verifier-expiry-later",
      expires_at: now + 2_500,
    };

    await createOIDCState(sessionStore, oidcState);
    await createOIDCState(sessionStore, laterOidcState);
    const session = await createSession(
      sessionStore,
      "user_expiry",
      fixedClock(now),
    );

    // SessionDO clamps its first alarm to at least one second. The timer must
    // run the real alarm method, not just retain the timestamp in storage.
    jest.advanceTimersByTime(1_001);
    await expect(getOIDCState(sessionStore, oidcState.state)).resolves.toBe(
      null,
    );
    await expect(
      getOIDCState(sessionStore, laterOidcState.state),
    ).resolves.toEqual(laterOidcState);
    await expect(getSession(sessionStore, session.id)).resolves.toEqual(session);

    // The alarm re-schedules itself for the later OIDC state; that state is
    // then removed by the second serialized delivery.
    jest.advanceTimersByTime(1_500);
    await expect(
      getOIDCState(sessionStore, laterOidcState.state),
    ).resolves.toBe(null);

    // The same scheduler eventually cleans up the session at its absolute
    // expiry, proving session and OIDC state share the provider alarm path.
    jest.advanceTimersByTime(Number(SESSION_TTL_MS) + 1);
    await expect(getSession(sessionStore, session.id)).resolves.toBe(null);
  } finally {
    const disposable = sessionStore as
      | (ReturnType<typeof resolveDurableObject> & { dispose?: () => void })
      | undefined;
    disposable?.dispose?.();
    jest.useRealTimers();
    if (previousDisable === undefined) deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    else setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", previousDisable);
    if (previousEnvironment === undefined) deleteEnv("ENVIRONMENT");
    else setEnv("ENVIRONMENT", previousEnvironment);
    if (previousNodeEnvironment === undefined) deleteEnv("NODE_ENV");
    else setEnv("NODE_ENV", previousNodeEnvironment);
  }
});

test("Node SessionDO resolver disposal cancels pending alarm timers", async () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 0);
  const previousDisable = getEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
  const previousEnvironment = getEnv("ENVIRONMENT");
  const previousNodeEnvironment = getEnv("NODE_ENV");
  jest.useFakeTimers({ now });
  const timersBefore = jest.getTimerCount();

  try {
    setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
    deleteEnv("ENVIRONMENT");
    deleteEnv("NODE_ENV");
    const sessionStore = resolveDurableObject("session", null, null) as
      | (ReturnType<typeof resolveDurableObject> & { dispose?: () => void });
    await createOIDCState(sessionStore, {
      state: "state-disposal",
      nonce: "nonce-disposal",
      code_verifier: "verifier-disposal",
      return_to: "/",
      expires_at: now + 500,
    });
    expect(jest.getTimerCount()).toBeGreaterThan(timersBefore);
    sessionStore.dispose?.();
    expect(jest.getTimerCount()).toBe(timersBefore);
    jest.advanceTimersByTime(10_000);
  } finally {
    jest.useRealTimers();
    if (previousDisable === undefined) deleteEnv("TAKOS_DISABLE_REDIS_EXTERNALS");
    else setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", previousDisable);
    if (previousEnvironment === undefined) deleteEnv("ENVIRONMENT");
    else setEnv("ENVIRONMENT", previousEnvironment);
    if (previousNodeEnvironment === undefined) deleteEnv("NODE_ENV");
    else setEnv("NODE_ENV", previousNodeEnvironment);
  }
});
