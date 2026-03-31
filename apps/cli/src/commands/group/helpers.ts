/**
 * Shared helpers for `takos group` subcommands.
 */
import { dim, red } from '@std/fmt/colors';
import type { StateAccessOptions } from '../../lib/state/state-file.ts';
import { cliExit } from '../../lib/command-exit.ts';
import { api } from '../../lib/api.ts';
import { resolveSpaceId } from '../../lib/cli-utils.ts';

export const GROUP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function validateGroupName(name: string): void {
  if (!GROUP_NAME_PATTERN.test(name)) {
    console.log(red(`Invalid group name: "${name}"`));
    console.log(dim('Group names must match: ^[a-z0-9][a-z0-9-]*$'));
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
