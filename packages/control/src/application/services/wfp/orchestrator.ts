/**
 * Deployment orchestration methods for WFPService.
 */

import type { Env } from '../../../shared/types';
import { BadRequestError, InternalError, NotFoundError } from 'takos-common/errors';
import type { WfpContext, WorkerBinding } from './wfp-contracts';

// ---------------------------------------------------------------------------
// Deployment orchestration
// ---------------------------------------------------------------------------

/**
 * Deploy a worker with bindings from a bundle URL or pre-built script.
 */
export async function deployWorkerWithBindings(
  ctx: WfpContext,
  createWorkerFn: (options: {
    workerName: string;
    workerScript: string;
    bindings: WorkerBinding[];
    compatibility_date?: string;
    compatibility_flags?: string[];
    assetsJwt?: string;
  }) => Promise<void>,
  workerName: string,
  options: {
    bindings: Array<{
      type: string;
      name: string;
      text?: string;
      id?: string;
      bucket_name?: string;
      namespace_id?: string;
      index_name?: string;
      queue_name?: string;
      delivery_delay?: number;
      dataset?: string;
      workflow_name?: string;
      class_name?: string;
      script_name?: string;
    }>;
    bundleUrl?: string;
    bundleScript?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    /** JWT from assets upload (for static assets) */
    assetsJwt?: string;
  }
): Promise<void> {
  let workerScript: string;

  if (options.bundleScript) {
    workerScript = options.bundleScript;
  } else if (options.bundleUrl) {
    const response = await fetch(options.bundleUrl);
    if (!response.ok) {
      throw new InternalError(`Failed to fetch bundle from ${options.bundleUrl}: ${response.status}`);
    }
    workerScript = await response.text();
  } else {
    throw new BadRequestError('Either bundleUrl or bundleScript is required');
  }

  const wfpBindings: WorkerBinding[] = options.bindings.map(b => {
    switch (b.type) {
      case 'd1':
        return { type: 'd1', name: b.name, database_id: b.id };
      case 'r2':
      case 'r2_bucket':
        return { type: 'r2_bucket', name: b.name, bucket_name: b.bucket_name };
      case 'kv':
      case 'kv_namespace':
        return { type: 'kv_namespace', name: b.name, namespace_id: b.namespace_id };
      case 'queue':
        return {
          type: 'queue',
          name: b.name,
          queue_name: (b as { queue_name?: string }).queue_name,
          ...(typeof (b as { delivery_delay?: number }).delivery_delay === 'number'
            ? { delivery_delay: (b as { delivery_delay?: number }).delivery_delay }
            : {}),
        };
      case 'analytics_engine':
        return {
          type: 'analytics_engine',
          name: b.name,
          dataset: (b as { dataset?: string }).dataset,
        };
      case 'workflow':
        return {
          type: 'workflow',
          name: b.name,
          ...(typeof (b as { workflow_name?: string }).workflow_name === 'string'
            ? { workflow_name: (b as { workflow_name?: string }).workflow_name }
            : {}),
          ...(typeof (b as { class_name?: string }).class_name === 'string'
            ? { class_name: (b as { class_name?: string }).class_name }
            : {}),
          ...(typeof (b as { script_name?: string }).script_name === 'string'
            ? { script_name: (b as { script_name?: string }).script_name }
            : {}),
        };
      case 'vectorize':
        return { type: 'vectorize', name: b.name, index_name: b.index_name || b.id };
      case 'plain_text':
        return { type: 'plain_text', name: b.name, text: b.text || '' };
      case 'secret_text':
        return { type: 'secret_text', name: b.name, text: b.text || '' };
      default:
        return { type: 'plain_text', name: b.name, text: b.text || '' };
    }
  });

  await createWorkerFn({
    workerName,
    workerScript,
    bindings: wfpBindings,
    compatibility_date: options.compatibilityDate,
    compatibility_flags: options.compatibilityFlags,
    assetsJwt: options.assetsJwt,
  });
}

// ---------------------------------------------------------------------------
// Standalone helpers (not class methods)
// ---------------------------------------------------------------------------

