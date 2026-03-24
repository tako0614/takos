import { getDb } from '../../../infra/db';
import { repositories } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import {
  capabilityRegistry,
  resolveAllowedCapabilities,
  type TenantType,
} from '../platform/capabilities';
import { CommonEnvService } from '../common-env';
import { uniqueEnvNames } from '../common-env/crypto';
import { MANAGED_COMMON_ENV_KEYS } from '../common-env/crypto';
import { normalizeTakosScopes, TAKOS_ACCESS_TOKEN_ENV_NAME } from '../common-env/takos-builtins';
import { inferRequiredCapabilitiesFromManifest } from './capability-scan';
import type { TakopackManifest } from './types';

type JsonObject = Record<string, unknown>;

export function asJsonObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

export function parseJsonObject(raw: string | null | undefined): JsonObject | null {
  if (!raw) return null;
  const parsed = safeJsonParseOrDefault<unknown>(raw, null);
  return asJsonObject(parsed);
}

export function normalizeTakosBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid takosBaseUrl: ${raw}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Invalid takosBaseUrl protocol: ${parsed.protocol} (expected http: or https:)`);
  }
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
}

export function resolveTakosUrlSource(params: {
  takosBaseUrl?: string;
  adminDomain?: string;
}): string | null {
  const explicit = String(params.takosBaseUrl || '').trim();
  if (explicit) {
    return normalizeTakosBaseUrl(explicit);
  }
  const adminDomain = String(params.adminDomain || '').trim();
  if (adminDomain) {
    return `https://${adminDomain}`;
  }
  return null;
}

export function parseRepoRef(value: string): { username: string; repoName: string } | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const clean = raw.startsWith('@') ? raw.slice(1) : raw;
  const m = /^([a-z0-9][a-z0-9_-]{0,63})\/([a-z0-9][a-z0-9_.-]{0,127})$/i.exec(clean);
  if (!m) return null;
  return { username: m[1], repoName: m[2] };
}

type TakopackDependencySpec = NonNullable<TakopackManifest['dependencies']>[number];

export function normalizeDependencies(raw: unknown): TakopackDependencySpec[] {
  if (!Array.isArray(raw)) return [];

  const out: TakopackDependencySpec[] = [];
  for (const item of raw as Array<Partial<TakopackDependencySpec>>) {
    const repo = String(item?.repo || '').trim();
    const version = String(item?.version || '').trim();
    if (!repo || !version) continue;
    out.push({ repo, version });
  }

  const seen = new Set<string>();
  for (const dep of out) {
    const parts = parseRepoRef(dep.repo);
    if (!parts) {
      throw new Error(`Invalid dependency repo reference: ${dep.repo}`);
    }
    const key = `${parts.username.toLowerCase()}/${parts.repoName.toLowerCase()}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate dependency declaration for repo: ${dep.repo}`);
    }
    seen.add(key);
  }

  return out;
}

export function isTakopackManagedResource(
  configRaw: string | null | undefined,
  metadataRaw: string | null | undefined,
  takopackId: string,
  spaceId: string,
): boolean {
  const matches = (raw: string | null | undefined): boolean => {
    const root = parseJsonObject(raw);
    const provenance = asJsonObject(root?.provenance);
    const bundleDeployment = asJsonObject(provenance?.bundle_deployment);
    if (!bundleDeployment) return false;

    const source = String(bundleDeployment.source ?? '').trim();
    if (source !== 'bundle_deployment' && source !== 'takopack') return false;
    if (bundleDeployment.managed !== true) return false;

    const bundleDeploymentId =
      typeof bundleDeployment.bundle_deployment_id === 'string'
        ? bundleDeployment.bundle_deployment_id
        : typeof bundleDeployment.takopackId === 'string'
          ? bundleDeployment.takopackId
          : null;
    if (bundleDeploymentId !== takopackId) return false;

    return bundleDeployment.space_id === spaceId;
  };

  return matches(configRaw) || matches(metadataRaw);
}

export interface ValidateManifestResult {
  requiredEnvKeys: string[];
  requestedCapabilities: string[];
  appBaseUrlForAutoEnv: string | null;
}

