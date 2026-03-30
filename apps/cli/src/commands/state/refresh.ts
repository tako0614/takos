import { Command } from 'commander';
import chalk from 'chalk';
import { readState, writeState, getStateDir } from '../../lib/state/state-file.js';
import { refreshState } from '../../lib/state/refresh.js';
import { createStateRefreshProvider } from '../../lib/state/cloudflare-refresh-provider.js';
import { printJson } from '../../lib/cli-utils.js';
import type { TakosState } from '../../lib/state/state-types.js';
import { toAccessOpts } from './helpers.js';

export function registerStateRefreshCommand(stateCmd: Command): void {
  stateCmd
    .command('refresh')
    .description('Verify live resources where possible and remove confirmed orphaned entries')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .option('--offline', 'Force file-based state (skip API)')
    .option('--dry-run', 'Show what would change without modifying state')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .action(async (options: { group: string; json?: boolean; offline?: boolean; dryRun?: boolean; accountId?: string; apiToken?: string }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.dim('No state found. Nothing to refresh.'));
        return;
      }

      const provider = createStateRefreshProvider({
        provider: state.provider,
        accountId: options.accountId?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || undefined,
        apiToken: options.apiToken?.trim() || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || undefined,
      });

      // Work on a copy for dry-run; mutate the original otherwise
      const workingState = options.dryRun
        ? structuredClone(state)
        : state;

      const result = await refreshState(workingState, provider);

      if (options.json) {
        printJson(result);
        return;
      }

      const removed = result.changes.filter((c) => c.action === 'removed').length;
      const warnings = result.changes.filter((c) => c.action === 'warning').length;

      if (removed === 0 && warnings === 0) {
        console.log(chalk.green('State is consistent — no orphaned entries found.'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`Refresh result for group "${group}":`));
      for (const change of result.changes) {
        const icon = change.action === 'removed' ? chalk.red('-') : chalk.yellow('!');
        console.log(`  ${icon} ${change.key}: ${change.reason}`);
      }
      console.log('');

      if (options.dryRun) {
        console.log(chalk.dim(`Dry run: ${removed} removal(s), ${warnings} warning(s). No changes written.`));
      } else if (removed === 0) {
        console.log(chalk.yellow(`Verification completed with ${warnings} warning(s). No changes written.`));
      } else {
        await writeState(stateDir, group, state, accessOpts);
        console.log(chalk.green(`Refreshed: ${removed} removed, ${warnings} warning(s).`));
      }
    });
}
