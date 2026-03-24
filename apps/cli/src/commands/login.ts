import { Command } from 'commander';
import chalk from 'chalk';
// open v10+ is ESM-only — use dynamic import for CJS compatibility
async function openUrl(url: string): Promise<void> {
  const { default: open } = await import('open');
  await open(url);
}
import { randomBytes } from 'crypto';
import {
  getConfig,
  saveToken,
  saveApiUrl,
  clearCredentials,
  isContainerMode,
  validateApiUrl,
} from '../lib/config.js';
import { api } from '../lib/api.js';
import { cliExit } from '../lib/command-exit.js';
import { runOAuthCallbackServer, type OAuthCallbackFailureCode } from './login-oauth-callback.js';

/**
 * Generate a cryptographically secure state parameter for CSRF protection
 */
function generateOAuthState(): string {
  return randomBytes(32).toString('hex');
}

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Authenticate with takos platform')
    .option('--api-url <url>', 'API URL (default: https://takos.jp)')
    .action(async (options) => {
      if (isContainerMode()) {
        console.log(chalk.yellow('Running in container mode - authentication is automatic'));
        return;
      }

      const apiUrl = options.apiUrl || getConfig().apiUrl;

      // Validate API URL format and security
      const urlValidation = validateApiUrl(apiUrl);
      if (!urlValidation.valid) {
        console.log(chalk.red(`Invalid API URL: ${urlValidation.error}`));
        cliExit(1);
      }
      if (urlValidation.insecureLocalhostHttp) {
        console.warn(chalk.yellow('Warning: Using insecure HTTP connection. Only use for local development.'));
      }

      console.log(chalk.blue('Opening browser for authentication...'));

      // Generate state parameter for CSRF protection
      const oauthState = generateOAuthState();
      let callbackFailureCode: OAuthCallbackFailureCode | null = null;

      const token = await runOAuthCallbackServer({
        apiUrl,
        oauthState,
        openAuthUrl: openUrl,
        onFailure: (code) => {
          callbackFailureCode = code;
        },
      });

      if (callbackFailureCode !== null || token === null) {
        cliExit(1);
      }

      saveToken(token);
      if (options.apiUrl) {
        saveApiUrl(apiUrl);
      }
    });

  program
    .command('logout')
    .description('Clear stored credentials')
    .action(() => {
      if (isContainerMode()) {
        console.log(chalk.yellow('Running in container mode - cannot logout'));
        return;
      }

      clearCredentials();
      console.log(chalk.green('Logged out successfully'));
    });

  program
    .command('whoami')
    .description('Show current user info')
    .action(async () => {
      const meResult = await api<{
        email?: string;
        name?: string;
        username?: string;
        picture?: string;
        setup_completed?: boolean;
      }>('/api/me');

      if (!meResult.ok) {
        console.log(chalk.red(`Error: ${meResult.error}`));
        cliExit(1);
      }

      const workspacesResult = await api<{ spaces: Array<{ id: string; name: string; role: string }> }>('/api/spaces');
      if (!workspacesResult.ok) {
        console.log(chalk.red(`Error: ${workspacesResult.error}`));
        cliExit(1);
      }

      const user = meResult.data;
      const workspaces = workspacesResult.data.spaces;

      console.log(chalk.bold('\nUser:'));
      console.log(`  Username: ${user.username || '-'}`);
      console.log(`  Email:    ${user.email || '-'}`);
      console.log(`  Name:     ${user.name || '-'}`);
      console.log(`  Setup:    ${user.setup_completed ? 'completed' : 'incomplete'}`);

      if (workspaces.length > 0) {
        console.log(chalk.bold('\nWorkspaces:'));
        for (const ws of workspaces) {
          console.log(`  ${ws.name} (${ws.role})`);
        }
      }
    });
}
