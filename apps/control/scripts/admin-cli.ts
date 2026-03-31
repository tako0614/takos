#!/usr/bin/env npx tsx
/**
 * Unified admin CLI for takos-control.
 *
 * - D1 operations use Cloudflare D1 Management API.
 * - R2 operations use Cloudflare R2 Management API.
 * - Moderation commands support ban/unban/show-user.
 *
 * Usage examples:
 *   npx tsx scripts/admin-cli.ts d1 ping --env production
 *   npx tsx scripts/admin-cli.ts d1 query "SELECT COUNT(*) AS c FROM users"
 *   npx tsx scripts/admin-cli.ts r2 list offload --prefix backups/d1
 *   npx tsx scripts/admin-cli.ts moderation ban USER_ID --reason "abuse"
 */

import { sanitizeErrorMessage } from 'takos-control/core/wfp-client';
import {
  type GlobalOptions,
  type ResolvedConfig,
  AUDIT_LOG_FILE,
  WRANGLER_TOML_PATH,
  appendAuditLog,
  fail,
  nowIso,
  parseGlobalOptions,
  print,
  resolveConfig,
} from './admin/index.ts';
import { cmdD1Ping, cmdD1Query, cmdD1Tables } from './admin/d1-commands.ts';
import { cmdR2Delete, cmdR2Get, cmdR2List, cmdR2Put, cmdR2UploadDir } from './admin/r2-commands.ts';
import { cmdModerationBan, cmdModerationShowUser, cmdModerationUnban } from './admin/moderation-commands.ts';
import { cmdReposBranches, cmdReposList, cmdUsersList } from './admin/platform-commands.ts';
import {
  cmdSecretsGenerateJwt,
  cmdSecretsPrune,
  cmdSecretsPut,
  cmdSecretsStatus,
  cmdSecretsSync,
} from './admin/secrets-commands.ts';

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function showHelp(): void {
  console.log(`
Unified Admin CLI (Cloudflare API based)

Usage:
  npx tsx scripts/admin-cli.ts <group> <command> [args] [options]

Global options:
  --env <production|staging>   Target environment (default: production)
  --json                       JSON output
  --approval-id <id>           Required for tenant/workspace data access
  --scope-workspace-id <id>    Required scope for tenant/workspace D1 access
  --scope-user-id <id>         Required scope for tenant/workspace D1 access
  --scope-r2-prefix <prefix>   Required scope prefix for tenant/workspace R2 access
  --account-id <id>            Override Cloudflare account ID
  --api-token <token>          Override Cloudflare API token
  --database-id <id>           Override D1 database_id
  --remote                     Alias of --env production
  --staging                    Alias of --env staging

Commands:
  config show
  d1 ping
  d1 tables
  d1 query "<sql>"

  r2 list <bucket> [--prefix <prefix>] [--cursor <cursor>] [--limit <n>]
  r2 get <bucket> <key> [--output <path>]
  r2 put <bucket> <key> <file> [--content-type <type>]
  r2 delete <bucket> <key>
  r2 upload-dir <bucket> <dir> [prefix] [--content-type <type>]

  users list [--limit <n>]
  repos list [--limit <n>]
  repos branches <repo_id_or_name>

  moderation show-user <user_id>
  moderation ban <user_id> [--reason <text>] [--actor-user-id <id>]
  moderation unban <user_id> [--reason <text>] [--actor-user-id <id>]

  secrets status
  secrets sync [--dry-run] [--worker <alias>]
  secrets put <SECRET_NAME> [--value-file <path>] [--worker <alias>]
  secrets prune [--dry-run] [--worker <alias>]
  secrets generate-jwt [--prefix platform|service] [--upload] [--output-dir <path>]

R2 bucket aliases:
  bundles, builds, source, git, offload

Worker aliases (for secrets):
  web, runner, indexer, workflow-runner, runtime-host, executor, dispatch, egress

Secrets directory structure:
  .secrets/<env>/<SECRET_NAME>   (one file per secret, .gitignored)
`);
}

// ---------------------------------------------------------------------------
// Config show command
// ---------------------------------------------------------------------------

async function cmdConfigShow(config: ResolvedConfig, options: GlobalOptions): Promise<number> {
  const payload = {
    environment: config.environment,
    account_id: config.accountId,
    d1_database_id: config.d1DatabaseId || null,
    wrangler_toml: WRANGLER_TOML_PATH,
    r2_aliases: config.r2Buckets,
  };

  if (options.isJson) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('Resolved configuration:');
    console.log(`  environment: ${payload.environment}`);
    console.log(`  account_id: ${payload.account_id}`);
    console.log(`  d1_database_id: ${payload.d1_database_id || '(unset)'}`);
    console.log(`  wrangler_toml: ${payload.wrangler_toml}`);
    console.log('  r2_aliases:');
    for (const [alias, bucket] of Object.entries(payload.r2_aliases).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`    ${alias} -> ${bucket}`);
    }
  }

  return 1;
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

