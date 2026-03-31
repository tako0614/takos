import type { Env } from '../../../../shared/types/index.ts';
import { getDb, serviceCustomDomains } from '../../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';

import { resolveHostnameRouting, upsertHostnameRouting } from '../../routing/service.ts';
import type { RoutingTarget } from '../../routing/routing-models.ts';
import { ServiceDesiredStateService } from '../worker-desired-state.ts';
import { logError } from '../../../../shared/utils/logger.ts';
import {
  SSL_TERMINAL_FAILURE_STATUSES,
  CustomDomainError,
} from './domain-models.ts';
import type { DomainStatus, VerifyCustomDomainResult } from './domain-models.ts';
import { getServiceForUser, requireServiceWriteAccess } from './access.ts';
import { verifyDNS } from './dns.ts';
import { createCloudflareCustomHostname, deleteCloudflareCustomHostname, getCloudflareCustomHostnameStatus } from './cloudflare.ts';

export async function verifyCustomDomain(
  env: Env,
  serviceId: string,
  userId: string,
  domainId: string
): Promise<VerifyCustomDomainResult> {
  const db = getDb(env.DB);

  const service = await requireServiceWriteAccess(env, serviceId, userId);
  const desiredState = new ServiceDesiredStateService(env);

  const customDomain = await db.select().from(serviceCustomDomains)
    .where(and(
      eq(serviceCustomDomains.id, domainId),
      eq(serviceCustomDomains.serviceId, serviceId),
    ))
    .get();

  if (!customDomain) {
    throw new CustomDomainError('Custom domain not found', 404);
  }

  if (customDomain.status === 'active') {
    return { status: 200, body: { status: 'active', message: 'Domain is already verified' } };
  }

  await db.update(serviceCustomDomains)
    .set({ status: 'verifying', updatedAt: new Date().toISOString() })
    .where(eq(serviceCustomDomains.id, domainId));

  const verifyHost = `verify.${env.TENANT_BASE_DOMAIN}`;
  const expectedValue = customDomain.verificationMethod === 'cname'
    ? `${customDomain.verificationToken}.${verifyHost}`
    : customDomain.verificationToken;

  const verification = await verifyDNS(
    customDomain.domain,
    expectedValue,
    customDomain.verificationMethod as 'cname' | 'txt'
  );

  if (!verification.verified) {
    await db.update(serviceCustomDomains)
      .set({ status: 'pending', updatedAt: new Date().toISOString() })
      .where(eq(serviceCustomDomains.id, domainId));

    return {
      status: 400,
      body: {
        status: 'pending',
        message: verification.error || 'Verification failed',
        verified: false,
      },
    };
  }

  await db.update(serviceCustomDomains)
    .set({ status: 'dns_verified', updatedAt: new Date().toISOString() })
    .where(eq(serviceCustomDomains.id, domainId));

  const cfResult = await createCloudflareCustomHostname(env, customDomain.domain);

  if (!cfResult.success) {
    await db.update(serviceCustomDomains)
      .set({
        status: 'ssl_failed',
        sslStatus: 'failed',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(serviceCustomDomains.id, domainId));

    return {
      status: 500,
      body: {
        status: 'ssl_failed',
        message: cfResult.error || 'Failed to configure SSL/TLS certificate',
        dns_verified: true,
        ssl_verified: false,
      },
    };
  }

  const hasCustomHostname = !!cfResult.customHostnameId;
  const initialStatus: DomainStatus = hasCustomHostname ? 'ssl_pending' : 'active';
  const initialSslStatus = hasCustomHostname ? 'pending' : 'active';

  const nowTimestamp = new Date().toISOString();
  try {
    await db.update(serviceCustomDomains)
      .set({
        status: initialStatus,
        cfCustomHostnameId: cfResult.customHostnameId || null,
        sslStatus: initialSslStatus,
        verifiedAt: nowTimestamp,
        updatedAt: nowTimestamp,
      })
      .where(eq(serviceCustomDomains.id, domainId));
  } catch (dbError) {
    logError('DB update failed', dbError, { module: 'services/platform/custom-domains' });
    if (cfResult.customHostnameId) {
      await deleteCloudflareCustomHostname(env, cfResult.customHostnameId);
    }
    return { status: 500, body: { error: 'Failed to update domain status' } };
  }

  let target: RoutingTarget | null = null;
  if (service.hostname) {
    const resolved = await resolveHostnameRouting({ env, hostname: service.hostname });
    target = resolved.tombstone ? null : resolved.target;
  }
  if (!target) {
    target = await desiredState.getRoutingTarget(serviceId);
  }

  if (target) {
    try {
      await upsertHostnameRouting({
        env,
        hostname: customDomain.domain,
        target,
      });
    } catch (kvError) {
      logError('KV update failed, rolling back DB status', kvError, { module: 'services/platform/custom-domains' });
      try {
        await db.update(serviceCustomDomains)
          .set({
            status: 'dns_verified',
            cfCustomHostnameId: null,
            sslStatus: null,
            verifiedAt: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(serviceCustomDomains.id, domainId));
      } catch (compensateError) {
        logError('Failed to compensate DB after KV failure', compensateError, { module: 'services/platform/custom-domains' });
      }
      if (cfResult.customHostnameId) {
        await deleteCloudflareCustomHostname(env, cfResult.customHostnameId);
      }
      return { status: 500, body: { error: 'Failed to register hostname routing' } };
    }
  }

  if (hasCustomHostname) {
    return {
      status: 200,
      body: {
        status: 'ssl_pending',
        message: 'DNS verified. SSL/TLS certificate is being provisioned. Check back shortly.',
        dns_verified: true,
        ssl_verified: false,
        verified_at: new Date().toISOString(),
        ssl_status: 'pending',
      },
    };
  }

  return {
    status: 200,
    body: {
      status: 'active',
      message: 'Domain verified and activated successfully',
      dns_verified: true,
      ssl_verified: true,
      verified_at: new Date().toISOString(),
      ssl_status: 'active',
    },
  };
}

export async function getCustomDomainDetails(
  env: Env,
  serviceId: string,
  userId: string,
  domainId: string
) {
  const db = getDb(env.DB);

  const service = await getServiceForUser(env, serviceId, userId);
  if (!service) {
    throw new CustomDomainError('Service not found', 404);
  }

  const customDomain = await db.select().from(serviceCustomDomains)
    .where(and(
      eq(serviceCustomDomains.id, domainId),
      eq(serviceCustomDomains.serviceId, serviceId),
    ))
    .get();

  if (!customDomain) {
    throw new CustomDomainError('Custom domain not found', 404);
  }

  let sslStatus = customDomain.sslStatus;
  let domainStatus = customDomain.status;

  if (customDomain.cfCustomHostnameId && customDomain.sslStatus === 'pending') {
    const cfStatus = await getCloudflareCustomHostnameStatus(
      env,
      customDomain.cfCustomHostnameId
    );

    if (cfStatus) {
      if (cfStatus.sslStatus === 'active') {
        sslStatus = 'active';
        domainStatus = 'active';
        await db.update(serviceCustomDomains)
          .set({
            status: 'active',
            sslStatus: 'active',
            updatedAt: new Date().toISOString(),
          })
          .where(eq(serviceCustomDomains.id, domainId));
      } else if (['pending_validation', 'pending_issuance', 'pending_deployment'].includes(cfStatus.sslStatus)) {
        sslStatus = 'pending';
      } else if (SSL_TERMINAL_FAILURE_STATUSES.includes(cfStatus.sslStatus)) {
        sslStatus = 'failed';
        domainStatus = 'ssl_failed';
        await db.update(serviceCustomDomains)
          .set({
            status: 'ssl_failed',
            sslStatus: 'failed',
            updatedAt: new Date().toISOString(),
          })
          .where(eq(serviceCustomDomains.id, domainId));
      }
    }
  }

  const cnameTarget = `${service.slug}.${env.TENANT_BASE_DOMAIN}`;
  const verifyHost = `verify.${env.TENANT_BASE_DOMAIN}`;

  return {
    id: customDomain.id,
    domain: customDomain.domain,
    status: domainStatus,
    verification_method: customDomain.verificationMethod,
    ssl_status: sslStatus,
    verified_at: customDomain.verifiedAt,
    created_at: customDomain.createdAt,
    instructions: domainStatus !== 'active' ? {
      cname_target: cnameTarget,
      verification_record: customDomain.verificationMethod === 'cname'
        ? {
            type: 'CNAME',
            name: `_acme-challenge.${customDomain.domain}`,
            value: `${customDomain.verificationToken}.${verifyHost}`,
          }
        : {
            type: 'TXT',
            name: `_takos-verify.${customDomain.domain}`,
            value: `takos-verify=${customDomain.verificationToken}`,
          },
    } : undefined,
  };
}

export async function refreshSslStatus(
  env: Env,
  serviceId: string,
  userId: string,
  domainId: string
) {
  const db = getDb(env.DB);

  await requireServiceWriteAccess(env, serviceId, userId);

  const customDomain = await db.select().from(serviceCustomDomains)
    .where(and(
      eq(serviceCustomDomains.id, domainId),
      eq(serviceCustomDomains.serviceId, serviceId),
    ))
    .get();

  if (!customDomain) {
    throw new CustomDomainError('Custom domain not found', 404);
  }

  if (!customDomain.cfCustomHostnameId) {
    return {
      status: customDomain.status,
      ssl_status: customDomain.sslStatus,
    };
  }

  const cfStatus = await getCloudflareCustomHostnameStatus(
    env,
    customDomain.cfCustomHostnameId
  );

  if (!cfStatus) {
    return {
      status: customDomain.status,
      ssl_status: customDomain.sslStatus,
    };
  }

  let newSslStatus: string;
  let newDomainStatus: string;

  if (cfStatus.sslStatus === 'active') {
    newSslStatus = 'active';
    newDomainStatus = 'active';
  } else if (SSL_TERMINAL_FAILURE_STATUSES.includes(cfStatus.sslStatus)) {
    newSslStatus = 'failed';
    newDomainStatus = 'ssl_failed';
  } else {
    newSslStatus = 'pending';
    newDomainStatus = 'ssl_pending';
  }

  if (newSslStatus !== customDomain.sslStatus || newDomainStatus !== customDomain.status) {
    await db.update(serviceCustomDomains)
      .set({
        status: newDomainStatus,
        sslStatus: newSslStatus,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(serviceCustomDomains.id, domainId));
  }

  return {
    status: newDomainStatus,
    ssl_status: newSslStatus,
    hostname_status: cfStatus.status,
  };
}
