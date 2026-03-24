import type { Env } from '../../../shared/types';
import { generateId, now } from '../../../shared/utils';
import { insertFailedResource, insertResource } from './store';
import { CloudflareResourceService, type CloudflareManagedResourceType } from '../../../platform/providers/cloudflare/resources.ts';

type ProvisionCloudflareResourceInput = {
  id?: string;
  timestamp?: string;
  ownerId: string;
  spaceId?: string | null;
  name: string;
  type: CloudflareManagedResourceType;
  cfName: string;
  config?: Record<string, unknown>;
  recordFailure?: boolean;
  vectorize?: {
    dimensions: number;
    metric: 'cosine' | 'euclidean' | 'dot-product';
  };
};

export async function provisionCloudflareResource(
  env: Env,
  input: ProvisionCloudflareResourceInput
): Promise<{
  id: string;
  cfId: string | null;
  cfName: string;
}> {
  const id = input.id || generateId();
  const timestamp = input.timestamp || now();
  const provider = new CloudflareResourceService(env);

  try {
    const created = await provider.createResource(input.type, input.cfName, {
      ...(input.vectorize ? { vectorize: input.vectorize } : {}),
    });

    await insertResource(env.DB, {
      id,
      owner_id: input.ownerId,
      name: input.name,
      type: input.type,
      status: 'active',
      cf_id: created.cfId,
      cf_name: created.cfName,
      config: input.config || {},
      space_id: input.spaceId || null,
      created_at: timestamp,
      updated_at: timestamp,
    });

    return {
      id,
      cfId: created.cfId,
      cfName: created.cfName,
    };
  } catch (error) {
    if (input.recordFailure) {
      await insertFailedResource(env.DB, {
        id,
        owner_id: input.ownerId,
        name: input.name,
        type: input.type,
        cf_name: input.cfName,
        config: {
          ...(input.config || {}),
          error: error instanceof Error ? error.message : String(error),
        },
        space_id: input.spaceId || null,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }
    throw error;
  }
}
