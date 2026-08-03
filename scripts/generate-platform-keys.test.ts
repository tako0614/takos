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

import { validateRuntimeSecrets } from "./takos-product-materializer.ts";

const SOURCE_ROOT = resolve(import.meta.dir, "..");
const GENERATOR = resolve(import.meta.dir, "generate-platform-keys.ts");
const RUNTIME_SECRETS_FILENAME = "takos-runtime-secrets.json";

// Keep this list aligned with scripts/takos-product-materializer.ts. The
// generator must produce every required runtime name, not just its key pair.
const MATERIALIZER_REQUIRED_SECRET_NAMES = [
  "ENCRYPTION_KEY",
  "OIDC_CLIENT_SECRET",
  "PLATFORM_PRIVATE_KEY",
  "PLATFORM_PUBLIC_KEY",
  "TAKOS_AGENT_START_TOKEN",
  "TAKOS_INTERNAL_API_SECRET",
] as const;

type MaterializerSecretName =
  (typeof MATERIALIZER_REQUIRED_SECRET_NAMES)[number];

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
): Promise<Record<MaterializerSecretName, string>> {
  const values = {} as Record<MaterializerSecretName, string>;
  for (const name of MATERIALIZER_REQUIRED_SECRET_NAMES) {
    values[name] = (await readFile(join(outputDir, name), "utf8")).trimEnd();
  }
  return values;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("generates every materializer-required secret independently without leaking values", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-keys-"));
  const outputDir = join(root, "secrets");
  try {
    const result = await runGenerator(outputDir);
    expect(result.exitCode).toBe(0);

    const entries = await readdir(outputDir);
    expect(entries.sort()).toEqual(
      [...MATERIALIZER_REQUIRED_SECRET_NAMES].sort(),
    );

    const values = await readGeneratedSecretFiles(outputDir);
    expect(
      MATERIALIZER_REQUIRED_SECRET_NAMES.every((name) => values[name].length > 0),
    ).toBe(true);
    const modes = await Promise.all(
      MATERIALIZER_REQUIRED_SECRET_NAMES.map(async (name) =>
        (await stat(join(outputDir, name))).mode & 0o777,
      ),
    );
    expect(modes.every((mode) => mode === 0o600)).toBe(true);
    expect(new Set(Object.values(values)).size).toBe(
      MATERIALIZER_REQUIRED_SECRET_NAMES.length,
    );
    expect(/^[0-9a-f]{64}$/u.test(values.OIDC_CLIENT_SECRET)).toBe(true);

    const output = `${result.stdout}\n${result.stderr}`;
    expect(
      Object.values(values).some((value) => output.includes(value)),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("opt-in runtime JSON contains exactly the six materializer names and stays private", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-runtime-json-"));
  const outputDir = join(root, "secrets");
  try {
    const result = await runGenerator(outputDir, "--runtime-json");
    expect(result.exitCode).toBe(0);

    const entries = await readdir(outputDir);
    expect(entries.sort()).toEqual(
      [...MATERIALIZER_REQUIRED_SECRET_NAMES, RUNTIME_SECRETS_FILENAME].sort(),
    );

    const values = await readGeneratedSecretFiles(outputDir);
    const runtimeContents = await readFile(
      join(outputDir, RUNTIME_SECRETS_FILENAME),
      "utf8",
    );
    const runtimeJson = JSON.parse(runtimeContents) as Record<string, unknown>;
    expect(() => validateRuntimeSecrets(runtimeJson)).not.toThrow();
    expect(Object.keys(runtimeJson).sort()).toEqual(
      [...MATERIALIZER_REQUIRED_SECRET_NAMES].sort(),
    );
    const rawFileValues = Object.fromEntries(
      await Promise.all(
        MATERIALIZER_REQUIRED_SECRET_NAMES.map(async (name) => [
          name,
          await readFile(join(outputDir, name), "utf8"),
        ] as const),
      ),
    );
    expect(
      MATERIALIZER_REQUIRED_SECRET_NAMES.every(
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

test("preserves no-overwrite behavior for the new OIDC file and runtime JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-platform-no-overwrite-"));
  const outputDir = join(root, "secrets");
  try {
    expect((await runGenerator(outputDir)).exitCode).toBe(0);
    const oidcPath = join(outputDir, "OIDC_CLIENT_SECRET");
    const oidcDigest = digest(await readFile(oidcPath, "utf8"));
    for (const name of MATERIALIZER_REQUIRED_SECRET_NAMES) {
      if (name !== "OIDC_CLIENT_SECRET") {
        await rm(join(outputDir, name));
      }
    }
    const oidcConflict = await runGenerator(outputDir);
    expect(oidcConflict.exitCode).not.toBe(0);
    expect(oidcConflict.stderr.includes("Refusing to overwrite existing secret files")).toBe(
      true,
    );
    expect(digest(await readFile(oidcPath, "utf8"))).toBe(oidcDigest);

    await rm(oidcPath);
    expect((await runGenerator(outputDir, "--runtime-json")).exitCode).toBe(0);
    const runtimePath = join(outputDir, RUNTIME_SECRETS_FILENAME);
    const runtimeDigest = digest(await readFile(runtimePath, "utf8"));
    for (const name of MATERIALIZER_REQUIRED_SECRET_NAMES) {
      await rm(join(outputDir, name));
    }
    const runtimeConflict = await runGenerator(outputDir, "--runtime-json");
    expect(runtimeConflict.exitCode).not.toBe(0);
    expect(runtimeConflict.stderr.includes("Refusing to overwrite existing secret files")).toBe(
      true,
    );
    expect(digest(await readFile(runtimePath, "utf8"))).toBe(runtimeDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
