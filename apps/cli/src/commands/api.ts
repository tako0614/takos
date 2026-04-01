import { Command } from 'commander';
import { red, yellow } from '@std/fmt/colors';
import { cliExit } from '../lib/command-exit.ts';
import { executeApiRequest } from './api-request.ts';
import { executeSseStream, executeWebSocketStream } from './api-streams.ts';
import {
  resolveTaskPath,
  buildRunWatchPath,
  buildActionsWatchPath,
} from './api-request.ts';
import type { ApiCommandOptions, StreamCommandOptions, WatchTaskOptions } from './api-request.ts';


interface TaskDomainDefinition {
  name: string;
  aliases?: string[];
  description: string;
  basePath: string;
  watchEnabled?: boolean;
  /** Register the `follow <repoId> <runId>` subcommand for actions streams */
  actionsFollow?: boolean;
  /** Register the `follow <runId>` subcommand for run streams */
  runFollow?: boolean;
}

// ── Consolidated domains ──────────────────────────────────────────────
//
// Merges applied (old → new):
//   pr, actions       → repo      (same basePath /api/repos; sub-resource patterns)
//   memory, reminder  → context   (both basePath /api; semantically related context data)
//   skill, tool       → capability (both basePath /api; agent capability endpoints)
//   oauth             → auth      (basePath widened to /api to cover /api/auth/* and /api/me/oauth/*)
//   search            → discover  (workspace discovery operations)
//
const TASK_DOMAIN_DEFINITIONS: TaskDomainDefinition[] = [
  { name: 'me', description: 'Tasks for /api/me', basePath: '/api/me' },
  { name: 'setup', description: 'Tasks for /api/setup', basePath: '/api/setup' },
  { name: 'workspace', aliases: ['ws'], description: 'Tasks for /api/spaces', basePath: '/api/spaces' },
  { name: 'project', description: 'Tasks for /api/projects', basePath: '/api/projects' },
  { name: 'thread', description: 'Tasks for /api/threads', basePath: '/api/threads', watchEnabled: true },
  { name: 'run', description: 'Tasks for /api/runs', basePath: '/api/runs', watchEnabled: true, runFollow: true },
  { name: 'artifact', description: 'Tasks for /api/artifacts', basePath: '/api/artifacts' },
  { name: 'task', description: 'Tasks for /api/agent-tasks', basePath: '/api/agent-tasks' },
  { name: 'repo', description: 'Tasks for /api/repos (includes pulls, actions)', basePath: '/api/repos', watchEnabled: true, actionsFollow: true },
  { name: 'worker', description: 'Tasks for /api/workers', basePath: '/api/workers' },
  { name: 'app', description: 'Tasks for /api/apps', basePath: '/api/apps' },
  { name: 'resource', description: 'Tasks for /api/resources', basePath: '/api/resources' },
  { name: 'git', description: 'Tasks for /api/git', basePath: '/api/git' },
  { name: 'capability', aliases: ['cap'], description: 'Tasks for skills and tools (/api/spaces/*/skills, /api/spaces/*/tools, /api/skills)', basePath: '/api' },
  { name: 'context', aliases: ['ctx'], description: 'Tasks for memory and reminder endpoints under /api/*', basePath: '/api' },
  { name: 'shortcut', description: 'Tasks for /api/shortcuts', basePath: '/api/shortcuts' },
  { name: 'notification', description: 'Tasks for /api/notifications', basePath: '/api/notifications' },
  { name: 'public-share', description: 'Tasks for /api/public/thread-shares', basePath: '/api/public/thread-shares' },
  { name: 'auth', description: 'Tasks for /api/auth/* and /api/me/oauth/*', basePath: '/api' },
  { name: 'discover', description: 'Tasks for discovery/search endpoints under /api', basePath: '/api' },
];

