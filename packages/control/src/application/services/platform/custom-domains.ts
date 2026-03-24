import type { Env, WorkspaceRole } from '../../../shared/types';
import { getDb, serviceCustomDomains, accounts, accountMemberships } from '../../../infra/db';
import { services } from '../../../infra/db/schema-services';
import { eq, and, count } from 'drizzle-orm';
import { resolveActorPrincipalId } from '../identity/principals';
import { isDomainReserved } from '../../../shared/utils/reserved-domains';
import { generateDomainId, generateVerificationToken, isValidDomain, normalizeDomain } from '../../../shared/utils/domains';
import { now } from '../../../shared/utils';
import { deleteHostnameRouting, resolveHostnameRouting, upsertHostnameRouting } from '../routing';
import type { RoutingTarget } from '../routing/types';
import { createCloudflareApiClient } from '../../../platform/providers/cloudflare/api-client.ts';
import { createServiceDesiredStateService } from './worker-desired-state';
import { sql } from 'drizzle-orm';
import { logError } from '../../../shared/utils/logger';

const MAX_CUSTOM_DOMAINS_PER_SERVICE = 20;
const CUSTOM_DOMAIN_WRITE_ROLES: WorkspaceRole[] = ['owner', 'admin', 'editor'];
const SSL_TERMINAL_FAILURE_STATUSES = ['deleted', 'expired', 'validation_timed_out', 'issuance_timed_out'];

type DomainStatus = 'pending' | 'verifying' | 'dns_verified' | 'ssl_pending' | 'ssl_failed' | 'active' | 'failed';

interface DnsInstruction {
  type: 'CNAME' | 'TXT';
  name: string;
  value: string;
  description: string;
}

interface AddCustomDomainBody {
  id: string;
  domain: string;
  status: 'pending';
  verification_method: 'cname' | 'txt';
  verification_token: string;
  instructions: {
    step1: DnsInstruction;
    step2: DnsInstruction;
  };
}

interface AddCustomDomainResult {
  status: number;
  body: AddCustomDomainBody;
}

interface VerifyDomainSuccessBody {
  status: DomainStatus;
  message: string;
  dns_verified?: boolean;
  ssl_verified?: boolean;
  verified_at?: string;
  ssl_status?: string;
  verified?: boolean;
}

interface VerifyDomainErrorBody {
  error: string;
}

interface VerifyCustomDomainResult {
  status: number;
  body: VerifyDomainSuccessBody | VerifyDomainErrorBody;
}

interface ServiceInfo {
  id: string;
  space_id: string;
  service_type: 'app' | 'service';
  status: string;
  hostname: string | null;
  route_ref: string | null;
  slug: string | null;
}

export class CustomDomainError extends Error {
  status: number;
  details?: string;

  constructor(message: string, status: number, details?: string) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function getServiceForUser(
  env: Env,
  serviceId: string,
  userId: string,
  roles?: WorkspaceRole[]
): Promise<ServiceInfo | null> {
  const principalId = await resolveActorPrincipalId(env.DB, userId);
  if (!principalId) return null;
  const db = getDb(env.DB);

  // Check service ownership or membership via raw SQL for the complex nested relation query
  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
  }).from(services)
    .where(eq(services.id, serviceId))
    .get();

  if (!service) return null;

  // Check if the user has access to this service's account
  const account = await db.select().from(accounts)
    .where(eq(accounts.id, service.accountId))
    .get();

  if (!account) return null;

  // Check ownership
  if (account.ownerAccountId === principalId) {
    return {
      id: service.id,
      space_id: service.accountId,
      service_type: service.workerType as 'app' | 'service',
      status: service.status,
      hostname: service.hostname,
      route_ref: service.routeRef,
      slug: service.slug,
    };
  }

  // Check membership
  const conditions = [
    eq(accountMemberships.accountId, service.accountId),
    eq(accountMemberships.memberId, principalId),
  ];

  const membership = await db.select().from(accountMemberships)
    .where(and(...conditions))
    .get();

  if (!membership) return null;

  if (roles && roles.length > 0 && !roles.includes(membership.role as WorkspaceRole)) {
    return null;
  }

  return {
    id: service.id,
    space_id: service.accountId,
    service_type: service.workerType as 'app' | 'service',
    status: service.status,
    hostname: service.hostname,
    route_ref: service.routeRef,
    slug: service.slug,
  };
}

