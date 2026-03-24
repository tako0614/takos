import { runCommand } from './command.js';

export async function runGitCommand(
  args: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<{ exitCode: number; output: string }> {
  const logs: string[] = [];
  const exitCode = await runCommand('git', args, {
    cwd,
    logs,
    env: { ...env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { exitCode, output: logs.join('\n') };
}

interface CloneAndCheckoutOptions {
  repoUrl: string;
  targetDir: string;
  ref?: string;
  shallow?: boolean;
  env?: Record<string, string>;
}

interface CloneAndCheckoutResult {
  success: boolean;
  output: string;
  checkedOutRef?: string;
}

function buildCloneArgs(repoUrl: string, options?: { shallow?: boolean; branch?: string }): string[] {
  const args = ['clone'];
  if (options?.shallow) args.push('--depth', '1');
  if (options?.branch) args.push('--branch', options.branch);
  args.push(repoUrl, '.');
  return args;
}

export async function cloneAndCheckout(
  options: CloneAndCheckoutOptions
): Promise<CloneAndCheckoutResult> {
  const { repoUrl, targetDir, ref, shallow = true, env } = options;
  const outputs: string[] = [];

  const isSha = ref ? /^[0-9a-f]{40}$/i.test(ref) : false;
  const branch = (ref && !isSha) ? ref : undefined;

  async function run(args: string[]): Promise<{ exitCode: number; output: string }> {
    const result = await runGitCommand(args, targetDir, env);
    outputs.push(result.output);
    return result;
  }

  async function getCurrentRef(): Promise<CloneAndCheckoutResult> {
    const revParseResult = await run(['rev-parse', '--abbrev-ref', 'HEAD']);
    return {
      success: true,
      output: outputs.join('\n'),
      checkedOutRef: revParseResult.output.trim() || ref,
    };
  }

  function failResult(): CloneAndCheckoutResult {
    return { success: false, output: outputs.join('\n') };
  }

  // Attempt 1: clone with branch ref
  const cloneResult = await run(buildCloneArgs(repoUrl, { shallow, branch }));
  if (cloneResult.exitCode === 0) {
    return getCurrentRef();
  }

  // Attempt 2: basic clone without branch
  outputs.push('Direct branch clone failed, trying alternative approach...');
  const basicCloneResult = await run(buildCloneArgs(repoUrl, { shallow }));

  if (basicCloneResult.exitCode !== 0) {
    if (!shallow) return failResult();

    // Attempt 3: full clone (no shallow)
    outputs.push('Shallow clone failed, trying full clone...');
    const fullCloneResult = await run(buildCloneArgs(repoUrl));
    if (fullCloneResult.exitCode !== 0) return failResult();
  }

  // Checkout the requested ref if needed
  if (ref) {
    await run(['fetch', 'origin', ref]);
    const checkoutResult = await run(['checkout', ref]);

    if (checkoutResult.exitCode !== 0) {
      const fetchHeadResult = await run(['checkout', 'FETCH_HEAD']);
      if (fetchHeadResult.exitCode !== 0) return failResult();
    }
  }

  return getCurrentRef();
}
