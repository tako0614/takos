import type { Env } from '../../../shared/types';
import { WFPService, type WfpEnv } from '../wfp';

export type CloudflareManagedResourceType = 'd1' | 'r2' | 'kv' | 'vectorize';
export type CloudflareDeletableResourceType = CloudflareManagedResourceType | 'worker';

type VectorizeCreateOptions = {
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot-product';
};

export class CloudflareResourceService {
  private wfp: WFPService;

  constructor(env: Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'> | WfpEnv) {
    this.wfp = new WFPService(env);
  }

  async createResource(
    type: CloudflareManagedResourceType,
    name: string,
    options?: { vectorize?: VectorizeCreateOptions }
  ): Promise<{ cfId: string | null; cfName: string }> {
    switch (type) {
      case 'd1': {
        const cfId = await this.wfp.createD1Database(name);
        return { cfId, cfName: name };
      }
      case 'r2':
        await this.wfp.createR2Bucket(name);
        return { cfId: name, cfName: name };
      case 'kv': {
        const cfId = await this.wfp.createKVNamespace(name);
        return { cfId, cfName: name };
      }
      case 'vectorize': {
        const cfId = await this.wfp.createVectorizeIndex(name, options?.vectorize || {
          dimensions: 1536,
          metric: 'cosine',
        });
        return { cfId, cfName: name };
      }
    }
  }

  async deleteResource(params: {
    type: string;
    cfId?: string | null;
    cfName?: string | null;
  }): Promise<void> {
    const type = String(params.type || '').trim() as CloudflareDeletableResourceType;
    switch (type) {
      case 'd1':
        if (params.cfId) await this.wfp.deleteD1Database(params.cfId);
        return;
      case 'r2':
        if (params.cfName) await this.wfp.deleteR2Bucket(params.cfName);
        return;
      case 'kv':
        if (params.cfId) await this.wfp.deleteKVNamespace(params.cfId);
        return;
      case 'vectorize':
        if (params.cfName) await this.wfp.deleteVectorizeIndex(params.cfName);
        return;
      case 'worker':
        if (params.cfName) await this.wfp.deleteWorker(params.cfName);
        return;
      default:
        return;
    }
  }

  async executeD1Query(databaseId: string, sql: string): Promise<void> {
    await this.wfp.executeD1Query(databaseId, sql);
  }

  async queryD1<T>(databaseId: string, sql: string): Promise<T[]> {
    return this.wfp.queryD1<T>(databaseId, sql);
  }
}
