import { getDb } from '../../../infra/db';
import { bundleDeployments } from '../../../infra/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { resources } from '../../../infra/db/schema-platform';
import type { Env } from '../../../shared/types';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { createClient, deleteClient } from '../oauth/client';
import { CommonEnvService } from '../common-env';
import type { ResourceProvisionResult, TakopackManifest } from './types';
import { CompensationTracker } from './compensation';

export interface OAuthProvisionResult {
  clientId?: string;
  clientSecret?: string;
}

function asMutableJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

export async function markProvisionedResourcesAsTakopackManaged(
  env: Pick<Env, 'DB'>,
  spaceId: string,
  bundleDeploymentId: string,
  provisionedResources: ResourceProvisionResult,
): Promise<void> {
  const resourceIds = [
    ...provisionedResources.d1,
    ...provisionedResources.r2,
    ...provisionedResources.kv,
    ...provisionedResources.queue,
    ...provisionedResources.analyticsEngine,
    ...provisionedResources.workflow,
    ...provisionedResources.vectorize,
    ...provisionedResources.durableObject,
  ]
    .map((resource) => resource.resourceId)
    .filter((resourceId): resourceId is string => Boolean(resourceId));

  if (resourceIds.length === 0) return;

  const db = getDb(env.DB);
  const existingResources = await db.select({
    id: resources.id,
    config: resources.config,
    metadata: resources.metadata,
  }).from(resources)
    .where(inArray(resources.id, resourceIds))
    .all();

  const provenance = {
    source: 'bundle_deployment',
    managed: true,
    bundle_deployment_id: bundleDeploymentId,
    space_id: spaceId,
  } as const;

  for (const resource of existingResources) {
    const config = asMutableJsonObject(safeJsonParseOrDefault<unknown>(resource.config, {}));
    const metadata = asMutableJsonObject(safeJsonParseOrDefault<unknown>(resource.metadata, {}));
    config.provenance = {
      ...asMutableJsonObject(config.provenance),
      bundle_deployment: provenance,
    };
    metadata.provenance = {
      ...asMutableJsonObject(metadata.provenance),
      bundle_deployment: provenance,
    };

    await db.update(resources).set({
      config: JSON.stringify(config),
      metadata: JSON.stringify(metadata),
    }).where(eq(resources.id, resource.id));
  }
}

export async function provisionOAuthClient(params: {
  env: Env;
  manifest: TakopackManifest;
  spaceId: string;
  userId: string;
  hostname: string;
  bundleDeploymentId: string;
  appBaseUrlForAutoEnv: string | null;
  tracker: CompensationTracker;
}): Promise<OAuthProvisionResult> {
  const { env, manifest, spaceId, userId, hostname, bundleDeploymentId, appBaseUrlForAutoEnv, tracker } = params;
  const db = getDb(env.DB);

  if (!manifest.oauth) {
    return {};
  }

  const redirectUris = manifest.oauth.redirectUris.map(uri =>
    uri.replace('${HOSTNAME}', hostname)
  );

  for (const uri of redirectUris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error(`Invalid redirect URI: ${uri}`);
    }

    const isLocalhost = (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
      && parsed.protocol === 'http:';
    const isOwnHostname = parsed.hostname === hostname && parsed.protocol === 'https:';

    if (!isLocalhost && !isOwnHostname) {
      throw new Error(
        `Redirect URI not allowed: ${uri}. ` +
        `Must be https://${hostname}/... or http://localhost/... for development.`
      );
    }
  }

  const oauthResult = await createClient(env.DB, {
    client_name: manifest.oauth.clientName,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: manifest.oauth.scopes.join(' '),
  }, userId);

  const clientId = oauthResult.client_id;
  const clientSecret = manifest.oauth.autoEnv && oauthResult.client_secret
    ? oauthResult.client_secret
    : undefined;

  await db.update(bundleDeployments).set({ oauthClientId: clientId }).where(eq(bundleDeployments.id, bundleDeploymentId));

  tracker.add('revoke oauth client', async () => {
    await deleteClient(env.DB, clientId);
  });

  if (manifest.oauth.autoEnv && appBaseUrlForAutoEnv) {
    const commonEnvService = new CommonEnvService(env);
    await commonEnvService.ensureSystemCommonEnv(spaceId, [
      {
        name: 'APP_BASE_URL',
        value: appBaseUrlForAutoEnv,
      },
    ]);
  }

  return { clientId, clientSecret };
}