// Mapping from removed domain names to their replacement and example usage.
const MERGED_DOMAIN_REDIRECTS: Record<string, { replacement: string; example: string }> = {
  pr:       { replacement: 'repo',       example: 'takos repo list /REPO_ID/pulls' },
  actions:  { replacement: 'repo',       example: 'takos repo follow REPO_ID RUN_ID' },
  memory:   { replacement: 'context',    example: 'takos context list /spaces/SPACE_ID/memories' },
  reminder: { replacement: 'context',    example: 'takos context list /spaces/SPACE_ID/reminders' },
  skill:    { replacement: 'capability', example: 'takos capability list /spaces/SPACE_ID/skills' },
  tool:     { replacement: 'capability', example: 'takos capability list /spaces/SPACE_ID/tools' },
  oauth:    { replacement: 'auth',       example: 'takos auth list /me/oauth/connections' },
  search:   { replacement: 'discover',   example: 'takos discover list /spaces/SPACE_ID/search' },
};

const REMOVED_HTTP_STYLE_SUBCOMMANDS = [
  'call',
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'sse',
  'ws',
] as const;

function collectRepeatable(value: string, prev: string[]): string[] {
  return [...(prev || []), value];
}

function applySharedOptions(command: Command, opts?: { includeBody?: boolean }): Command {
  command
    .option('-q, --query <key=value>', 'Query parameter (repeatable)', collectRepeatable, [])
    .option('-H, --header <key=value>', 'Additional header (repeatable)', collectRepeatable, [])
    .option('--workspace <id>', 'Override X-Takos-Space-Id header')
    .option('--json', 'Machine-readable JSON output');

  if (opts?.includeBody) {
    command
      .option('--body <json>', 'JSON body string')
      .option('--body-file <path>', 'Read JSON body from file')
      .option('--raw-body <text>', 'Raw request body (text)')
      .option('--raw-body-file <path>', 'Raw request body from file (binary)')
      .option('--content-type <mime>', 'Content-Type for raw body mode')
      .option('--form <key=value>', 'Form field (repeatable)', collectRepeatable, [])
      .option('--form-file <key=path>', 'Multipart form file field (repeatable)', collectRepeatable, [])
      .option('--output <path>', 'Write response body to file');
  }

  return command;
}

function registerCrudTaskCommands(command: Command, basePath: string): void {
  const crudDefinitions: Array<{
    name: string;
    description: string;
    method: string;
    argSpec: string;
  }> = [
    { name: 'list', description: 'List resources (GET)', method: 'GET', argSpec: '[target]' },
    { name: 'view', description: 'View resource details (GET)', method: 'GET', argSpec: '[target]' },
    { name: 'create', description: 'Create resource (POST)', method: 'POST', argSpec: '[target]' },
    { name: 'replace', description: 'Replace resource (PUT)', method: 'PUT', argSpec: '<target>' },
    { name: 'update', description: 'Update resource (PATCH)', method: 'PATCH', argSpec: '<target>' },
    { name: 'remove', description: 'Remove resource (DELETE)', method: 'DELETE', argSpec: '<target>' },
    { name: 'probe', description: 'Probe resource availability (HEAD)', method: 'HEAD', argSpec: '[target]' },
    { name: 'describe', description: 'Describe resource capabilities (OPTIONS)', method: 'OPTIONS', argSpec: '[target]' },
  ];

  for (const def of crudDefinitions) {
    const subCommand = applySharedOptions(
      command.command(`${def.name} ${def.argSpec}`).description(def.description),
      { includeBody: true }
    );

    subCommand.action(async (target: string | undefined, options: ApiCommandOptions) => {
      await executeApiRequest(def.method, resolveTaskPath(basePath, target), options);
    });
  }
}

function parseTransport(transportInput: string | undefined): 'ws' | 'sse' {
  const transport = (transportInput ?? 'ws').toLowerCase();
  if (transport !== 'ws' && transport !== 'sse') {
    console.log(red(`Unsupported transport: ${transportInput}. Use ws or sse.`));
    cliExit(1);
  }
  return transport;
}

function dispatchStream(transport: 'ws' | 'sse', path: string, options: StreamCommandOptions): Promise<void> {
  if (transport === 'sse') {
    return executeSseStream(path, options);
  }
  return executeWebSocketStream(path, options);
}

