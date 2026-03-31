import { Command } from 'commander';
import { blue, bold, green, red, yellow } from '@std/fmt/colors';
import { randomBytes } from 'crypto';

async function openUrl(url: string): Promise<void> {
  const cmd = Deno.build.os === 'darwin' ? 'open'
    : Deno.build.os === 'windows' ? 'cmd'
    : 'xdg-open';
  const args = Deno.build.os === 'windows' ? ['/c', 'start', url] : [url];
  const command = new Deno.Command(cmd, { args, stdout: 'null', stderr: 'null' });
  const child = command.spawn();
  await child.status;
}
import {
  getConfig,
  saveToken,
  saveApiUrl,
  clearCredentials,
  isContainerMode,
  validateApiUrl,
} from '../lib/config.ts';
import { api } from '../lib/api.ts';
import { cliExit } from '../lib/command-exit.ts';
import { runOAuthCallbackServer, type OAuthCallbackFailureCode } from './login-oauth-callback.ts';

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
        console.log(yellow('Running in container mode - authentication is automatic'));
        return;
      }

      const apiUrl = options.apiUrl || getConfig().apiUrl;

      // Validate API URL format and security
      const urlValidation = validateApiUrl(apiUrl);
      if (!urlValidation.valid) {
        console.log(red(`Invalid API URL: ${urlValidation.error}`));
        cliExit(1);
      }
      if (urlValidation.insecureLocalhostHttp) {
        console.warn(yellow('Warning: Using insecure HTTP connection. Only use for local development.'));
      }

      console.log(blue('Opening browser for authentication...'));

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
        console.log(yellow('Running in container mode - cannot logout'));
        return;
      }

      clearCredentials();
      console.log(green('Logged out successfully'));
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
        console.log(red(`Error: ${meResult.error}`));
        cliExit(1);
      }

      const workspacesResult = await api<{ spaces: Array<{ id: string; name: string; role: string }> }>('/api/spaces');
      if (!workspacesResult.ok) {
        console.log(red(`Error: ${workspacesResult.error}`));
        cliExit(1);
      }

      const user = meResult.data;
      const workspaces = workspacesResult.data.spaces;

      console.log(bold('\nUser:'));
      console.log(`  Username: ${user.username || '-'}`);
      console.log(`  Email:    ${user.email || '-'}`);
      console.log(`  Name:     ${user.name || '-'}`);
      console.log(`  Setup:    ${user.setup_completed ? 'completed' : 'incomplete'}`);

      if (workspaces.length > 0) {
        console.log(bold('\nWorkspaces:'));
        for (const ws of workspaces) {
          console.log(`  ${ws.name} (${ws.role})`);
        }
      }
    });
}
