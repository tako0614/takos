/**
 * CLI command: `takos resource`
 *
 * Manage resources as first-class inventory and data-plane objects.
 */
import fs from 'node:fs/promises';
import { bold, dim, green, red } from '@std/fmt/colors';
import type { Command } from 'commander';
import { cliExit } from '../lib/command-exit.ts';
import { api } from '../lib/api.ts';
import type { ResourceType } from '../lib/entities/resource.ts';
import { resolveSpaceId } from '../lib/cli-utils.ts';
import {
  ensureGroupInSpace,
  findResourceInSpace,
  findServiceInSpace,
  listResourcesInSpace,
  setResourceGroup,
} from '../lib/platform-surface.ts';

type ResourceCapability =
  | 'd1'
  | 'r2'
  | 'kv'
  | 'queue'
  | 'vectorize'
  | 'secretRef'
  | 'analyticsEngine'
  | 'workflow'
  | 'durableObject';

const VALID_RESOURCE_TYPES: ResourceCapability[] = [
  'd1',
  'r2',
  'kv',
  'queue',
  'vectorize',
  'secretRef',
  'analyticsEngine',
  'workflow',
  'durableObject',
];

const OFFLINE_RESOURCE_TYPES = new Set<ResourceCapability>([
  'd1',
  'r2',
  'kv',
  'queue',
  'vectorize',
  'secretRef',
]);

const RESOURCE_TYPE_ALIASES: Record<string, ResourceCapability> = {
  sql: 'd1',
  object_store: 'r2',
  vector_index: 'vectorize',
  secret: 'secretRef',
  analytics_store: 'analyticsEngine',
  workflow_runtime: 'workflow',
  durable_namespace: 'durableObject',
};

function resolveResourceType(input: {
  type?: string;
}): ResourceCapability {
  if (!input.type) {
    throw new Error(`Invalid resource type: ${input.type ?? ''}`);
  }
  const normalized = RESOURCE_TYPE_ALIASES[input.type] ?? input.type;
  if (VALID_RESOURCE_TYPES.includes(normalized as ResourceCapability)) {
    return normalized as ResourceCapability;
  }
  throw new Error(`Invalid resource type: ${input.type ?? ''}`);
}

async function requireResource(spaceId: string, name: string) {
  const resource = await findResourceInSpace(spaceId, name);
  if (!resource) {
    throw new Error(`Resource not found: ${name}`);
  }
  return resource;
}

async function requireTargetService(spaceId: string, worker?: string, serviceName?: string) {
  if (!worker && !serviceName) {
    throw new Error('Specify either --worker or --service');
  }
  if (worker && serviceName) {
    throw new Error('Use only one of --worker or --service');
  }

  const service = worker
    ? await findServiceInSpace(spaceId, worker, 'app')
    : await findServiceInSpace(spaceId, serviceName!, 'service');

  if (!service) {
    throw new Error(`Workload not found: ${worker ?? serviceName}`);
  }

  return service;
}

async function readTextValue(options: { value?: string; file?: string }): Promise<string> {
  if (options.value != null) return options.value;
  if (options.file) return fs.readFile(options.file, 'utf8');
  throw new Error('Provide either --value or --file');
}

