/**
 * Shared formatter for apply results.
 */
import chalk from 'chalk';
import type { ApplyResult } from './coordinator.js';

export interface PrintApplyResultOptions {
  title?: string;
  dryRun?: boolean;
}

/**
 * Print a human-readable apply result to the console.
 */
export function printApplyResult(
  result: ApplyResult,
  env: string,
  groupName: string,
  options: PrintApplyResultOptions = {},
): void {
  const titlePrefix = options.dryRun ? '[DRY RUN] ' : '';
  const title = options.title || 'Apply';

  console.log('');
  console.log(chalk.bold(`${titlePrefix}${title}: ${groupName}`));
  console.log(`  Environment: ${env}`);
  console.log('');

  if (result.applied.length > 0) {
    console.log(chalk.bold('Applied:'));
    for (const entry of result.applied) {
      const icon = entry.status === 'success' ? chalk.green('+') : chalk.red('!');
      const errorInfo = entry.error ? chalk.red(` -- ${entry.error}`) : '';
      console.log(`  ${icon} ${entry.name} [${entry.category}] ${entry.action}${errorInfo}`);
    }
    console.log('');
  }

  if (result.skipped.length > 0) {
    console.log(chalk.bold('Unchanged:'));
    for (const name of result.skipped) {
      console.log(`  ${chalk.dim('=')} ${name}`);
    }
    console.log('');
  }

  const succeeded = result.applied.filter(e => e.status === 'success').length;
  const failed = result.applied.filter(e => e.status === 'failed').length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Applied:   ${succeeded} succeeded, ${failed} failed`);
  console.log(`  Unchanged: ${result.skipped.length}`);

  if (failed > 0) {
    console.log('');
    console.log(chalk.red('Some steps failed. Review errors above.'));
  } else if (!options.dryRun) {
    console.log('');
    console.log(chalk.green('Apply completed successfully.'));
  }
}
