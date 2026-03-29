import type { Env } from '../../../shared/types';
import { type CloudflareManagedResourceType } from '../../../platform/providers/cloudflare/resources.ts';
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
    queue?: {
        deliveryDelaySeconds?: number;
    };
    analyticsEngine?: {
        dataset?: string;
    };
    workflow?: {
        service: string;
        export: string;
        timeoutMs?: number;
        maxRetries?: number;
    };
};
export declare function provisionCloudflareResource(env: Env, input: ProvisionCloudflareResourceInput): Promise<{
    id: string;
    cfId: string | null;
    cfName: string;
}>;
export {};
//# sourceMappingURL=lifecycle.d.ts.map