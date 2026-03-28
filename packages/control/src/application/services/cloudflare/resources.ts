import type { Env } from '../../../shared/types';
import { WFPService, type WfpEnv } from '../wfp';
import { VECTORIZE_DEFAULT_DIMENSIONS } from '../../../shared/config/limits.ts';

export type CloudflareManagedResourceType =
  | 'd1'
  | 'r2'
  | 'kv'
  | 'queue'
  | 'analyticsEngine'
  | 'analytics_engine'
  | 'workflow'
  | 'vectorize';
export type CloudflareDeletableResourceType = CloudflareManagedResourceType | 'worker';

type VectorizeCreateOptions = {
  dimensions: number;
  metric: 'cosine' | 'euclidean' | 'dot-product';
};

type QueueCreateOptions = {
  deliveryDelaySeconds?: number;
};

type AnalyticsEngineCreateOptions = {
  dataset?: string;
};

type WorkflowCreateOptions = {
  service?: string;
  export?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export class CloudflareResourceService {
  readonly wfp: WFPService;

  constructor(env: Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'> | WfpEnv) {
    this.wfp = new WFPService(env);
  }

  async createResource(
    type: CloudflareManagedResourceType,
    name: string,
    options?: {
      vectorize?: VectorizeCreateOptions;
      queue?: QueueCreateOptions;
      analyticsEngine?: AnalyticsEngineCreateOptions;
      workflow?: WorkflowCreateOptions;
    }
  ): Promise<{ cfId: string | null; cfName: string }> {
    switch (type) {
      case 'd1': {
        const cfId = await this.wfp.d1.createD1Database(name);
        return { cfId, cfName: name };
      }
      case 'r2':
        await this.wfp.r2.createR2Bucket(name);
        return { cfId: name, cfName: name };
      case 'kv': {
        const cfId = await this.wfp.kv.createKVNamespace(name);
        return { cfId, cfName: name };
      }
      case 'queue': {
        const queue = await this.wfp.queues.createQueue(name, {
          deliveryDelaySeconds: options?.queue?.deliveryDelaySeconds,
        });
        return { cfId: queue.id, cfName: queue.name };
      }
      case 'analyticsEngine':
      case 'analytics_engine':
        return {
          cfId: null,
          cfName: options?.analyticsEngine?.dataset?.trim() || name,
        };
      case 'workflow':
        return {
          cfId: null,
          cfName: name,
        };
      case 'vectorize': {
        const cfId = await this.wfp.vectorize.createVectorizeIndex(name, options?.vectorize || {
          dimensions: VECTORIZE_DEFAULT_DIMENSIONS,
          metric: 'cosine',
        });
        return { cfId, cfName: name };
      }
      default: {
        const unsupportedType: never = type;
        throw new Error(`Unsupported Cloudflare managed resource type: ${unsupportedType}`);
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
        if (params.cfId) await this.wfp.d1.deleteD1Database(params.cfId);
        return;
      case 'r2':
        if (params.cfName) await this.wfp.r2.deleteR2Bucket(params.cfName);
        return;
      case 'kv':
        if (params.cfId) await this.wfp.kv.deleteKVNamespace(params.cfId);
        return;
      case 'queue':
        if (params.cfId) {
          await this.wfp.queues.deleteQueue(params.cfId);
          return;
        }
        if (params.cfName) await this.wfp.queues.deleteQueueByName(params.cfName);
        return;
      case 'analyticsEngine':
      case 'analytics_engine':
      case 'workflow':
        return;
      case 'vectorize':
        if (params.cfName) await this.wfp.vectorize.deleteVectorizeIndex(params.cfName);
        return;
      case 'worker':
        if (params.cfName) await this.wfp.workers.deleteWorker(params.cfName);
        return;
      default:
        return;
    }
  }

}
