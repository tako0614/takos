import { expect, jest, test } from "bun:test";
import {
  deleteEnv,
  getEnv,
  setEnv,
} from "@takos/worker-platform-utils/runtime-env";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createOIDCState,
  getOIDCState,
} from "../../application/services/identity/session.ts";
import {
  createNodeWebEnv,
  disposeNodePlatformState,
} from "../env-builder.ts";

const ENV_KEYS = [
  "TAKOS_DISABLE_REDIS_EXTERNALS",
  "REDIS_URL",
  "TAKOS_LOCAL_DATA_DIR",
  "ENVIRONMENT",
  "NODE_ENV",
] as const;

test("Node env builder wires the real SessionDO on the in-memory local path", async () => {
  const previous = Object.fromEntries(
    ENV_KEYS.map((key) => [key, getEnv(key)]),
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  const dataDir = await mkdtemp(join(tmpdir(), "takos-session-env-"));
  const now = Date.now();
  jest.useFakeTimers({ now });
  const timersBefore = jest.getTimerCount();

  try {
    setEnv("TAKOS_DISABLE_REDIS_EXTERNALS", "1");
    deleteEnv("REDIS_URL");
    deleteEnv("ENVIRONMENT");
    deleteEnv("NODE_ENV");
    setEnv("TAKOS_LOCAL_DATA_DIR", dataDir);
    await disposeNodePlatformState({ clearData: true });

    const env = await createNodeWebEnv();
    const oidcState = {
      state: "env-builder-state",
      nonce: "env-builder-nonce",
      code_verifier: "env-builder-verifier",
      return_to: "/",
      expires_at: now + 60_000,
    };

    await createOIDCState(env.SESSION_DO!, oidcState);
    expect(jest.getTimerCount()).toBeGreaterThan(timersBefore);
    await expect(
      getOIDCState(env.SESSION_DO!, oidcState.state),
    ).resolves.toEqual(oidcState);
  } finally {
    await disposeNodePlatformState({ clearData: true });
    // disposeNodePlatformState owns the Node SessionDO namespace and must
    // cancel its pending alarm scheduler before the singleton is discarded.
    expect(jest.getTimerCount()).toBe(timersBefore);
    jest.useRealTimers();
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