function summarizeCommand(args: string[]): string {
  const sanitized = [...args];
  const tokenIndex = sanitized.indexOf('--api-token');
  if (tokenIndex >= 0 && sanitized[tokenIndex + 1]) {
    sanitized[tokenIndex + 1] = '[REDACTED]';
  }
  return sanitized.join(' ');
}

async function dispatchCommand(config: ResolvedConfig, options: GlobalOptions, args: string[]): Promise<number> {
  if (args.length === 0) {
    showHelp();
    return 0;
  }

  const [group, command, ...rest] = args;

  if (group === 'help' || group === '--help') {
    showHelp();
    return 0;
  }

  if (group === 'config') {
    if (command === 'show') {
      return cmdConfigShow(config, options);
    }
    fail('Unknown config command. Use: config show');
  }

  if (group === 'd1') {
    if (command === 'ping') {
      return cmdD1Ping(config, options);
    }
    if (command === 'tables') {
      return cmdD1Tables(config, options);
    }
    if (command === 'query') {
      return cmdD1Query(config, options, rest);
    }
    fail('Unknown d1 command. Use: d1 ping | d1 tables | d1 query');
  }

  if (group === 'r2') {
    if (command === 'list') {
      return cmdR2List(config, options, rest);
    }
    if (command === 'get') {
      return cmdR2Get(config, options, rest);
    }
    if (command === 'put') {
      return cmdR2Put(config, options, rest);
    }
    if (command === 'delete') {
      return cmdR2Delete(config, options, rest);
    }
    if (command === 'upload-dir') {
      return cmdR2UploadDir(config, options, rest);
    }
    fail('Unknown r2 command. Use: r2 list|get|put|delete|upload-dir');
  }

  if (group === 'users') {
    if (command === 'list') {
      return cmdUsersList(config, options, rest);
    }
    fail('Unknown users command. Use: users list');
  }

  if (group === 'repos') {
    if (command === 'list') {
      return cmdReposList(config, options, rest);
    }
    if (command === 'branches') {
      return cmdReposBranches(config, options, rest);
    }
    fail('Unknown repos command. Use: repos list|branches');
  }

  if (group === 'moderation') {
    if (command === 'show-user') {
      return cmdModerationShowUser(config, options, rest);
    }
    if (command === 'ban') {
      return cmdModerationBan(config, options, rest);
    }
    if (command === 'unban') {
      return cmdModerationUnban(config, options, rest);
    }
    fail('Unknown moderation command. Use: moderation show-user|ban|unban');
  }

  if (group === 'secrets') {
    if (command === 'status') {
      return cmdSecretsStatus(config, options);
    }
    if (command === 'sync') {
      return cmdSecretsSync(config, options, rest);
    }
    if (command === 'put') {
      return cmdSecretsPut(config, options, rest);
    }
    if (command === 'prune') {
      return cmdSecretsPrune(config, options, rest);
    }
    if (command === 'generate-jwt') {
      return cmdSecretsGenerateJwt(config, options, rest);
    }
    fail('Unknown secrets command. Use: secrets status|sync|put|prune|generate-jwt');
  }

  fail(`Unknown command group: ${group}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const { remainingArgs, options } = parseGlobalOptions(rawArgs);

  if (
    remainingArgs.length === 0 ||
    remainingArgs[0] === 'help' ||
    remainingArgs.includes('--help') ||
    remainingArgs.includes('-h')
  ) {
    showHelp();
    return;
  }

  // secrets commands use wrangler CLI directly and don't need CF API config
  if (remainingArgs[0] === 'secrets') {
    const [, command, ...rest] = remainingArgs;
    const dummyConfig = { environment: options.environment, accountId: '', apiToken: '', r2Buckets: {} } as ResolvedConfig;
    if (command === 'status') { await cmdSecretsStatus(dummyConfig, options); return; }
    if (command === 'sync') { await cmdSecretsSync(dummyConfig, options, rest); return; }
    if (command === 'put') { await cmdSecretsPut(dummyConfig, options, rest); return; }
    if (command === 'prune') { await cmdSecretsPrune(dummyConfig, options, rest); return; }
    if (command === 'generate-jwt') { await cmdSecretsGenerateJwt(dummyConfig, options, rest); return; }
    fail('Unknown secrets command. Use: secrets status|sync|put|prune|generate-jwt');
  }

  const config = resolveConfig(options);
  const start = nowIso();
  const commandSummary = summarizeCommand([...remainingArgs]);
  let success = false;
  let count: number | null = null;
  let errorMessage: string | undefined;

  try {
    count = await dispatchCommand(config, options, remainingArgs);
    success = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessage = sanitizeErrorMessage(message);
    throw error;
  } finally {
    appendAuditLog({
      command: commandSummary,
      env: config.environment,
      start,
      end: nowIso(),
      success,
      count,
      error: errorMessage,
    });

    print(`Audit log: ${AUDIT_LOG_FILE}`, options.isJson);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${sanitizeErrorMessage(message)}`);
  Deno.exit(1);
});
