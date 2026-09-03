import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  REQUIRED_RUNTIME_SECRET_NAMES,
  validateRuntimeSecrets,
} from "../src/worker/shared/config/runtime-secrets.ts";

const SOURCE_ROOT = resolve(import.meta.dir, "..");
const GENERATOR = resolve(import.meta.dir, "generate-platform-keys.ts");
const RUNTIME_SECRETS_FILENAME = "takos-runtime-secrets.json";

// The default public-client bundle must produce every required runtime name,
// not just its key pair.

type RuntimeSecretName = (typeof REQUIRED_RUNTIME_SECRET_NAMES)[number];

async function runGenerator(
  outputDir: string,
  ...args: readonly string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(
    [
      process.execPath,
      GENERATOR,
      "--env=local",
      `--output=${outputDir}`,
      ...args,
    ],
    {
      cwd: SOURCE_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function readGeneratedSecretFiles(
  outputDir: string,
): Promise<Record<RuntimeSecretName, string>> {
  const values = {} as Record<RuntimeSecretName, string>;
  for (const name of REQUIRED_RUNTIME_SECRET_NAMES) {
    values[name] = (await readFile(join(outputDir, name), "utf8")).trimEnd();
  }
  return values;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("generates every public-client runtime secret independently without leaking values", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-keys-"));
  const outputDir = join(root, "secrets");
  try {
    const result = await runGenerator(outputDir);
    expect(result.exitCode).toBe(0);

    const entries = await readdir(outputDir);
    expect(entries.sort()).toEqual(
      [...REQUIRED_RUNTIME_SECRET_NAMES].sort(),
    );

    const values = await readGeneratedSecretFiles(outputDir);
    expect(
      REQUIRED_RUNTIME_SECRET_NAMES.every((name) => values[name].length > 0),
    ).toBe(true);
    const modes = await Promise.all(
      REQUIRED_RUNTIME_SECRET_NAMES.map(async (name) =>
        (await stat(join(outputDir, name))).mode & 0o777,
      ),
    );
    expect(modes.every((mode) => mode === 0o600)).toBe(true);
    expect(new Set(Object.values(values)).size).toBe(
      REQUIRED_RUNTIME_SECRET_NAMES.length,
    );
    expect(entries.includes("OIDC_CLIENT_SECRET")).toBe(false);

    const output = `${result.stdout}\n${result.stderr}`;
    expect(
      Object.values(values).some((value) => output.includes(value)),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opt-in runtime JSON contains exactly the five public-client names and stays private", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-runtime-json-"));
  const outputDir = join(root, "secrets");
  try {
    const result = await runGenerator(outputDir, "--runtime-json");
    expect(result.exitCode).toBe(0);

    const entries = await readdir(outputDir);
    expect(entries.sort()).toEqual(
      [...REQUIRED_RUNTIME_SECRET_NAMES, RUNTIME_SECRETS_FILENAME].sort(),
    );

    const values = await readGeneratedSecretFiles(outputDir);
    const runtimeContents = await readFile(
      join(outputDir, RUNTIME_SECRETS_FILENAME),
      "utf8",
    );
    const runtimeJson = JSON.parse(runtimeContents) as Record<string, unknown>;
    expect(() => validateRuntimeSecrets(runtimeJson)).not.toThrow();
    expect(Object.keys(runtimeJson).sort()).toEqual(
      [...REQUIRED_RUNTIME_SECRET_NAMES].sort(),
    );
    const rawFileValues = Object.fromEntries(
      await Promise.all(
        REQUIRED_RUNTIME_SECRET_NAMES.map(async (name) => [
          name,
          await readFile(join(outputDir, name), "utf8"),
        ] as const),
      ),
    );
    expect(
      REQUIRED_RUNTIME_SECRET_NAMES.every(
        (name) =>
          typeof runtimeJson[name] === "string" &&
          (runtimeJson[name] === rawFileValues[name] ||
            runtimeJson[name] === rawFileValues[name].replace(/\n$/u, "")),
      ),
    ).toBe(true);
    expect((await stat(join(outputDir, RUNTIME_SECRETS_FILENAME))).mode & 0o777).toBe(
      0o600,
    );
    expect(
      Object.values(runtimeJson).some(
        (value) => typeof value !== "string" || value.length === 0,
      ),
    ).toBe(false);

    const output = `${result.stdout}\n${result.stderr}`;
    expect(
      Object.values(values).some((value) => output.includes(value)) ||
        output.includes(runtimeContents),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opt-in confidential OIDC generation adds a client secret to the runtime bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-confidential-oidc-"));
  const outputDir = join(root, "secrets");
  try {
    const result = await runGenerator(outputDir, "--confidential-oidc", "--runtime-json");
    expect(result.exitCode).toBe(0);

    const entries = await readdir(outputDir);
    expect(entries.sort()).toEqual(
      [
        ...REQUIRED_RUNTIME_SECRET_NAMES,
        "OIDC_CLIENT_SECRET",
        RUNTIME_SECRETS_FILENAME,
      ].sort(),
    );
    const oidcSecret = (await readFile(join(outputDir, "OIDC_CLIENT_SECRET"), "utf8"))
      .trim();
    expect(/^[0-9a-f]{64}$/u.test(oidcSecret)).toBe(true);
    const runtimeJson = JSON.parse(
      await readFile(join(outputDir, RUNTIME_SECRETS_FILENAME), "utf8"),
    ) as Record<string, unknown>;
    expect(validateRuntimeSecrets(runtimeJson).OIDC_CLIENT_SECRET).toBe(oidcSecret);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("public generation rejects a stale confidential OIDC file even with --force", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-stale-oidc-"));
  const outputDir = join(root, "secrets");
  try {
    expect((await runGenerator(outputDir, "--confidential-oidc")).exitCode).toBe(0);
    const oidcPath = join(outputDir, "OIDC_CLIENT_SECRET");
    const oidcDigest = digest(await readFile(oidcPath, "utf8"));

    const result = await runGenerator(outputDir, "--force");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("stale OIDC_CLIENT_SECRET");
    expect(digest(await readFile(oidcPath, "utf8"))).toBe(oidcDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves no-overwrite behavior for confidential OIDC and runtime JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-no-overwrite-"));
  const outputDir = join(root, "secrets");
  try {
    expect((await runGenerator(outputDir, "--confidential-oidc")).exitCode).toBe(0);
    const oidcPath = join(outputDir, "OIDC_CLIENT_SECRET");
    const oidcDigest = digest(await readFile(oidcPath, "utf8"));
    for (const name of REQUIRED_RUNTIME_SECRET_NAMES) {
      await rm(join(outputDir, name));
    }
    const oidcConflict = await runGenerator(outputDir, "--confidential-oidc");
    expect(oidcConflict.exitCode).not.toBe(0);
    expect(oidcConflict.stderr.includes("Refusing to overwrite existing secret files")).toBe(
      true,
    );
    expect(digest(await readFile(oidcPath, "utf8"))).toBe(oidcDigest);

    await rm(oidcPath);
    expect(
      (await runGenerator(outputDir, "--confidential-oidc", "--runtime-json"))
        .exitCode,
    ).toBe(0);
    const runtimePath = join(outputDir, RUNTIME_SECRETS_FILENAME);
    const runtimeDigest = digest(await readFile(runtimePath, "utf8"));
    for (const name of REQUIRED_RUNTIME_SECRET_NAMES) {
      await rm(join(outputDir, name));
    }
    await rm(oidcPath);
    const runtimeConflict = await runGenerator(
      outputDir,
      "--confidential-oidc",
      "--runtime-json",
    );
    expect(runtimeConflict.exitCode).not.toBe(0);
    expect(runtimeConflict.stderr.includes("Refusing to overwrite existing secret files")).toBe(
      true,
    );
    expect(digest(await readFile(runtimePath, "utf8"))).toBe(runtimeDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
