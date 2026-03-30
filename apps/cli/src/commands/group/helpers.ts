/**
 * Shared helpers for `takos group` subcommands.
 */
import chalk from 'chalk';
import type { StateAccessOptions } from '../../lib/state/state-file.js';
import { cliExit } from '../../lib/command-exit.js';
import { api } from '../../lib/api.js';
import { resolveSpaceId } from '../../lib/cli-utils.js';

export const GROUP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function validateGroupName(name: string): void {
  if (!GROUP_NAME_PATTERN.test(name)) {
    console.log(chalk.red(`Invalid group name: "${name}"`));
    console.log(chalk.dim('Group names must match: ^[a-z0-9][a-z0-9-]*$'));
    cliExit(1);
  }
}

export function toAccessOpts(options: { offline?: boolean }): StateAccessOptions {
  return options.offline ? { offline: true } : {};
}

export type ApiGroupRecord = {
  id: string;
  name: string;
  provider?: string | null;
  env?: string | null;
  appVersion?: string | null;
  desiredSpecJson?: unknown;
  inventory?: {
    resources?: unknown[];
    workloads?: unknown[];
    routes?: unknown[];
  };
};

export function resolveGroupSpaceId(space?: string): string {
  return resolveSpaceId(space);
}

export async function listApiGroups(spaceId: string): Promise<ApiGroupRecord[]> {
  const res = await api<{ groups: ApiGroupRecord[] }>(`/api/spaces/${spaceId}/groups`);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.data.groups;
}

export async function requireApiGroupByName(spaceId: string, name: string): Promise<ApiGroupRecord> {
  const groups = await listApiGroups(spaceId);
  const group = groups.find((entry) => entry.name === name);
  if (!group) {
    throw new Error(`Group not found: ${name}`);
  }
  return group;
}
