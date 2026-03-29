/**
 * Queue methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare Queues that are bound to tenant workers. Provides
 * creation (with optional delivery delay), listing, deletion by ID, and
 * deletion by name.
 */
import type { WfpContext } from './wfp-contracts';
export declare function createQueue(ctx: WfpContext, queueName: string, options?: {
    deliveryDelaySeconds?: number;
}): Promise<{
    id: string;
    name: string;
}>;
export declare function listQueues(ctx: WfpContext): Promise<Array<{
    id: string;
    name: string;
}>>;
export declare function deleteQueue(ctx: WfpContext, queueId: string): Promise<void>;
export declare function deleteQueueByName(ctx: WfpContext, queueName: string): Promise<void>;
//# sourceMappingURL=queues.d.ts.map