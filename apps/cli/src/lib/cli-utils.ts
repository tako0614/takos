/**
 * Shared CLI utility functions.
 *
 * These helpers are used across multiple CLI command files.
 * Centralised here to avoid duplication.
 */
import readline from "node:readline";
import { dim, red } from "@std/fmt/colors";
import { cliExit } from "./command-exit.ts";
import { getConfig } from "./config.ts";
import {
  type GroupProviderName,
  parseGroupProvider,
} from "./group-provider.ts";

/**
 * Resolve the Cloudflare account ID from an explicit override,
 * environment variables, or exit with an error.
 */
export function resolveAccountId(override?: string): string {
  const accountId = override || Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ||
    Deno.env.get("CF_ACCOUNT_ID") || "";
  if (!accountId.trim()) {
    console.log(red("Cloudflare account ID is required."));
    console.log(dim("Pass --account-id, or set CLOUDFLARE_ACCOUNT_ID."));
    cliExit(1);
  }
  return accountId.trim();
}

/**
 * Resolve the Cloudflare API token from an explicit override,
 * environment variables, or exit with an error.
 */
export function resolveApiToken(override?: string): string {
  const apiToken = override || Deno.env.get("CLOUDFLARE_API_TOKEN") ||
    Deno.env.get("CF_API_TOKEN") || "";
  if (!apiToken.trim()) {
    console.log(red("Cloudflare API token is required."));
    console.log(dim("Pass --api-token, or set CLOUDFLARE_API_TOKEN."));
    cliExit(1);
  }
  return apiToken.trim();
}

/**
 * Resolve the target workspace (space) ID from an explicit override,
 * config, or exit with an error.
 */
export function resolveSpaceId(spaceOverride?: string): string {
  const spaceId = String(spaceOverride || getConfig().spaceId || "").trim();
  if (!spaceId) {
    console.log(
      red(
        "Workspace ID is required. Pass --space or configure a default workspace.",
      ),
    );
    cliExit(1);
  }
  return spaceId;
}

/** Resolve the deployment provider from a CLI option or exit with an error. */
export function resolveGroupProviderOption(
  raw?: string,
): GroupProviderName | undefined {
  try {
    return parseGroupProvider(raw);
  } catch (error) {
    console.log(
      red(error instanceof Error ? error.message : "Invalid provider"),
    );
    cliExit(1);
  }
}

/** Write a value as pretty-printed JSON to stdout. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Interactive yes/no confirmation prompt. Resolves to `true` for "yes" or "y". */
export function confirmPrompt(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(
        answer.trim().toLowerCase() === "yes" ||
          answer.trim().toLowerCase() === "y",
      );
    });
  });
}
