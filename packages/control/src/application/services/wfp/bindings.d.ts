/**
 * Binding formatting helpers for the WFP (Workers for Platforms) service.
 *
 * Extracted from service.ts to keep the facade thin.
 * These functions convert domain-level WorkerBinding objects into the
 * wire format expected by the Cloudflare API when deploying or updating
 * tenant workers. Supports all Cloudflare binding types: plain_text,
 * secret_text, D1, R2, KV, Queues, Analytics Engine, Workflows, Vectorize,
 * Service bindings, and Durable Object namespaces.
 */
import type { WorkerBinding, CloudflareBindingRecord } from './wfp-contracts';
/**
 * Convert a strongly-typed WorkerBinding into the Cloudflare API record shape.
 */
export declare function formatBinding(binding: WorkerBinding): Record<string, unknown>;
/**
 * Convert an arbitrary binding-like object into the wire format suitable for
 * a settings PATCH request.  Handles WorkerBinding, CloudflareBindingRecord,
 * and raw record shapes gracefully.
 */
export declare function formatBindingForUpdate(binding: WorkerBinding | CloudflareBindingRecord | Record<string, unknown>): Record<string, unknown>;
//# sourceMappingURL=bindings.d.ts.map