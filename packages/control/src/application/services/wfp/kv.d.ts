/**
 * KV namespace methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare Workers KV namespaces that are bound to tenant workers.
 * Provides creation and deletion of KV namespaces via the Cloudflare API.
 */
import type { WfpContext } from './wfp-contracts';
/**
 * Create a KV namespace.
 */
export declare function createKVNamespace(ctx: WfpContext, title: string): Promise<string>;
/**
 * Delete a KV namespace.
 */
export declare function deleteKVNamespace(ctx: WfpContext, namespaceId: string): Promise<void>;
//# sourceMappingURL=kv.d.ts.map