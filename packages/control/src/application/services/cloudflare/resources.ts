import type { Env } from '../../../shared/types/index.ts';
import { WFPService, type WfpEnv } from '../wfp/index.ts';
import { VECTORIZE_DEFAULT_DIMENSIONS } from '../../../shared/config/limits.ts';

export type CloudflareManagedResourceType =
  | 'd1'
  | 'r2'
  | 'kv'
  | 'queue'
  | 'analyticsEngine'
  | 'analytics_engine'
  | 'secret_ref'
  | 'workflow'
  | 'workflow_binding'
  | 'vectorize'
  | 'durable_object_namespace';
export type CloudflareDeletableResourceType = CloudflareManagedResourceType | 'durable_object_namespace' | 'worker';

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

function generateSecretToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
  ): Promise<{ providerResourceId: string | null; providerResourceName: string }> {
    switch (type) {
      case 'd1': {
        const providerResourceId = await this.wfp.d1.createD1Database(name);
        return { providerResourceId, providerResourceName: name };
      }
      case 'r2':
        await this.wfp.r2.createR2Bucket(name);
        return { providerResourceId: name, providerResourceName: name };
      case 'kv': {
        const providerResourceId = await this.wfp.kv.createKVNamespace(name);
        return { providerResourceId, providerResourceName: name };
      }
      case 'queue': {
        const queue = await this.wfp.queues.createQueue(name, {
          deliveryDelaySeconds: options?.queue?.deliveryDelaySeconds,
        });
        return { providerResourceId: queue.id, providerResourceName: queue.name };
      }
      case 'analyticsEngine':
      case 'analytics_engine':
        return {
          providerResourceId: null,
          providerResourceName: options?.analyticsEngine?.dataset?.trim() || name,
        };
      case 'secret_ref':
        return {
          providerResourceId: generateSecretToken(),
          providerResourceName: name,
        };
      case 'workflow':
      case 'workflow_binding':
      case 'durable_object_namespace':
        return {
          providerResourceId: null,
          providerResourceName: name,
        };
      case 'vectorize': {
        const providerResourceId = await this.wfp.vectorize.createVectorizeIndex(name, options?.vectorize || {
          dimensions: VECTORIZE_DEFAULT_DIMENSIONS,
          metric: 'cosine',
        });
        return { providerResourceId, providerResourceName: name };
      }
      default: {
        const unsupportedType: never = type;
        throw new Error(`Unsupported Cloudflare managed resource type: ${unsupportedType}`);
      }
    }
  }

  async deleteResource(params: {
    type: string;
    providerResourceId?: string | null;
    providerResourceName?: string | null;
  }): Promise<void> {
    const type = String(params.type || '').trim() as CloudflareDeletableResourceType;
    switch (type) {
      case 'd1':
        if (params.providerResourceId) await this.wfp.d1.deleteD1Database(params.providerResourceId);
        return;
      case 'r2':
        if (params.providerResourceName) await this.wfp.r2.deleteR2Bucket(params.providerResourceName);
        return;
      case 'kv':
        if (params.providerResourceId) await this.wfp.kv.deleteKVNamespace(params.providerResourceId);
        return;
      case 'queue':
        if (params.providerResourceId) {
          await this.wfp.queues.deleteQueue(params.providerResourceId);
          return;
        }
        if (params.providerResourceName) await this.wfp.queues.deleteQueueByName(params.providerResourceName);
        return;
      case 'analyticsEngine':
      case 'analytics_engine':
      case 'secret_ref':
      case 'workflow':
      case 'workflow_binding':
      case 'durable_object_namespace':
        return;
      case 'vectorize':
        if (params.providerResourceName) await this.wfp.vectorize.deleteVectorizeIndex(params.providerResourceName);
        return;
      case 'worker':
        if (params.providerResourceName) await this.wfp.workers.deleteWorker(params.providerResourceName);
        return;
      default:
        return;
    }
  }

}
