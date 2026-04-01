import * as fs from 'node:fs/promises';
import type { ActionContext } from '../executor.ts';
import { pushLog } from '../../logging.ts';
import { runGitCommand, cloneAndCheckout } from '../../git.ts';
import { resolvePathWithin } from '../../paths.ts';
import { GIT_ENDPOINT_URL } from '../../../shared/config.ts';

export async function checkout(
  inputs: {
    ref?: string;
    path?: string;
    repository?: string;
    token?: string;
    'fetch-depth'?: number;
  },
  context: ActionContext
): Promise<void> {
  pushLog(context.logs, 'Running actions/checkout');

  const checkoutPath = inputs.path
    ? resolvePathWithin(context.workspacePath, inputs.path, 'checkout path')
    : context.workspacePath;

  const repository = inputs.repository || context.env.GITHUB_REPOSITORY || '';
  const ref = inputs.ref || context.env.GITHUB_REF || 'main';
  const fetchDepth = inputs['fetch-depth'] ?? 1;

  pushLog(context.logs, `Repository: ${repository}`);
  pushLog(context.logs, `Ref: ${ref}`);
  pushLog(context.logs, `Path: ${checkoutPath}`);

  await fs.mkdir(checkoutPath, { recursive: true });

  const gitUrl = repository.includes('://')
    ? repository
    : `${GIT_ENDPOINT_URL}/${repository}.git`;

  const cloneResult = await cloneAndCheckout({
    repoUrl: gitUrl,
    targetDir: checkoutPath,
    ref,
    shallow: fetchDepth > 0,
    env: context.env,
  });

  if (!cloneResult.success) {
    throw new Error(`Git clone failed: ${cloneResult.output}`);
  }

  const revParseResult = await runGitCommand(['rev-parse', 'HEAD'], checkoutPath, context.env);
  if (revParseResult.exitCode === 0) {
    const sha = revParseResult.output.trim();
    context.setOutput('sha', sha);
    pushLog(context.logs, `Checked out: ${sha}`);
  }

  pushLog(context.logs, 'Checkout completed successfully');
}
