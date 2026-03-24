/**
 * Central compatibility surface for Cloudflare-shaped Takos contracts.
 *
 * Application code imports from this package instead of importing vendor
 * packages directly. The current source of truth still matches Cloudflare's
 * official types, while keeping the dependency boundary in one place.
 */

import type { R2Object, VectorizeMatch, VectorizeMatches } from '@cloudflare/workers-types';

export type { ExecutionContext } from 'hono';

export type {
  Ai,
  D1Database,
  D1DatabaseSession,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStub,
  Fetcher,
  KVNamespace,
  MessageBatch,
  Queue,
  QueueSendOptions,
  R2Bucket,
  R2ListOptions,
  R2Object,
  R2ObjectBody,
  R2Objects,
  ScheduledController,
  ScheduledEvent,
  VectorizeIndex,
  VectorizeMatch,
  VectorizeQueryOptions,
  VectorizeVector,
} from '@cloudflare/workers-types';

export type R2ObjectMetadata = R2Object;

// Cloudflare exposes this shape as VectorizeMatches. Takos already uses the
// more explicit VectorizeQueryResult name internally, so keep that alias stable.
export interface VectorizeQueryResult extends VectorizeMatches {
  matches: VectorizeMatch[];
}

// D1 raw() overload discrimination is not exported by workers-types.
export type D1RawOptions = { columnNames: true } | { columnNames?: false };
