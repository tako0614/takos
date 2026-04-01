/**
 * Type definitions for group deploy — deploying an entire app.yml manifest
 * as a unit directly to Cloudflare, bypassing the store install flow.
 */
import type { AppManifest } from "./group-deploy-manifest.ts";

// ── Options ──────────────────────────────────────────────────────────────────

export interface GroupDeployOptions {
  /** Parsed app.yml manifest */
  manifest: AppManifest;
  /** Target environment (staging, production) */
  env: string;
  /** Dispatch namespace name (omit for account top-level) */
  namespace?: string;
  /** Group name override (defaults to manifest.metadata.name) */
  groupName?: string;
  /** Cloudflare account ID */
  accountId: string;
  /** Cloudflare API token */
  apiToken: string;
  /** dry-run: show plan without deploying */
  dryRun?: boolean;
  /** Compatibility date for workers (defaults to 2026-04-01) */
  compatibilityDate?: string;
}

// ── Results ──────────────────────────────────────────────────────────────────

export type ServiceDeployStatus = "deployed" | "failed" | "skipped";
export type ResourceProvisionStatus =
  | "provisioned"
  | "exists"
  | "failed"
  | "skipped";
export type BindingStatus = "bound" | "failed";

export interface ServiceDeployResult {
  name: string;
  type: "worker" | "container" | "service" | "http";
  status: ServiceDeployStatus;
  scriptName?: string;
  url?: string;
  error?: string;
}

export interface ResourceProvisionResult {
  name: string;
  type: string;
  status: ResourceProvisionStatus;
  id?: string;
  error?: string;
}

export interface BindingResult {
  from: string;
  to: string;
  type: string;
  status: BindingStatus;
  error?: string;
}

export interface GroupDeployResult {
  groupName: string;
  env: string;
  namespace?: string;
  dryRun: boolean;
  services: ServiceDeployResult[];
  resources: ResourceProvisionResult[];
  bindings: BindingResult[];
}

// ── Provisioned resource tracking ────────────────────────────────────────────

export interface ProvisionedResource {
  name: string;
  type: string;
  id: string;
  binding: string;
}

// ── Wrangler config ──────────────────────────────────────────────────────────

export interface WranglerD1Binding {
  binding: string;
  database_name: string;
  database_id: string;
}

export interface WranglerR2Binding {
  binding: string;
  bucket_name: string;
}

export interface WranglerKVBinding {
  binding: string;
  id: string;
}

export interface WranglerServiceBinding {
  binding: string;
  service: string;
}

export interface WranglerQueueProducer {
  queue: string;
  binding: string;
}

export interface WranglerVectorizeIndex {
  index_name: string;
  binding: string;
}

export interface WranglerVars {
  [key: string]: string;
}

export interface WranglerConfig {
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags?: string[];
  vars?: WranglerVars;
  d1_databases?: WranglerD1Binding[];
  r2_buckets?: WranglerR2Binding[];
  kv_namespaces?: WranglerKVBinding[];
  services?: WranglerServiceBinding[];
  queues_producers?: WranglerQueueProducer[];
  vectorize?: WranglerVectorizeIndex[];
}