export async function validateManifestForInstall(params: {
  env: Env;
  manifest: TakopackManifest;
  spaceId: string;
  userId: string;
  sourceRepoId?: string;
  sourceType?: 'git' | 'upload';
  requireAutoEnvApproval?: boolean;
  oauthAutoEnvApproved?: boolean;
  takosBaseUrl?: string;
}): Promise<ValidateManifestResult> {
  const { env, manifest, spaceId, userId } = params;
  const db = getDb(env.DB);

  if (params.requireAutoEnvApproval && manifest.oauth?.autoEnv && !params.oauthAutoEnvApproved) {
    throw new Error(
      'manifest.oauth.autoEnv requires explicit installer approval. Set approve_oauth_auto_env=true.'
    );
  }

  const appBaseUrlForAutoEnv = manifest.oauth?.autoEnv
    ? resolveTakosUrlSource({
      takosBaseUrl: params.takosBaseUrl,
      adminDomain: env.ADMIN_DOMAIN,
    })
    : null;
  if (manifest.oauth?.autoEnv && !appBaseUrlForAutoEnv) {
    throw new Error(
      'manifest.oauth.autoEnv requires APP_BASE_URL source. Configure ADMIN_DOMAIN or provide takosBaseUrl.'
    );
  }

  const rawRequiredEnvKeys = (manifest.env?.required || [])
    .map((key) => String(key || '').trim())
    .filter(Boolean);
  const requiredEnvKeys = uniqueEnvNames([
    ...rawRequiredEnvKeys,
    ...(manifest.oauth?.autoEnv ? ['APP_BASE_URL'] : []),
  ]);

  if (manifest.takos?.scopes?.length) {
    normalizeTakosScopes(manifest.takos.scopes);
  }

  if (requiredEnvKeys.includes(TAKOS_ACCESS_TOKEN_ENV_NAME)) {
    if (!manifest.takos?.scopes?.length) {
      throw new Error(
        'manifest.env.required includes TAKOS_ACCESS_TOKEN, but Package.spec.takos.scopes is missing.'
      );
    }
  }

  const inferredRequired = inferRequiredCapabilitiesFromManifest(manifest);
  const hasExplicitCapabilities = Array.isArray(manifest.capabilities);
  const declaredRaw = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
  const { known: declared, unknown, duplicates } = capabilityRegistry.validate(
    declaredRaw.map((v) => String(v).trim()).filter(Boolean)
  );

  if (unknown.length > 0) {
    throw new Error(`Unknown capabilities in manifest.capabilities: ${unknown.join(', ')}`);
  }
  if (duplicates.length > 0) {
    throw new Error(`Duplicate capabilities in manifest.capabilities: ${duplicates.join(', ')}`);
  }

  const requestedCapabilities = hasExplicitCapabilities ? declared : inferredRequired;
  if (hasExplicitCapabilities) {
    const missing = inferredRequired.filter((cap) => !declared.includes(cap));
    if (missing.length > 0) {
      throw new Error(
        `manifest.capabilities is missing required capabilities implied by content: ${missing.join(', ')}`
      );
    }
  }

  let tenantType: TenantType = 'third_party';
  if (params.sourceType === 'git' && params.sourceRepoId) {
    const repo = await db.select({ isOfficial: repositories.isOfficial }).from(repositories).where(eq(repositories.id, params.sourceRepoId)).get();
    tenantType = repo?.isOfficial ? 'official' : 'third_party';
  }

  const { allowed } = await resolveAllowedCapabilities({
    db: env.DB,
    spaceId,
    userId,
    tenantType,
  });

  const denied = requestedCapabilities.filter((cap) => !allowed.has(cap));
  if (denied.length > 0) {
    throw new Error(`Capability not allowed for this workspace context: ${denied.join(', ')}`);
  }

  if (requiredEnvKeys.length > 0) {
    const preflightRequiredEnvKeys = requiredEnvKeys.filter((key) => !MANAGED_COMMON_ENV_KEYS.has(key));
    if (preflightRequiredEnvKeys.length > 0) {
      const commonEnvService = new CommonEnvService(env);
      const workspaceCommonEnv = await commonEnvService.listWorkspaceCommonEnv(spaceId);
      const availableCommonEnvKeys = new Set(workspaceCommonEnv.map((entry) => entry.name));
      const missingRequiredEnvKeys = preflightRequiredEnvKeys.filter((key) => !availableCommonEnvKeys.has(key));
      if (missingRequiredEnvKeys.length > 0) {
        throw new Error(
          `Missing required workspace common env key(s): ${missingRequiredEnvKeys.join(', ')}. ` +
          'Install is blocked until these keys exist in workspace common env.'
        );
      }
    }
  }

  return {
    requiredEnvKeys,
    requestedCapabilities,
    appBaseUrlForAutoEnv,
  };
}