export function registerResourceCommand(program: Command): void {
  const resourceCmd = program
    .command('resource')
    .description('Manage resources and operate on their data');

  resourceCmd
    .command('create <name>')
    .description('Create a new resource')
    .option('--type <type>', `Resource type (${VALID_RESOURCE_TYPES.join(', ')})`)
    .option('--binding <binding>', 'Suggested binding name')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Attach the resource to a group')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: {
      type?: string;
      binding?: string;
      env: string;
      group: string;
      space?: string;
      accountId?: string;
      apiToken?: string;
      json?: boolean;
      offline?: boolean;
    }) => {
      let resourceType: ResourceCapability;
      try {
        resourceType = resolveResourceType({
          type: options.type,
        });
      } catch (error) {
        console.log(red(error instanceof Error ? error.message : String(error)));
        cliExit(1);
        return;
      }

      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.ts');
        const { createResource } = await import('../lib/entities/resource.ts');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        if (!OFFLINE_RESOURCE_TYPES.has(resourceType)) {
          console.log(red(`Offline resource create does not support type: ${resourceType}`));
          cliExit(1);
          return;
        }

        try {
          const RESOURCE_TYPE_MAP: Record<string, ResourceType> = {
            d1: 'sql',
            r2: 'object_store',
            kv: 'kv',
            queue: 'queue',
            vectorize: 'vector_index',
            secretRef: 'secret',
          };
          const mappedType = RESOURCE_TYPE_MAP[resourceType];
          if (!mappedType) {
            console.log(red(`Unsupported resource type for offline create: ${resourceType}`));
            cliExit(1);
            return;
          }
          const result = await createResource(name, {
            type: mappedType,
            binding: options.binding,
            env: options.env,
            group: options.group ?? 'takos',
            groupName: options.group ?? 'takos',
            accountId,
            apiToken,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }

          const idInfo = result.id ? dim(` (${result.id})`) : '';
          console.log(`${green('✓')} ${result.name} [${result.type}] ${result.status}${idInfo}`);
        } catch (error) {
          console.log(red(`Failed to create resource: ${error instanceof Error ? error.message : String(error)}`));
          cliExit(1);
        }
        return;
      }

      const spaceId = resolveSpaceId(options.space);
      const group = options.group
        ? await ensureGroupInSpace(spaceId, options.group)
        : null;
      const res = await api<{ resource: { id: string; name: string; type: string; status: string } }>(
        '/api/resources',
        {
          method: 'POST',
          body: {
            name,
            type: resourceType,
            space_id: spaceId,
            group_id: group?.id ?? null,
            config: {
              ...(options.binding ? { binding: options.binding } : {}),
              env: options.env,
            },
          },
        },
      );

      if (!res.ok) {
        console.log(red(`Error: ${res.error}`));
        cliExit(1);
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
        return;
      }

      console.log(`${green('✓')} ${res.data.resource.name} [${res.data.resource.type}] ${res.data.resource.status}`);
      if (group) {
        console.log(dim(`  group=${group.name}`));
      }
    });

  resourceCmd
    .command('attach <name>')
    .description('Attach a resource to a group')
    .requiredOption('--group <name>', 'Target group name')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { group: string; space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const resource = await requireResource(spaceId, name);
        const group = await ensureGroupInSpace(spaceId, options.group);
        await setResourceGroup(resource.id, group.id);
        console.log(green(`Attached resource '${name}' to group '${group.name}'.`));
      } catch (error) {
        console.log(red(`Failed to attach resource: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  resourceCmd
    .command('detach <name>')
    .description('Detach a resource from its group')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const resource = await requireResource(spaceId, name);
        await setResourceGroup(resource.id, null);
        console.log(green(`Detached resource '${name}' from its group.`));
      } catch (error) {
        console.log(red(`Failed to detach resource: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  resourceCmd
    .command('list')
    .description('List resources in a workspace')
    .option('--group <name>', 'Target group for offline state', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (options: { group: string; space?: string; json?: boolean; offline?: boolean }) => {
      if (options.offline) {
        const { listResources } = await import('../lib/entities/resource.ts');
        try {
          const resources = await listResources(options.group);
          if (options.json) {
            process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
            return;
          }
          if (resources.length === 0) {
            console.log(dim('No resources tracked.'));
            return;
          }
          console.log('');
          console.log(bold('Resources:'));
          for (const resource of resources) {
            const idLabel = resource.id ? dim(` (${resource.id})`) : '';
            console.log(`  ${resource.name} [${resource.type}]${idLabel}`);
          }
          console.log('');
          console.log(dim(`${resources.length} resource(s)`));
        } catch (error) {
          console.log(red(`Failed to list resources: ${error instanceof Error ? error.message : String(error)}`));
          cliExit(1);
        }
        return;
      }

      try {
        const resources = await listResourcesInSpace(resolveSpaceId(options.space));
        if (options.json) {
          process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
          return;
        }
        if (resources.length === 0) {
          console.log(dim('No resources found.'));
          return;
        }
        console.log('');
        console.log(bold('Resources:'));
        for (const resource of resources) {
          const groupLabel = resource.group_id ? dim(` group=${resource.group_id}`) : '';
          console.log(`  ${resource.name} [${resource.type}] ${dim(resource.id)}${groupLabel}`);
        }
        console.log('');
        console.log(dim(`${resources.length} resource(s)`));
      } catch (error) {
        console.log(red(`Failed to list resources: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  resourceCmd
    .command('show <name>')
    .description('Show a resource')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: { space?: string; json?: boolean }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}`);
        if (!res.ok) throw new Error(res.error);
        if (options.json) {
          process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
          return;
        }
        console.log(JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log(red(`Failed to show resource: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  resourceCmd
    .command('delete <name>')
    .description('Delete a resource')
    .option('--group <name>', 'Target group for offline state', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: { group: string; space?: string; accountId?: string; apiToken?: string; offline?: boolean }) => {
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.ts');
        const { deleteResource } = await import('../lib/entities/resource.ts');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);
        try {
          await deleteResource(name, { group: options.group, accountId, apiToken });
          console.log(green(`Removed resource '${name}' from offline state.`));
        } catch (error) {
          console.log(red(`Failed to delete resource: ${error instanceof Error ? error.message : String(error)}`));
          cliExit(1);
        }
        return;
      }

      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<void>(`/api/resources/${encodeURIComponent(resource.id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(res.error);
        console.log(green(`Deleted resource '${name}'.`));
      } catch (error) {
        console.log(red(`Failed to delete resource: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  resourceCmd
    .command('bind <name>')
    .description('Bind a resource to a worker or service')
    .requiredOption('--binding <binding>', 'Binding name to expose inside the workload')
    .option('--worker <name>', 'Target worker slug/name')
    .option('--service <name>', 'Target service slug/name')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { binding: string; worker?: string; service?: string; space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const resource = await requireResource(spaceId, name);
        const target = await requireTargetService(spaceId, options.worker, options.service);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/bind`, {
          method: 'POST',
          body: {
            service_id: target.id,
            binding_name: options.binding,
          },
        });
        if (!res.ok) throw new Error(res.error);
        console.log(green(`Bound '${name}' to '${target.slug ?? target.id}' as ${options.binding}.`));
      } catch (error) {
        console.log(red(`Failed to bind resource: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  resourceCmd
    .command('unbind <name>')
    .description('Remove a resource binding from a worker or service')
    .option('--worker <name>', 'Target worker slug/name')
    .option('--service <name>', 'Target service slug/name')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { worker?: string; service?: string; space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const resource = await requireResource(spaceId, name);
        const target = await requireTargetService(spaceId, options.worker, options.service);
        const res = await api<unknown>(
          `/api/resources/${encodeURIComponent(resource.id)}/bind/${encodeURIComponent(target.id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) throw new Error(res.error);
        console.log(green(`Unbound '${name}' from '${target.slug ?? target.id}'.`));
      } catch (error) {
        console.log(red(`Failed to unbind resource: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  const sqlCmd = resourceCmd.command('sql').description('Operate on SQL resources');
  sqlCmd
    .command('tables <name>')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: { space?: string; json?: boolean }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/sql/tables`);
        if (!res.ok) throw new Error(res.error);
        if (options.json) process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
        else console.log(JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log(red(`Failed to list tables: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
  sqlCmd
    .command('query <name> <sql>')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, sql: string, options: { space?: string; json?: boolean }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/sql/query`, {
          method: 'POST',
          body: { sql },
        });
        if (!res.ok) throw new Error(res.error);
        if (options.json) process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
        else console.log(JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log(red(`Failed to run query: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  const objectCmd = resourceCmd.command('object').description('Operate on object-store resources');
  objectCmd
    .command('ls <name>')
    .option('--prefix <prefix>', 'Object prefix')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: { prefix?: string; space?: string; json?: boolean }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const query = options.prefix ? `?prefix=${encodeURIComponent(options.prefix)}` : '';
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/objects${query}`);
        if (!res.ok) throw new Error(res.error);
        if (options.json) process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
        else console.log(JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log(red(`Failed to list objects: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
  objectCmd
    .command('get <name> <key>')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, key: string, options: { space?: string; json?: boolean }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/objects/${encodeURIComponent(key)}`);
        if (!res.ok) throw new Error(res.error);
        if (options.json) process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
        else console.log(JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log(red(`Failed to read object: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
  objectCmd
    .command('put <name> <key>')
    .option('--value <value>', 'Literal object contents')
    .option('--file <path>', 'Read object contents from file')
    .option('--content-type <type>', 'Content type')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, key: string, options: { value?: string; file?: string; contentType?: string; space?: string }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const value = await readTextValue(options);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/objects/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: {
            value,
            content_type: options.contentType,
          },
        });
        if (!res.ok) throw new Error(res.error);
        console.log(green(`Stored object '${key}' in '${name}'.`));
      } catch (error) {
        console.log(red(`Failed to store object: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
  objectCmd
    .command('rm <name> <key>')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, key: string, options: { space?: string }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/objects/${encodeURIComponent(key)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(res.error);
        console.log(green(`Deleted object '${key}' from '${name}'.`));
      } catch (error) {
        console.log(red(`Failed to delete object: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });

  const kvCmd = resourceCmd.command('kv').description('Operate on KV resources');
  kvCmd
    .command('ls <name>')
    .option('--prefix <prefix>', 'Key prefix')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: { prefix?: string; space?: string; json?: boolean }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const query = options.prefix ? `?prefix=${encodeURIComponent(options.prefix)}` : '';
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/kv/entries${query}`);
        if (!res.ok) throw new Error(res.error);
        if (options.json) process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
        else console.log(JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log(red(`Failed to list KV entries: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
  kvCmd
    .command('get <name> <key>')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, key: string, options: { space?: string; json?: boolean }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/kv/entries/${encodeURIComponent(key)}`);
        if (!res.ok) throw new Error(res.error);
        if (options.json) process.stdout.write(`${JSON.stringify(res.data, null, 2)}\n`);
        else console.log(JSON.stringify(res.data, null, 2));
      } catch (error) {
        console.log(red(`Failed to read KV entry: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
  kvCmd
    .command('put <name> <key>')
    .option('--value <value>', 'Literal value')
    .option('--file <path>', 'Read value from file')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, key: string, options: { value?: string; file?: string; space?: string }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const value = await readTextValue(options);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/kv/entries/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: { value },
        });
        if (!res.ok) throw new Error(res.error);
        console.log(green(`Stored KV entry '${key}' in '${name}'.`));
      } catch (error) {
        console.log(red(`Failed to store KV entry: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
  kvCmd
    .command('rm <name> <key>')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, key: string, options: { space?: string }) => {
      try {
        const resource = await requireResource(resolveSpaceId(options.space), name);
        const res = await api<unknown>(`/api/resources/${encodeURIComponent(resource.id)}/kv/entries/${encodeURIComponent(key)}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error(res.error);
        console.log(green(`Deleted KV entry '${key}' from '${name}'.`));
      } catch (error) {
        console.log(red(`Failed to delete KV entry: ${error instanceof Error ? error.message : String(error)}`));
        cliExit(1);
      }
    });
}