function registerWatchTaskCommand(command: Command, basePath: string): void {
  const watchCommand = applySharedOptions(
    command
      .command('watch <target>')
      .description('Watch resource stream')
  )
    .option('--transport <transport>', 'Stream transport (ws|sse)', 'ws')
    .option('--last-event-id <id>', 'Set Last-Event-ID header (SSE only)')
    .option('--send <message>', 'Send message after WS connection (repeatable)', collectRepeatable, []);

  watchCommand.action(async (target: string, options: WatchTaskOptions) => {
    const path = resolveTaskPath(basePath, target);
    const transport = parseTransport(options.transport);
    await dispatchStream(transport, path, options);
  });
}

function registerRunFollowTask(command: Command): void {
  const followCommand = applySharedOptions(
    command
      .command('follow <runId>')
      .description('Follow run events/logs')
  )
    .option('--transport <transport>', 'Stream transport (ws|sse)', 'ws')
    .option('--last-event-id <id>', 'Set Last-Event-ID header (SSE only)')
    .option('--send <message>', 'Send message after WS connection (repeatable)', collectRepeatable, []);

  followCommand.action(async (runId: string, options: WatchTaskOptions) => {
    const transport = parseTransport(options.transport);
    const path = buildRunWatchPath(runId, transport);
    await dispatchStream(transport, path, options);
  });
}

function registerActionsFollowTask(command: Command): void {
  const followCommand = applySharedOptions(
    command
      .command('follow <repoId> <runId>')
      .description('Follow repository action run stream')
  )
    .option('--transport <transport>', 'Stream transport (ws only)', 'ws')
    .option('--send <message>', 'Send message after WS connection (repeatable)', collectRepeatable, []);

  followCommand.action(async (repoId: string, runId: string, options: WatchTaskOptions) => {
    const transport = parseTransport(options.transport);
    if (transport !== 'ws') {
      console.log(red('`takos repo follow` currently supports WebSocket only.'));
      cliExit(1);
    }

    await executeWebSocketStream(buildActionsWatchPath(repoId, runId), options);
  });
}

function registerRemovedHttpStyleSubcommands(command: Command): void {
  for (const removed of REMOVED_HTTP_STYLE_SUBCOMMANDS) {
    const descriptor = removed === 'call'
      ? 'call <method> [path]'
      : `${removed} [path]`;

    command
      .command(descriptor, { hidden: true })
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .action(() => {
        console.log(red('HTTP-verb style commands are removed.'));
        console.log(yellow('Use task-style subcommands: list/view/create/replace/update/remove/probe/describe/watch/follow'));
        cliExit(1);
      });
  }
}

function registerRemovedApiCommand(program: Command): void {
  program
    .command('api [args...]', { hidden: true })
    .description('Removed legacy API command')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      console.log(red('`takos api` is removed.'));
      console.log(yellow('Use task-style commands such as:'));
      console.log('  takos workspace list');
      console.log('  takos workspace create --body ...');
      console.log('  takos run follow <runId> --transport sse');
      console.log('  takos run follow <runId> --transport ws');
      cliExit(1);
    });
}

function registerMergedDomainRedirects(program: Command): void {
  for (const [oldName, { replacement, example }] of Object.entries(MERGED_DOMAIN_REDIRECTS)) {
    program
      .command(oldName, { hidden: true })
      .allowExcessArguments(true)
      .allowUnknownOption(true)
      .action(() => {
        console.log(red(`\`takos ${oldName}\` has been merged into \`takos ${replacement}\`.`));
        console.log(yellow(`Example: ${example}`));
        cliExit(1);
      });
  }
}

export function registerTaskCommands(program: Command): void {
  for (const taskDomain of TASK_DOMAIN_DEFINITIONS) {
    const command = program.command(taskDomain.name).description(taskDomain.description);

    if (taskDomain.aliases) {
      for (const alias of taskDomain.aliases) {
        command.alias(alias);
      }
    }

    registerCrudTaskCommands(command, taskDomain.basePath);

    if (taskDomain.watchEnabled) {
      registerWatchTaskCommand(command, taskDomain.basePath);
    }

    if (taskDomain.runFollow) {
      registerRunFollowTask(command);
    }

    if (taskDomain.actionsFollow) {
      registerActionsFollowTask(command);
    }

    registerRemovedHttpStyleSubcommands(command);
  }

  registerMergedDomainRedirects(program);
  registerRemovedApiCommand(program);
}
