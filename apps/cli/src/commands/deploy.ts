import { execFile } from 'node:child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import { api } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
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

function resolveSpaceId(spaceOverride?: string): string {
  const spaceId = String(spaceOverride || getConfig().spaceId || '').trim();
  if (!spaceId) {
    console.log(chalk.red('Workspace ID is required. Pass --space or configure a default workspace.'));
    cliExit(1);
  }
  return spaceId;
}

async function inferCurrentBranch(): Promise<string | null> {
  return await new Promise((resolve) => {
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: process.cwd() }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const branch = String(stdout || '').trim();
      resolve(branch && branch !== 'HEAD' ? branch : null);
    });
  });
}

export function registerDeployCommand(program: Command): void {
  const deploy = program
    .command('deploy')
    .description('Deploy app defined by repo-local .takos/app.yml using latest successful CI artifacts');

  deploy
    .option('--space <id>', 'Target workspace ID')
    .requiredOption('--repo <id>', 'Repository ID used to resolve .takos/app.yml and workflow artifacts')
    .option('--ref <ref>', 'Source ref used to resolve .takos/app.yml and workflow artifacts')
    .option('--ref-type <type>', 'Source ref type (branch|tag|commit)', 'branch')
    .option('--approve-oauth-auto-env', 'Approve OAuth auto env changes')
    .option('--approve-source-change', 'Approve source provenance change for replacement deploys')
    .option('--json', 'Machine-readable output')
    .action(async (options: DeployCommandOptions) => {
      const spaceId = resolveSpaceId(options.space);
      const { manifestPath } = await validateAppManifest(process.cwd());
      const repoId = String(options.repo || '').trim();
      if (!repoId) {
        console.log(chalk.red('Repository ID is required. Pass --repo.'));
        cliExit(1);
      }

      const resolvedRef = String(options.ref || '').trim() || await inferCurrentBranch() || 'main';

      const result = await api<{
        success: boolean;
        data: {
          app_deployment_id: string;
          app_id: string;
          name: string;
          version: string;
          source?: {
            repo_id?: string;
            ref?: string;
            ref_type?: 'branch' | 'tag' | 'commit';
            commit_sha?: string;
          };
        };
      }>(`/api/spaces/${spaceId}/app-deployments`, {
        method: 'POST',
        body: {
          repo_id: repoId,
          ref: resolvedRef,
          ref_type: options.refType || 'branch',
          approve_oauth_auto_env: options.approveOauthAutoEnv === true,
          approve_source_change: options.approveSourceChange === true,
        },
        timeout: 120_000,
      });

      if (!result.ok) {
        console.log(chalk.red(`Error: ${result.error}`));
        cliExit(1);
      }

      if (options.json) {
        printJson(result.data);
        return;
      }

      console.log(chalk.green('App deployed successfully.'));
      console.log(`  Manifest:   ${manifestPath}`);
      console.log(`  Repo:       ${repoId}`);
      console.log(`  Ref:        ${resolvedRef}`);
      console.log(`  App:        ${result.data.data.name}`);
      console.log(`  Version:    ${result.data.data.version}`);
      console.log(`  App ID:     ${result.data.data.app_id}`);
      console.log(`  Deployment: ${result.data.data.app_deployment_id}`);
      if (result.data.data.source?.commit_sha) {
        console.log(`  Commit:     ${result.data.data.source.commit_sha}`);
      }
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
    .description('List app deployments or view a deployment detail')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable output')
    .action(async (appDeploymentId: string | undefined, options: { space?: string; json?: boolean }) => {
      const spaceId = resolveSpaceId(options.space);
      const path = appDeploymentId
        ? `/api/spaces/${spaceId}/app-deployments/${appDeploymentId}`
        : `/api/spaces/${spaceId}/app-deployments`;
      const result = await api<unknown>(path);
      if (!result.ok) {
        console.log(chalk.red(`Error: ${result.error}`));
        cliExit(1);
      }

      printJson(result.data);
    });

  deploy
    .command('rollback <appDeploymentId>')
    .description('Rollback to the previous app deployment')
    .option('--space <id>', 'Target workspace ID')
    .option('--approve-oauth-auto-env', 'Approve OAuth auto env changes')
    .option('--json', 'Machine-readable output')
    .action(async (appDeploymentId: string, options: { space?: string; approveOauthAutoEnv?: boolean; json?: boolean }) => {
      const spaceId = resolveSpaceId(options.space);
      const result = await api<unknown>(`/api/spaces/${spaceId}/app-deployments/${appDeploymentId}/rollback`, {
        method: 'POST',
        body: {
          ...(options.approveOauthAutoEnv ? { approve_oauth_auto_env: true } : {}),
        },
      });
      if (!result.ok) {
        console.log(chalk.red(`Error: ${result.error}`));
        cliExit(1);
      }

      printJson(result.data);
    });
}
