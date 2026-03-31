import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

export const CLI_AUTH_ENV_VARS = [
  "HOME",
  "TAKOS_SESSION_ID",
  "TAKOS_TOKEN",
  "TAKOS_API_URL",
  "TAKOS_WORKSPACE_ID",
] as const;

type ManagedEnvVar = typeof CLI_AUTH_ENV_VARS[number];

export interface CliTestContext {
  homeDir: string;
  workspaceDir: string;
  configFile: string;
  sessionFile: string;
  importFresh<T>(relativePath: string): Promise<T>;
  readConfig(): Record<string, unknown> | null;
  writeConfig(value: Record<string, unknown>): void;
  writeSessionFile(
    value: Record<string, unknown> | string,
    mode?: number,
  ): void;
}

export interface CliTestEnvHandle extends CliTestContext {
  reset(): void;
  dispose(): void;
}

export function createCliTestEnv(): CliTestEnvHandle {
  const homeDir = mkdtempSync(join(tmpdir(), "takos-cli-home-"));
  const workspaceDir = mkdtempSync(join(tmpdir(), "takos-cli-workspace-"));
  const configFile = join(homeDir, ".takos", "config.json");
  const sessionFile = join(workspaceDir, ".takos-session");
  const originalEnv = Object.fromEntries(
    CLI_AUTH_ENV_VARS.map((envVar) => [envVar, Deno.env.get(envVar)]),
  ) as Record<ManagedEnvVar, string | undefined>;
  const originalCwd = process.cwd();

  const reset = (): void => {
    for (const envVar of CLI_AUTH_ENV_VARS) {
      if (envVar !== "HOME") {
        Deno.env.delete(envVar);
      }
    }
    rmSync(configFile, { force: true });
    rmSync(sessionFile, { force: true });
  };

  const dispose = (): void => {
    process.chdir(originalCwd);
    for (const envVar of CLI_AUTH_ENV_VARS) {
      const originalValue = originalEnv[envVar];
      if (originalValue === undefined) {
        Deno.env.delete(envVar);
      } else {
        Deno.env.set(envVar, originalValue);
      }
    }
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  };

  for (const envVar of CLI_AUTH_ENV_VARS) {
    Deno.env.delete(envVar);
  }
  Deno.env.set("HOME", homeDir);
  process.chdir(workspaceDir);

  return {
    homeDir,
    workspaceDir,
    configFile,
    sessionFile,
    reset,
    dispose,
    async importFresh<T>(relativePath: string): Promise<T> {
      const url = new URL(relativePath, import.meta.url);
      url.searchParams.set("case", crypto.randomUUID());
      return await import(url.href) as T;
    },
    readConfig(): Record<string, unknown> | null {
      try {
        return JSON.parse(readFileSync(configFile, "utf-8")) as Record<
          string,
          unknown
        >;
      } catch {
        return null;
      }
    },
    writeConfig(value: Record<string, unknown>): void {
      mkdirSync(join(homeDir, ".takos"), { recursive: true });
      writeFileSync(configFile, JSON.stringify(value, null, 2));
    },
    writeSessionFile(
      value: Record<string, unknown> | string,
      mode = 0o600,
    ): void {
      const contents = typeof value === "string"
        ? value
        : JSON.stringify(value);
      writeFileSync(sessionFile, contents, { mode });
    },
  };
}

export async function withCliTestEnv(
  run: (ctx: CliTestContext) => Promise<void> | void,
): Promise<void> {
  const env = createCliTestEnv();
  try {
    await run(env);
  } finally {
    env.dispose();
  }
}
