import { expect, test } from "bun:test";

import {
  REQUIRED_RUNTIME_SECRET_NAMES,
  RUNTIME_SECRETS_NOT_REQUIRED_AT_BOOT,
} from "./runtime-secrets.ts";
import { requiredEnvKeys } from "../utils/validate-env.ts";

test("every required runtime secret is either required at boot or explained", () => {
  const bootRequired = new Set(requiredEnvKeys("takos"));
  const unexplained = REQUIRED_RUNTIME_SECRET_NAMES.filter(
    (name) =>
      !bootRequired.has(name) &&
      RUNTIME_SECRETS_NOT_REQUIRED_AT_BOOT[name] === undefined,
  );
  expect(
    unexplained,
    "a runtime secret the Worker does not require at boot needs a stated reason in RUNTIME_SECRETS_NOT_REQUIRED_AT_BOOT",
  ).toEqual([]);
});

test("no explanation outlives the difference it explains", () => {
  const bootRequired = new Set(requiredEnvKeys("takos"));
  const required = new Set<string>(REQUIRED_RUNTIME_SECRET_NAMES);
  for (const name of Object.keys(RUNTIME_SECRETS_NOT_REQUIRED_AT_BOOT)) {
    expect(
      required.has(name),
      `${name} is explained as an exception but is not a required runtime secret`,
    ).toBe(true);
    expect(
      bootRequired.has(name),
      `${name} is now required at boot; delete its entry from RUNTIME_SECRETS_NOT_REQUIRED_AT_BOOT`,
    ).toBe(false);
  }
});
