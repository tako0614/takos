import { afterEach, expect, test } from "bun:test";
import {
  resolveRuntimeInterfaceAuthorization,
  runtimeInterfaceAuthorizationDeps,
} from "../runtime-interface-authorization.ts";
import type { Env } from "../../../../shared/types/index.ts";

const original = runtimeInterfaceAuthorizationDeps.accountsDelegatedAuthorization;
afterEach(() => {
  runtimeInterfaceAuthorizationDeps.accountsDelegatedAuthorization = original;
});

test("an app-scoped Bearer cannot select a stored workspace grant for Interface discovery", async () => {
  let storedGrantReads = 0;
  runtimeInterfaceAuthorizationDeps.accountsDelegatedAuthorization = async () => {
    storedGrantReads += 1;
    return { accessToken: "different-grant", workspaceId: "old-workspace", subjectId: "account-a" };
  };
  const env = {
    DB: {}, ENCRYPTION_KEY: "test-key", OIDC_CLIENT_ID: "takos",
    OIDC_ISSUER_URL: "https://accounts.test",
  } as Env;
  await expect(resolveRuntimeInterfaceAuthorization(env, "user-a", {
    accessToken: "current-app-grant", subjectId: "account-a",
  })).rejects.toThrow("requires workspace-bound authorization");
  expect(storedGrantReads).toBe(0);
  const legacy = await resolveRuntimeInterfaceAuthorization(env, "user-a", {
    accessToken: "current-legacy-grant", subjectId: "account-a", workspaceId: "current-workspace",
  });
  expect(legacy.token).toBe("current-legacy-grant");
  expect(legacy.workspaceId).toBe("current-workspace");
  expect(storedGrantReads).toBe(0);
});
