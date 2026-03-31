/**
 * ワークフロー実行のコンテキスト管理
 */
import type {
  ExecutionContext,
  GitHubContext,
  RunnerContext,
  InputsContext,
} from './workflow-models.ts';

// ---------------------------------------------------------------------------
// ベースコンテキスト
// ---------------------------------------------------------------------------

/**
 * コンテキスト生成時のオプション
 */
export interface ContextBuilderOptions {
  /** GitHub コンテキストの上書き値 */
  github?: Partial<GitHubContext>;
  /** Runner コンテキストの上書き値 */
  runner?: Partial<RunnerContext>;
  /** 環境変数 */
  env?: Record<string, string>;
  /** リポジトリ変数 */
  vars?: Record<string, string>;
  /** シークレット */
  secrets?: Record<string, string>;
  /** ワークフローディスパッチ入力 */
  inputs?: InputsContext;
}

/**
 * ベース実行コンテキストを作成する
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
    temp: Deno.env.get('RUNNER_TEMP') || '/tmp',
    tool_cache: Deno.env.get('RUNNER_TOOL_CACHE') || '/opt/hostedtoolcache',
    debug: Deno.env.get('RUNNER_DEBUG') || '',
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
// 環境変数管理
// ---------------------------------------------------------------------------

const GITHUB_ENV_HEREDOC_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]*)<<(.+)$/;
const GITHUB_ENV_SIMPLE_PATTERN = /^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$/;

/**
 * GITHUB_ENV ファイル形式のパース
 * 形式:
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

    // ヒアドキュメント形式(NAME<<DELIMITER)を確認
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

    // シンプル形式: NAME=value
    const simpleMatch = line.match(GITHUB_ENV_SIMPLE_PATTERN);
    if (simpleMatch) {
      const [, name, value] = simpleMatch;
      env[name] = value;
    }

    i++;
  }

  return env;
}
