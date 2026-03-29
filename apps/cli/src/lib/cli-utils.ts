/**
 * Shared CLI utility functions.
 *
 * These helpers are used across multiple CLI command files.
 * Centralised here to avoid duplication.
 */
import readline from 'node:readline';
import chalk from 'chalk';
import { cliExit } from './command-exit.js';

/**
 * Resolve the Cloudflare account ID from an explicit override,
 * environment variables, or exit with an error.
 */
export function resolveAccountId(override?: string): string {
  const accountId = override || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '';
  if (!accountId.trim()) {
    console.log(chalk.red('Cloudflare account ID is required.'));
    console.log(chalk.dim('Pass --account-id, or set CLOUDFLARE_ACCOUNT_ID.'));
    cliExit(1);
  }
  return accountId.trim();
}

/**
 * Resolve the Cloudflare API token from an explicit override,
 * environment variables, or exit with an error.
 */
export function resolveApiToken(override?: string): string {
  const apiToken = override || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
  if (!apiToken.trim()) {
    console.log(chalk.red('Cloudflare API token is required.'));
    console.log(chalk.dim('Pass --api-token, or set CLOUDFLARE_API_TOKEN.'));
    cliExit(1);
  }
  return apiToken.trim();
}

/** Write a value as pretty-printed JSON to stdout. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Interactive yes/no confirmation prompt. Resolves to `true` for "yes" or "y". */
export function confirmPrompt(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes' || answer.trim().toLowerCase() === 'y');
    });
  });
}
