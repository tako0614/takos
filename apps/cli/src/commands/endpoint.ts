import { Command } from 'commander';
import { green, red } from '@std/fmt/colors';
import { cliExit } from '../lib/command-exit.ts';
import { getConfig, isContainerMode, saveApiUrl } from '../lib/config.ts';

// Canonical source: DEFAULT_LOCAL_PORTS.web in
// packages/control/src/local-platform/runtime-types.ts
const DEFAULT_LOCAL_PORT = 8787;

const ENDPOINT_PRESETS: Readonly<Record<string, string>> = {
  prod: 'https://takos.jp',
  production: 'https://takos.jp',
  staging: 'https://test.takos.jp',
  test: 'https://test.takos.jp',
  local: `http://localhost:${DEFAULT_LOCAL_PORT}`,
};

export function resolveEndpointTarget(target: string): string {
  const normalized = target.trim();
  if (normalized.length === 0) {
    throw new Error('Endpoint target is required');
  }

  const preset = ENDPOINT_PRESETS[normalized.toLowerCase()];
  return preset ?? normalized;
}

function ensureWritableConfigOrExit(): void {
  if (isContainerMode()) {
    console.log(red('Cannot update endpoint in container mode. Use TAKOS_API_URL for this session.'));
    cliExit(1);
  }
}

export function registerEndpointCommand(program: Command): void {
  const endpoint = program
    .command('endpoint')
    .description('Switch or inspect default API endpoint');

  endpoint
    .command('use <target>')
    .description('Set endpoint (prod|staging|local|<url>)')
    .action((target: string) => {
      ensureWritableConfigOrExit();

      let resolvedTarget: string;
      try {
        resolvedTarget = resolveEndpointTarget(target);
        saveApiUrl(resolvedTarget);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(red(`Failed to update endpoint: ${message}`));
        cliExit(1);
      }

      console.log(green(`Endpoint updated: ${resolvedTarget}`));
    });

  endpoint
    .command('show')
    .description('Show current API endpoint')
    .action(() => {
      const config = getConfig();
      console.log(config.apiUrl);
    });
}
