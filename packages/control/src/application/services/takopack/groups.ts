import { getDb } from '../../../infra/db';
import { resources, shortcutGroups, shortcutGroupItems } from '../../../infra/db/schema';
import { eq, and, or } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { nanoid } from 'nanoid';
import { now } from '../../../shared/utils';
import { resolveServiceRouteSummaryForWorkspace } from '../platform/workers';
import type {
  TakopackManifest,
  ResourceProvisionResult,
  ProvisionedResourceReferenceMaps,
} from './types';

export class BundleShortcutGroupService {
  constructor(private env: Env) {}

  async createShortcutGroup(
    spaceId: string,
    bundleDeploymentId: string,
    manifest: TakopackManifest,
    resolvedReferences?: {
      workers?: Map<string, string>;
      resources?: ProvisionedResourceReferenceMaps;
    }
  ): Promise<string> {
    const db = getDb(this.env.DB);

    const items: Array<{
      type: string;
      id: string;
      label: string;
      icon?: string;
      serviceId?: string;
      uiPath?: string;
      resourceId?: string;
      url?: string;
    }> = [];

    for (const workerName of manifest.group?.workers || []) {
      const resolvedWorkerId = await this.resolveGroupWorkerId(
        spaceId,
        workerName,
        resolvedReferences?.workers
      );
      items.push({
        type: 'service',
        id: nanoid(),
        label: workerName,
        serviceId: resolvedWorkerId,
      });
    }

    for (const uiPath of manifest.group?.ui || []) {
      items.push({
        type: 'ui',
        id: nanoid(),
        label: uiPath,
        uiPath,
      });
    }

    for (const resourceType of ['d1', 'r2', 'kv'] as const) {
      for (const name of manifest.group?.resources?.[resourceType] || []) {
        const resolvedResourceId = await this.resolveGroupResourceId(
          spaceId,
          resourceType,
          name,
          resolvedReferences?.resources?.[resourceType]
        );
        items.push({
          type: resourceType,
          id: nanoid(),
          label: name,
          resourceId: resolvedResourceId,
        });
      }
    }

    for (const link of manifest.group?.links || []) {
      items.push({
        type: 'link',
        id: nanoid(),
        label: link.label,
        icon: link.icon,
        url: link.url,
      });
    }

    const groupId = nanoid();
    const timestamp = now();
    await db.insert(shortcutGroups).values({
      id: groupId,
      accountId: spaceId,
      name: manifest.meta.name,
      icon: manifest.meta.icon,
      bundleDeploymentId: bundleDeploymentId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    if (items.length > 0) {
      await db.insert(shortcutGroupItems).values(
        items.map((item, i) => ({
          id: item.id,
          groupId,
          type: item.type,
          label: item.label,
          icon: item.icon,
          position: i,
          serviceId: item.serviceId,
          uiPath: item.uiPath,
          resourceId: item.resourceId,
          url: item.url,
        }))
      );
    }

    return groupId;
  }

  private async resolveGroupWorkerId(
    spaceId: string,
    reference: string,
    map?: Map<string, string>
  ): Promise<string> {
    const mapped = resolveReferenceId(reference, map);
    const mappedTrimmed = mapped.trim();
    if (mappedTrimmed && mappedTrimmed !== reference.trim()) {
      return mappedTrimmed;
    }

    const ref = reference.trim();
    if (!ref) return reference;

    const worker = await resolveServiceRouteSummaryForWorkspace(this.env.DB, spaceId, ref);

    return worker?.id || mapped || reference;
  }

  private async resolveGroupResourceId(
    spaceId: string,
    type: 'd1' | 'r2' | 'kv',
    reference: string,
    map?: Map<string, string>
  ): Promise<string> {
    const mapped = resolveReferenceId(reference, map);
    const mappedTrimmed = mapped.trim();
    if (mappedTrimmed && mappedTrimmed !== reference.trim()) {
      return mappedTrimmed;
    }

    const ref = reference.trim();
    if (!ref) return reference;

    const db = getDb(this.env.DB);
    const resource = await db.select({ id: resources.id }).from(resources).where(
      and(
        eq(resources.accountId, spaceId),
        eq(resources.type, type),
        eq(resources.status, 'active'),
        or(
          eq(resources.id, ref),
          eq(resources.name, ref),
          eq(resources.cfId, ref),
          eq(resources.cfName, ref),
        ),
      )
    ).get();

    return resource?.id || mapped || reference;
  }
}

export function buildProvisionedResourceReferenceMaps(
  provisionedResources?: ResourceProvisionResult
): ProvisionedResourceReferenceMaps {
  const maps: ProvisionedResourceReferenceMaps = {
    d1: new Map<string, string>(),
    r2: new Map<string, string>(),
    kv: new Map<string, string>(),
  };

  if (!provisionedResources) {
    return maps;
  }

  for (const resource of provisionedResources.d1) {
    addProvisionedReference(maps.d1, resource.binding, resource.resourceId);
    addProvisionedReference(maps.d1, resource.id, resource.resourceId);
    addProvisionedReference(maps.d1, resource.name, resource.resourceId);
    addProvisionedReference(maps.d1, resource.resourceId, resource.resourceId);
  }

  for (const resource of provisionedResources.r2) {
    addProvisionedReference(maps.r2, resource.binding, resource.resourceId);
    addProvisionedReference(maps.r2, resource.name, resource.resourceId);
    addProvisionedReference(maps.r2, resource.resourceId, resource.resourceId);
  }

  for (const resource of provisionedResources.kv) {
    addProvisionedReference(maps.kv, resource.binding, resource.resourceId);
    addProvisionedReference(maps.kv, resource.id, resource.resourceId);
    addProvisionedReference(maps.kv, resource.name, resource.resourceId);
    addProvisionedReference(maps.kv, resource.resourceId, resource.resourceId);
  }

  return maps;
}

function addProvisionedReference(map: Map<string, string>, reference: string, resolvedId: string): void {
  const key = reference.trim();
  if (!key) return;
  map.set(key, resolvedId);
}

function resolveReferenceId(reference: string, map?: Map<string, string>): string {
  const ref = reference.trim();
  if (!ref || !map) return reference;
  return map.get(ref) || reference;
}