async function requireServiceWriteAccess(env: Env, serviceId: string, userId: string): Promise<ServiceInfo> {
  const service = await getServiceForUser(env, serviceId, userId, CUSTOM_DOMAIN_WRITE_ROLES);
  if (service) {
    return service;
  }

  const visibleService = await getServiceForUser(env, serviceId, userId);
  if (visibleService) {
    throw new CustomDomainError('Insufficient permissions to manage custom domains', 403);
  }

  throw new CustomDomainError('Service not found', 404);
}

async function verifyDNS(
  domain: string,
  expectedValue: string,
  method: 'cname' | 'txt'
): Promise<{ verified: boolean; error?: string }> {
  try {
    const recordName = method === 'cname'
      ? `_acme-challenge.${domain}`
      : `_takos-verify.${domain}`;

    const dnsType = method === 'cname' ? 'CNAME' : 'TXT';

    const response = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(recordName)}&type=${dnsType}`,
      {
        headers: {
          'Accept': 'application/dns-json',
        },
      }
    );

    if (!response.ok) {
      return { verified: false, error: 'DNS query failed' };
    }

    const data = await response.json() as {
      Status: number;
      Answer?: Array<{ data: string }>;
    };

    if (data.Status !== 0 || !data.Answer) {
      return { verified: false, error: 'No DNS record found' };
    }

    for (const answer of data.Answer) {
      const value = answer.data.replace(/^"|"$/g, '').toLowerCase();
      if (method === 'cname') {
        if (value.includes(expectedValue.toLowerCase())) {
          return { verified: true };
        }
      } else {
        if (value.includes(`takos-verify=${expectedValue.toLowerCase()}`)) {
          return { verified: true };
        }
      }
    }

    return { verified: false, error: 'Verification record not found or incorrect' };
  } catch (err) {
    logError('DNS verification error', err, { module: 'services/platform/custom-domains' });
    return { verified: false, error: 'DNS verification failed' };
  }
}

async function createCloudflareCustomHostname(
  env: Env,
  domain: string
): Promise<{ success: boolean; customHostnameId?: string; error?: string }> {
  const cfClient = createCloudflareApiClient(env);
  if (!cfClient?.zoneId) {
    return { success: true };
  }

  try {
    const result = await cfClient.zonePost<{ id: string }>('/custom_hostnames', {
      hostname: domain,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: { min_tls_version: '1.2' },
      },
    });
    return { success: true, customHostnameId: result.id };
  } catch (err) {
    logError('Cloudflare API error', err, { module: 'services/platform/custom-domains' });
    const message = err instanceof Error ? err.message : 'Failed to create custom hostname';
    return { success: false, error: message };
  }
}

export async function deleteCloudflareCustomHostname(
  env: Env,
  customHostnameId: string
): Promise<void> {
  const cfClient = createCloudflareApiClient(env);
  if (!cfClient?.zoneId || !customHostnameId) return;

  try {
    await cfClient.zoneDelete(`/custom_hostnames/${customHostnameId}`);
  } catch (err) {
    logError('Failed to delete custom hostname', err, { module: 'services/platform/custom-domains' });
  }
}

export async function getCloudflareCustomHostnameStatus(
  env: Env,
  customHostnameId: string
): Promise<{ status: string; sslStatus: string } | null> {
  const cfClient = createCloudflareApiClient(env);
  if (!cfClient?.zoneId || !customHostnameId) return null;

  try {
    const result = await cfClient.zoneGet<{ status: string; ssl?: { status: string } }>(
      `/custom_hostnames/${customHostnameId}`
    );
    return {
      status: result.status,
      sslStatus: result.ssl?.status || 'pending',
    };
  } catch (err) {
    logError('Failed to get custom hostname status', err, { module: 'services/platform/custom-domains' });
    return null;
  }
}

export async function listCustomDomains(env: Env, serviceId: string, userId: string) {
  const db = getDb(env.DB);

  const service = await getServiceForUser(env, serviceId, userId);
  if (!service) {
    throw new CustomDomainError('Service not found', 404);
  }

  const domains = await db.select().from(serviceCustomDomains)
    .where(eq(serviceCustomDomains.serviceId, serviceId))
    .orderBy(serviceCustomDomains.createdAt)
    .all();
  const verificationHost = `verify.${env.TENANT_BASE_DOMAIN}`;

  return {
    domains: domains.map((d) => ({
      id: d.id,
      service_id: d.serviceId,
      domain: d.domain,
      status: d.status,
      verification_token: d.verificationToken,
      verification_host: verificationHost,
      verification_method: d.verificationMethod,
      ssl_status: d.sslStatus,
      verified_at: d.verifiedAt,
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    })),
  };
}

export async function addCustomDomain(
  env: Env,
  serviceId: string,
  userId: string,
  body: { domain?: string; verification_method?: 'cname' | 'txt' } | null
): Promise<AddCustomDomainResult> {
  const db = getDb(env.DB);

  const service = await requireServiceWriteAccess(env, serviceId, userId);
  const desiredState = createServiceDesiredStateService(env);
  const activeRoutingTarget = await desiredState.getRoutingTarget(serviceId);

  if (!activeRoutingTarget) {
    throw new CustomDomainError('Service is not active', 400);
  }

  if (!service.slug) {
    throw new CustomDomainError('Service is not properly configured for custom domains', 400);
  }

  if (!body) {
    throw new CustomDomainError('Invalid JSON body', 400);
  }

  if (!body.domain) {
    throw new CustomDomainError('Domain is required', 400);
  }

  const domain = normalizeDomain(body.domain);
  const verificationMethod = body.verification_method || 'cname';

  if (!isValidDomain(domain)) {
    throw new CustomDomainError('Invalid domain format', 400);
  }

  if (isDomainReserved(domain, env.TENANT_BASE_DOMAIN)) {
    throw new CustomDomainError('This domain cannot be used', 400);
  }

  const domainCountResult = await db.select({ count: count() }).from(serviceCustomDomains)
    .where(eq(serviceCustomDomains.serviceId, serviceId))
    .get();

  if ((domainCountResult?.count ?? 0) >= MAX_CUSTOM_DOMAINS_PER_SERVICE) {
    throw new CustomDomainError(`Maximum ${MAX_CUSTOM_DOMAINS_PER_SERVICE} custom domains allowed`, 400);
  }

  const existing = await db.select({ id: serviceCustomDomains.id }).from(serviceCustomDomains)
    .where(eq(serviceCustomDomains.domain, domain))
    .get();

  if (existing) {
    throw new CustomDomainError('Domain is already registered', 409);
  }

  const domainId = generateDomainId();
  const verificationToken = generateVerificationToken();

  try {
    const timestamp = now();
    await db.insert(serviceCustomDomains).values({
      id: domainId,
      serviceId,
      domain,
      status: 'pending',
      verificationToken,
      verificationMethod,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const cnameTarget = `${service.slug}.${env.TENANT_BASE_DOMAIN}`;
    const verifyHost = `verify.${env.TENANT_BASE_DOMAIN}`;

    const instructions: { step1: DnsInstruction; step2: DnsInstruction } = verificationMethod === 'cname'
      ? {
          step1: {
            type: 'CNAME',
            name: domain,
            value: cnameTarget,
            description: `Point your domain to ${cnameTarget}`,
          },
          step2: {
            type: 'CNAME',
            name: `_acme-challenge.${domain}`,
            value: `${verificationToken}.${verifyHost}`,
            description: 'Add this record to verify domain ownership',
          },
        }
      : {
          step1: {
            type: 'CNAME',
            name: domain,
            value: cnameTarget,
            description: `Point your domain to ${cnameTarget}`,
          },
          step2: {
            type: 'TXT',
            name: `_takos-verify.${domain}`,
            value: `takos-verify=${verificationToken}`,
            description: 'Add this record to verify domain ownership',
          },
        };

    return {
      status: 201,
      body: {
        id: domainId,
        domain,
        status: 'pending',
        verification_method: verificationMethod,
        verification_token: verificationToken,
        instructions,
      },
    };
  } catch (err) {
    logError('Failed to create custom domain', err, { module: 'services/platform/custom-domains' });
    throw new CustomDomainError('Failed to create custom domain', 500);
  }
}

export async function verifyCustomDomain(
  env: Env,
  serviceId: string,
  userId: string,
  domainId: string
): Promise<VerifyCustomDomainResult> {
  const db = getDb(env.DB);

  const service = await requireServiceWriteAccess(env, serviceId, userId);
  const desiredState = createServiceDesiredStateService(env);

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
    .set({ status: 'verifying', updatedAt: now() })
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
      .set({ status: 'pending', updatedAt: now() })
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
    .set({ status: 'dns_verified', updatedAt: now() })
    .where(eq(serviceCustomDomains.id, domainId));

  const cfResult = await createCloudflareCustomHostname(env, customDomain.domain);

  if (!cfResult.success) {
    await db.update(serviceCustomDomains)
      .set({
        status: 'ssl_failed',
        sslStatus: 'failed',
        updatedAt: now(),
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

  const nowTimestamp = now();
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
            updatedAt: now(),
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
        verified_at: now(),
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
      verified_at: now(),
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
            updatedAt: now(),
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
            updatedAt: now(),
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

export async function deleteCustomDomain(
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

  // Delete KV routing entry FIRST to stop traffic immediately.
  // If KV delete fails, we abort before removing the D1 record so
  // the domain can be retried later (no orphaned routing entries).
  try {
    await deleteHostnameRouting({ env, hostname: customDomain.domain });
  } catch (kvError) {
    logError('Failed to delete hostname routing from KV', kvError, { module: 'services/platform/custom-domains' });
    throw new CustomDomainError(
      'Failed to remove routing entry. Domain not deleted. Please retry.',
      500
    );
  }

  const cleanupErrors: string[] = [];

  try {
    await db.delete(serviceCustomDomains).where(eq(serviceCustomDomains.id, domainId));
  } catch (dbError) {
    logError('Failed to delete custom domain from DB after KV cleanup', dbError, { module: 'services/platform/custom-domains' });
    cleanupErrors.push('DB record cleanup failed — routing already removed');
  }

  if (customDomain.cfCustomHostnameId) {
    try {
      await deleteCloudflareCustomHostname(env, customDomain.cfCustomHostnameId);
    } catch (cfError) {
      logError('Failed to delete Cloudflare custom hostname', cfError, { module: 'services/platform/custom-domains' });
      cleanupErrors.push('Cloudflare hostname cleanup failed');
    }
  }

  if (cleanupErrors.length > 0) {
    return {
      success: true,
      warnings: cleanupErrors,
      message: 'Domain routing removed but some cleanup tasks failed',
    };
  }

  return { success: true };
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
        updatedAt: now(),
      })
      .where(eq(serviceCustomDomains.id, domainId));
  }

  return {
    status: newDomainStatus,
    ssl_status: newSslStatus,
    hostname_status: cfStatus.status,
  };
}
