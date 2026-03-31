import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { bold, green, red } from '@std/fmt/colors';
import { api } from '../../lib/api.ts';
import { cliExit } from '../../lib/command-exit.ts';
import { resolveSpaceId } from '../../lib/cli-utils.ts';
import { loadAppManifest } from '../../lib/app-manifest.ts';
import { validateGroupName } from './helpers.ts';

type GroupRecord = {
  id: string;
  name: string;
};

async function resolveGroupIdByName(spaceId: string, name: string): Promise<string> {
  const res = await api<{ groups: GroupRecord[] }>(`/api/spaces/${spaceId}/groups`);
  if (!res.ok) {
    throw new Error(res.error);
  }

  const group = res.data.groups.find((entry) => entry.name === name);
  if (!group) {
    throw new Error(`Group not found: ${name}`);
  }
  return group.id;
}

export function registerGroupDesiredCommand(groupCmd: Command): void {
  const desiredCmd = groupCmd
    .command('desired')
    .description('Read or replace the public desired app manifest for a group');

  desiredCmd
    .command('get <name>')
    .description('Show the desired app manifest for a group')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: { space?: string; json?: boolean }) => {
      validateGroupName(name);
      const spaceId = resolveSpaceId(options.space);

      try {
        const groupId = await resolveGroupIdByName(spaceId, name);
        const res = await api<{ desired: unknown }>(`/api/spaces/${spaceId}/groups/${groupId}/desired`);
        if (!res.ok) {
          throw new Error(res.error);
        }

        if (options.json) {
          process.stdout.write(`${JSON.stringify(res.data.desired, null, 2)}\n`);
          return;
        }

        console.log('');
        console.log(bold(`Group desired manifest: ${name}`));
        process.stdout.write(`${JSON.stringify(res.data.desired, null, 2)}\n`);
      } catch (error) {
        console.log(red(error instanceof Error ? error.message : String(error)));
        cliExit(1);
      }
    });

  desiredCmd
    .command('put <name>')
    .description('Replace the desired app manifest for a group')
    .requiredOption('--file <path>', 'Path to an app manifest document')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { file: string; space?: string }) => {
      validateGroupName(name);
      const spaceId = resolveSpaceId(options.space);

      try {
        let desired: unknown;
        try {
          desired = await loadAppManifest(options.file);
        } catch {
          const raw = await readFile(options.file, 'utf8');
          desired = JSON.parse(raw) as unknown;
        }
        const groupId = await resolveGroupIdByName(spaceId, name);
        const res = await api<{ group: GroupRecord; desired: unknown }>(`/api/spaces/${spaceId}/groups/${groupId}/desired`, {
          method: 'PUT',
          body: desired as Record<string, unknown>,
        });
        if (!res.ok) {
          throw new Error(res.error);
        }

        console.log(green(`Updated desired manifest for group: ${name}`));
      } catch (error) {
        console.log(red(error instanceof Error ? error.message : String(error)));
        cliExit(1);
      }
    });
}
