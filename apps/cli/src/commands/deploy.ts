import { Command } from 'commander';
import chalk from 'chalk';
import { validateAppManifest } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { printJson } from '../lib/cli-utils.js';

type DeployCommandOptions = {
  space?: string;
  repo?: string;
  ref?: string;
  refType?: 'branch' | 'tag' | 'commit';
  approveOauthAutoEnv?: boolean;
  approveSourceChange?: boolean;
  json?: boolean;
};

const DEPLOY_REMOVED_MESSAGE = [
  '`takos deploy` is not available in the current implementation.',
  'Use `takos deploy-group` or `takos apply` for active deployment flows.',
];

function exitRemovedDeployCommand(commandName: string): never {
  console.log(chalk.red(`${commandName} is removed.`));
  for (const line of DEPLOY_REMOVED_MESSAGE) {
    console.log(line);
  }
  cliExit(1);
}

export function registerDeployCommand(program: Command): void {
  const deploy = program
    .command('deploy')
    .description('Removed. Use `takos deploy-group` or `takos apply` instead.');

  deploy
    .option('--space <id>', 'Target workspace ID')
    .requiredOption('--repo <id>', 'Repository ID used to resolve .takos/app.yml and workflow artifacts')
    .option('--ref <ref>', 'Source ref used to resolve .takos/app.yml and workflow artifacts')
    .option('--ref-type <type>', 'Source ref type (branch|tag|commit)', 'branch')
    .option('--approve-oauth-auto-env', 'Approve OAuth auto env changes')
    .option('--approve-source-change', 'Approve source provenance change for replacement deploys')
    .option('--json', 'Machine-readable output')
    .action(async (_options: DeployCommandOptions) => {
      exitRemovedDeployCommand('`takos deploy`');
    });

  deploy
    .command('validate')
    .description('Validate local .takos/app.yml')
    .option('--json', 'Machine-readable output')
    .action(async (options: { json?: boolean }) => {
      const { manifestPath, manifest } = await validateAppManifest(process.cwd());
      const summary = {
        manifest_path: manifestPath,
        app: manifest.metadata.name,
        version: manifest.spec.version,
        workers: Object.keys(manifest.spec.workers),
        resources: Object.keys(manifest.spec.resources || {}),
        routes: (manifest.spec.routes || []).map((route: { name?: string; target: string }) => route.name || route.target),
      };

      if (options.json) {
        printJson(summary);
        return;
      }

      console.log(chalk.green('Manifest is valid.'));
      console.log(`  File:      ${summary.manifest_path}`);
      console.log(`  App:       ${summary.app}`);
      console.log(`  Version:   ${summary.version}`);
      console.log(`  Workers:   ${summary.workers.join(', ') || '-'}`);
      console.log(`  Resources: ${summary.resources.join(', ') || '-'}`);
      console.log(`  Routes:    ${summary.routes.join(', ') || '-'}`);
    });

  deploy
    .command('status [appDeploymentId]')
    .description('Removed. App deployment status is not available in the current implementation.')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable output')
    .action(async (_appDeploymentId: string | undefined, _options: { space?: string; json?: boolean }) => {
      exitRemovedDeployCommand('`takos deploy status`');
    });

  deploy
    .command('rollback <appDeploymentId>')
    .description('Removed. App deployment rollback is not available in the current implementation.')
    .option('--space <id>', 'Target workspace ID')
    .option('--approve-oauth-auto-env', 'Approve OAuth auto env changes')
    .option('--json', 'Machine-readable output')
    .action(async (_appDeploymentId: string, _options: { space?: string; approveOauthAutoEnv?: boolean; json?: boolean }) => {
      exitRemovedDeployCommand('`takos deploy rollback`');
    });
}
