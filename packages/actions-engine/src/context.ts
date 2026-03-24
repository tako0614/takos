/**
 * Context management for workflow execution
 */
import type {
  ExecutionContext,
  GitHubContext,
  RunnerContext,
  InputsContext,
} from './types.js';

// ---------------------------------------------------------------------------
// Base context
// ---------------------------------------------------------------------------

/**
 * Context builder options
 */
export interface ContextBuilderOptions {
  /** GitHub context overrides */
  github?: Partial<GitHubContext>;
  /** Runner context overrides */
  runner?: Partial<RunnerContext>;
  /** Environment variables */
  env?: Record<string, string>;
  /** Repository variables */
  vars?: Record<string, string>;
  /** Secrets */
  secrets?: Record<string, string>;
  /** Workflow dispatch inputs */
  inputs?: InputsContext;
}

/**
 * Create a base execution context
 */
export function createBaseContext(
  options: ContextBuilderOptions = {}
): ExecutionContext {
  const os = process.platform;
  const arch = process.arch;

  const github: GitHubContext = {
    event_name: 'push',
    event: {},
    ref: 'refs/heads/main',
    ref_name: 'main',
    sha: '0000000000000000000000000000000000000000',
    repository: 'owner/repo',
    repository_owner: 'owner',
    actor: 'actor',
    workflow: 'workflow',
    job: 'job',
    run_id: '1',
    run_number: 1,
    run_attempt: 1,
    server_url: 'https://github.com',
    api_url: 'https://api.github.com',
    graphql_url: 'https://api.github.com/graphql',
    workspace: '/home/runner/work/repo/repo',
    action: '',
    action_path: '',
    token: '',
    ...options.github,
  };

  const osName = os === 'win32' ? 'Windows' as const : os === 'darwin' ? 'macOS' as const : 'Linux' as const;
  const archMap: Record<string, 'X64' | 'ARM64' | 'ARM' | 'X86'> = { x64: 'X64', arm64: 'ARM64', arm: 'ARM' };
  const archName = archMap[arch] ?? 'X86';

  const runner: RunnerContext = {
    name: 'local-runner',
    os: osName,
    arch: archName,
    temp: process.env.RUNNER_TEMP || '/tmp',
    tool_cache: process.env.RUNNER_TOOL_CACHE || '/opt/hostedtoolcache',
    debug: process.env.RUNNER_DEBUG || '',
    ...options.runner,
  };

  return {
    github,
    env: options.env || {},
    vars: options.vars || {},
    secrets: options.secrets || {},
    runner,
    job: { status: 'success' },
    steps: {},
    needs: {},
    inputs: options.inputs,
  };
}

// ---------------------------------------------------------------------------
// Environment variable management
// ---------------------------------------------------------------------------

const GITHUB_ENV_HEREDOC_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]*)<<(.+)$/;
const GITHUB_ENV_SIMPLE_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/;

/**
 * Parse GITHUB_ENV file format
 * Format:
 *   NAME=value
 *   or
 *   NAME<<EOF
 *   multiline
 *   value
 *   EOF
 */
export function parseGitHubEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = content
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || line.startsWith('#')) {
      i++;
      continue;
    }

    // Check for heredoc format: NAME<<DELIMITER
    const heredocMatch = line.match(GITHUB_ENV_HEREDOC_PATTERN);
    if (heredocMatch) {
      const [, name, delimiter] = heredocMatch;
      const valueLines: string[] = [];
      i++;

      while (i < lines.length && lines[i] !== delimiter) {
        valueLines.push(lines[i]);
        i++;
      }

      env[name] = valueLines.join('\n');
      i++; // Skip delimiter line
      continue;
    }

    // Simple format: NAME=value
    const simpleMatch = line.match(GITHUB_ENV_SIMPLE_PATTERN);
    if (simpleMatch) {
      const [, name, value] = simpleMatch;
      env[name] = value;
    }

    i++;
  }

  return env;
}
