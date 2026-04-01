import type { Command } from 'commander';
import { bold, dim, green, red, yellow } from '@std/fmt/colors';
import { readState, writeState, getStateDir } from '../../lib/state/state-file.ts';
import { refreshState } from '../../lib/state/refresh.ts';
import { createStateRefreshProvider } from '../../lib/state/cloudflare-refresh-provider.ts';
import { printJson } from '../../lib/cli-utils.ts';
import type { TakosState } from '../../lib/state/state-types.ts';
import { toAccessOpts } from './helpers.ts';

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
        console.log(dim('No state found. Nothing to refresh.'));
        return;
      }

      const provider = createStateRefreshProvider({
        provider: state.provider,
        accountId: options.accountId?.trim() || Deno.env.get('CLOUDFLARE_ACCOUNT_ID') || Deno.env.get('CF_ACCOUNT_ID') || undefined,
        apiToken: options.apiToken?.trim() || Deno.env.get('CLOUDFLARE_API_TOKEN') || Deno.env.get('CF_API_TOKEN') || undefined,
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
        console.log(green('State is consistent — no orphaned entries found.'));
        return;
      }

      console.log('');
      console.log(bold(`Refresh result for group "${group}":`));
      for (const change of result.changes) {
        const icon = change.action === 'removed' ? red('-') : yellow('!');
        console.log(`  ${icon} ${change.key}: ${change.reason}`);
      }
      console.log('');

      if (options.dryRun) {
        console.log(dim(`Dry run: ${removed} removal(s), ${warnings} warning(s). No changes written.`));
      } else if (removed === 0) {
        console.log(yellow(`Verification completed with ${warnings} warning(s). No changes written.`));
      } else {
        await writeState(stateDir, group, state, accessOpts);
        console.log(green(`Refreshed: ${removed} removed, ${warnings} warning(s).`));
      }
    });
}
