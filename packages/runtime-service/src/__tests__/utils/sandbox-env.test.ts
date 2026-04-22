import {
  createSandboxEnv,
  readSafeEnv,
  validateRuntimeExecEnv,
} from "../../utils/sandbox-env.ts";

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

const originalAwsSecret = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const originalActionsEnvAllowlist = Deno.env.get("TAKOS_ACTIONS_ENV_ALLOWLIST");
const originalPath = Deno.env.get("PATH");

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined) {
    Deno.env.delete(name);
    return;
  }
  Deno.env.set(name, original);
}

Deno.test("validateRuntimeExecEnv - accepts undefined env as empty object", () => {
  try {
    assertEquals(validateRuntimeExecEnv(undefined), { ok: true, env: {} });
  } finally {
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
  }
});

Deno.test("createSandboxEnv - honors configured exact names and prefixes", () => {
  try {
    Deno.env.set("TAKOS_ACTIONS_ENV_ALLOWLIST", "CUSTOM_TOKEN APP_*");

    const sandboxEnv = createSandboxEnv({
      CUSTOM_TOKEN: "custom-token",
      APP_PUBLIC_URL: "https://example.com",
      OTHER_SECRET: "dropped",
    });

    assertEquals(sandboxEnv.CUSTOM_TOKEN, "custom-token");
    assertEquals(sandboxEnv.APP_PUBLIC_URL, "https://example.com");
    assertEquals(sandboxEnv.OTHER_SECRET, undefined);
  } finally {
    restoreEnv("TAKOS_ACTIONS_ENV_ALLOWLIST", originalActionsEnvAllowlist);
  }
});

Deno.test("createSandboxEnv - drops implicit GitHub Actions prefixes without explicit allowlist", () => {
  try {
    Deno.env.delete("TAKOS_ACTIONS_ENV_ALLOWLIST");

    const sandboxEnv = createSandboxEnv({
      GITHUB_TOKEN: "token-from-workflow",
      INPUT_SECRET: "secret-from-workflow",
      RUNNER_TEMP: "/tmp/runner-temp",
      RUNNER_WORKSPACE: "/tmp/runner-workspace",
    });

    assertEquals(sandboxEnv.GITHUB_TOKEN, undefined);
    assertEquals(sandboxEnv.INPUT_SECRET, undefined);
    assertEquals(sandboxEnv.RUNNER_WORKSPACE, undefined);
    assertEquals(sandboxEnv.RUNNER_TEMP, "/tmp/runner-temp");
  } finally {
    restoreEnv("TAKOS_ACTIONS_ENV_ALLOWLIST", originalActionsEnvAllowlist);
  }
});

Deno.test("createSandboxEnv - allows explicit GitHub Actions allowlist entries", () => {
  try {
    Deno.env.set(
      "TAKOS_ACTIONS_ENV_ALLOWLIST",
      "GITHUB_* INPUT_SECRET RUNNER_*",
    );

    const sandboxEnv = createSandboxEnv({
      GITHUB_TOKEN: "token-from-workflow",
      INPUT_SECRET: "secret-from-workflow",
      RUNNER_WORKSPACE: "/tmp/runner-workspace",
    });

    assertEquals(sandboxEnv.GITHUB_TOKEN, "token-from-workflow");
    assertEquals(sandboxEnv.INPUT_SECRET, "secret-from-workflow");
    assertEquals(sandboxEnv.RUNNER_WORKSPACE, "/tmp/runner-workspace");
  } finally {
    restoreEnv("TAKOS_ACTIONS_ENV_ALLOWLIST", originalActionsEnvAllowlist);
  }
});

Deno.test("validateRuntimeExecEnv - accepts valid env entries", () => {
  try {
    const result = validateRuntimeExecEnv({
      CI: "true",
      MY_FEATURE_FLAG: "1",
    });
    assertEquals(result, {
      ok: true,
      env: { CI: "true", MY_FEATURE_FLAG: "1" },
    });
  } finally {
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
  }
});
Deno.test("validateRuntimeExecEnv - rejects invalid variable names", () => {
  try {
    const result = validateRuntimeExecEnv({
      "1INVALID": "value",
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error, "Invalid environment variable name");
    }
  } finally {
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
  }
});
Deno.test("validateRuntimeExecEnv - rejects sensitive variable names", () => {
  try {
    const result = validateRuntimeExecEnv({
      TAKOS_TOKEN: "secret",
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(
        result.error,
        "Sensitive environment variable is not allowed",
      );
    }
  } finally {
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
  }
});
Deno.test("validateRuntimeExecEnv - rejects values with newlines", () => {
  try {
    const result = validateRuntimeExecEnv({
      SAFE_NAME: "line1\nline2",
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertStringIncludes(result.error, "contains invalid characters");
    }
  } finally {
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
  }
});

Deno.test("createSandboxEnv - blocks host secrets while allowing documented safe env", () => {
  try {
    Deno.env.set("AWS_SECRET_ACCESS_KEY", "host-secret-value");

    const sandboxEnv = createSandboxEnv({
      GIT_AUTHOR_NAME: "Takos Bot",
      RUNNER_TEMP: "/tmp/runner",
      AWS_SECRET_ACCESS_KEY: "workflow-secret",
    });

    assertEquals(sandboxEnv.GIT_AUTHOR_NAME, "Takos Bot");
    assertEquals(sandboxEnv.RUNNER_TEMP, "/tmp/runner");
    assertEquals(sandboxEnv.AWS_SECRET_ACCESS_KEY, undefined);
  } finally {
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
    restoreEnv("TAKOS_ACTIONS_ENV_ALLOWLIST", originalActionsEnvAllowlist);
  }
});

Deno.test("readSafeEnv - reads only documented safe host env", () => {
  try {
    Deno.env.set("PATH", "/usr/local/bin:/usr/bin");
    Deno.env.set("AWS_SECRET_ACCESS_KEY", "host-secret-value");

    const safeEnv = readSafeEnv();

    assertEquals(safeEnv.PATH, "/usr/local/bin:/usr/bin");
    assertEquals(safeEnv.AWS_SECRET_ACCESS_KEY, undefined);
  } finally {
    restoreEnv("PATH", originalPath);
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
  }
});