/**
 * Get the takos worker script bundle.
 *
 * Priority:
 * 1. R2 bucket (required)
 *
 * Embedded fallback is intentionally disabled to avoid silently deploying
 * stale worker bundles that drift from yurucommu source.
 */
export async function getTakosWorkerScript(env: Pick<Env, 'WORKER_BUNDLES'>): Promise<string> {
  if (!env.WORKER_BUNDLES) {
    throw new InternalError(
      'WORKER_BUNDLES is not configured. ' +
      'Provisioning requires an explicit worker bundle in R2.'
    );
  }

  const object = await env.WORKER_BUNDLES.get('worker.js');
  if (!object) {
    throw new NotFoundError('worker.js is missing in WORKER_BUNDLES');
  }
  try {
    return await object.text();
  } catch (e) {
    throw new InternalError(
      `Failed to read worker bundle: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/**
 * Get the D1 migration SQL for takos tenant database.
 */
export function getTakosMigrationSQL(): string {
  return `
-- Migration: 0001_initial
-- Description: Initial schema for takos tenant

-- Local user (single user per tenant)
CREATE TABLE IF NOT EXISTS local_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  header_url TEXT,
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- Used JTIs (for replay protection)
CREATE TABLE IF NOT EXISTS used_jtis (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_used_jtis_expires_at ON used_jtis(expires_at);

-- Posts
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES local_users(id),
  content TEXT NOT NULL,
  content_warning TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'unlisted', 'followers', 'direct')),
  in_reply_to_id TEXT,
  in_reply_to_actor TEXT,
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);

-- Remote actors (cached)
CREATE TABLE IF NOT EXISTS remote_actors (
  id TEXT PRIMARY KEY,
  actor_url TEXT UNIQUE NOT NULL,
  inbox TEXT NOT NULL,
  shared_inbox TEXT,
  public_key TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_remote_actors_actor_url ON remote_actors(actor_url);

-- Follows (both local->remote and remote->local)
CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_actor TEXT NOT NULL,
  following_actor TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(follower_actor, following_actor)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_actor);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_actor);
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);

-- Inbox queue (for async processing)
CREATE TABLE IF NOT EXISTS inbox_queue (
  id TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL,
  actor_url TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  processed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_queue_processed ON inbox_queue(processed_at);
CREATE INDEX IF NOT EXISTS idx_inbox_queue_received ON inbox_queue(received_at);

-- Outbox queue (for delivery)
CREATE TABLE IF NOT EXISTS outbox_queue (
  id TEXT PRIMARY KEY,
  activity_json TEXT NOT NULL,
  target_inbox TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_outbox_queue_next_attempt ON outbox_queue(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_queue_completed ON outbox_queue(completed_at);

-- Likes
CREATE TABLE IF NOT EXISTS likes (
  id TEXT PRIMARY KEY,
  actor_url TEXT NOT NULL,
  object_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(actor_url, object_url)
);

CREATE INDEX IF NOT EXISTS idx_likes_object ON likes(object_url);

-- Announces (boosts/reblogs)
CREATE TABLE IF NOT EXISTS announces (
  id TEXT PRIMARY KEY,
  actor_url TEXT NOT NULL,
  object_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(actor_url, object_url)
);

CREATE INDEX IF NOT EXISTS idx_announces_object ON announces(object_url);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('follow', 'like', 'announce', 'mention', 'reply')),
  actor_url TEXT NOT NULL,
  object_url TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);

-- Migration: 0002_add_signature_columns
-- Description: Add HTTP Signature verification columns to inbox_queue

ALTER TABLE inbox_queue ADD COLUMN signature_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_queue ADD COLUMN signature_error TEXT;

CREATE INDEX IF NOT EXISTS idx_inbox_queue_signature ON inbox_queue(signature_verified);

-- Migration: 0003_add_tenant_config
-- Description: Add tenant_config table for tenant configuration storage

CREATE TABLE IF NOT EXISTS tenant_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Migration: 0004_add_media_files
-- Description: Add media_files table for fast media lookup

CREATE TABLE IF NOT EXISTS media_files (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  content_type TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_media_files_key ON media_files(r2_key);
`;
}
