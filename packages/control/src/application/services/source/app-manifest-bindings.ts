import type {
  AppResourceType,
  AppWorkloadBindings,
  ServiceBinding,
} from './app-manifest-types.ts';
import {
  asRecord,
  asRequiredString,
  asStringArray,
} from './app-manifest-utils.ts';

type ResourceBindingKey =
  | 'resources'
  | 'd1'
  | 'r2'
  | 'kv'
  | 'queues'
  | 'vectorize'
  | 'analyticsEngine'
  | 'workflow'
  | 'durableObjects';

type ResourceBindingDescriptor = {
  key: ResourceBindingKey;
  aliases: string[];
  resourceType?: AppResourceType;
};

const RESOURCE_BINDINGS: ResourceBindingDescriptor[] = [
  { key: 'resources', aliases: ['resources'] },
  { key: 'd1', aliases: ['d1', 'sql'], resourceType: 'd1' },
  { key: 'r2', aliases: ['r2', 'objectStores'], resourceType: 'r2' },
  { key: 'kv', aliases: ['kv'], resourceType: 'kv' },
  { key: 'queues', aliases: ['queues'], resourceType: 'queue' },
  { key: 'vectorize', aliases: ['vectorize', 'vectorIndexes'], resourceType: 'vectorize' },
  { key: 'analyticsEngine', aliases: ['analyticsEngine', 'analyticsStores', 'analytics'], resourceType: 'analyticsEngine' },
  { key: 'workflow', aliases: ['workflow', 'workflowRuntimes', 'workflows'], resourceType: 'workflow' },
  { key: 'durableObjects', aliases: ['durableObjects', 'durableNamespaces'], resourceType: 'durableObject' },
];

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function parseServiceBindingList(raw: unknown, prefix: string): ServiceBinding[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix} must be an array`);
  }
  return raw.map((entry, index) => {
    if (typeof entry === 'string') return entry;
    const obj = asRecord(entry);
    return {
      name: asRequiredString(obj.name, `${prefix}[${index}].name`),
      ...(obj.version ? { version: String(obj.version) } : {}),
    };
  });
}

export function parseWorkloadBindings(raw: unknown, prefix: string): AppWorkloadBindings | undefined {
  const bindingsRecord = asRecord(raw);
  const parsed: AppWorkloadBindings = {};

  for (const descriptor of RESOURCE_BINDINGS) {
    const merged = dedupeStrings(
      descriptor.aliases.flatMap((alias) => asStringArray(bindingsRecord[alias], `${prefix}.${alias}`) ?? []),
    );
    if (merged.length === 0) continue;
    parsed[descriptor.key] = merged;
  }

  const services = parseServiceBindingList(bindingsRecord.services, `${prefix}.services`);
  if (services) {
    parsed.services = services;
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function getWorkloadResourceBindingDescriptors(
  bindings?: AppWorkloadBindings,
): Array<{ resourceName: string; key: ResourceBindingKey; resourceType?: AppResourceType }> {
  if (!bindings) return [];

  const descriptors: Array<{ resourceName: string; key: ResourceBindingKey; resourceType?: AppResourceType }> = [];
  for (const descriptor of RESOURCE_BINDINGS) {
    const merged = dedupeStrings(
      descriptor.aliases.flatMap((alias) => {
        const values = bindings[alias as keyof AppWorkloadBindings];
        if (!Array.isArray(values)) return [];
        return values.map((v: string | { name: string }) => typeof v === 'string' ? v : v.name);
      }),
    );
    for (const resourceName of merged) {
      descriptors.push({
        resourceName,
        key: descriptor.key,
        ...(descriptor.resourceType ? { resourceType: descriptor.resourceType } : {}),
      });
    }
  }

  return descriptors;
}

export function getWorkloadServiceBindingTargets(bindings?: AppWorkloadBindings): string[] {
  if (!bindings?.services) return [];
  return bindings.services.map((entry) => (typeof entry === 'string' ? entry : entry.name));
}
