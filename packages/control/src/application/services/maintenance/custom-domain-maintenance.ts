import type { Env } from '../../../shared/types';
import { getDb, serviceCustomDomains } from '../../../infra/db';
import { and, asc, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import { now } from '../../../shared/utils';
import { deleteCloudflareCustomHostname, getCloudflareCustomHostnameStatus } from '../platform/custom-domains';
import { deleteHostnameRouting, resolveHostnameRouting, upsertHostnameRouting } from '../routing/service';
import type { RoutingTarget } from '../routing/types';
import { ServiceDesiredStateService } from '../platform/worker-desired-state';
import { listServiceRouteRecordsByIds } from '../platform/workers';
import { logError, logWarn } from '../../../shared/utils/logger';
import { DOH_ENDPOINT, DNS_RESOLVE_TIMEOUT_MS } from '../../../shared/constants/dns.ts';

const SSL_PENDING_STATES = new Set(['pending', 'pending_validation', 'pending_issuance', 'pending_deployment']);
const SSL_FAILURE_STATES = new Set(['deleted', 'expired', 'validation_timed_out', 'issuance_timed_out']);

async function verifyOwnershipRecord(
  domain: string,
  verificationToken: string,
  verificationMethod: string,
  platformDomain: string
): Promise<boolean> {
  const method = verificationMethod === 'txt' ? 'txt' : 'cname';
  const expectedValue = method === 'cname'
    ? `${verificationToken}.verify.${platformDomain}`
    : `takos-verify=${verificationToken}`;
  const recordName = method === 'cname'
    ? `_acme-challenge.${domain}`
    : `_takos-verify.${domain}`;
  const recordType = method === 'cname' ? 'CNAME' : 'TXT';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DNS_RESOLVE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${DOH_ENDPOINT}?name=${encodeURIComponent(recordName)}&type=${recordType}`,
      {
        headers: { Accept: 'application/dns-json' },
        signal: controller.signal,
      }
    );

    if (!response.ok) return false;

    const data = (await response.json()) as {
      Answer?: Array<{ data: string }>;
    };

    if (!data.Answer || data.Answer.length === 0) {
      return false;
    }

    for (const answer of data.Answer) {
      const normalized = answer.data.replace(/^"|"$/g, '').replace(/\.$/, '').toLowerCase();
      if (normalized === expectedValue.toLowerCase()) {
        return true;
      }
    }

    return false;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return false;
    }
    logError('DNS verification failed', err, { module: 'custom-domain-maintenance' });
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface CustomDomainReverificationSummary {
  scanned: number;
  active: number;
  verifying: number;
  failed: number;
  expired: number;
  sslPromoted: number;
  errors: number;
}

export async function runCustomDomainReverification(
  env: Env,
  options?: { batchSize?: number }
): Promise<CustomDomainReverificationSummary> {
  const db = getDb(env.DB);
  const desiredState = new ServiceDesiredStateService(env);
  const batchSize = options?.batchSize ?? 200;
  const platformDomain = env.TENANT_BASE_DOMAIN;

  const domainRows = await db.select({
    id: serviceCustomDomains.id,
    domain: serviceCustomDomains.domain,
    status: serviceCustomDomains.status,
    verificationToken: serviceCustomDomains.verificationToken,
    verificationMethod: serviceCustomDomains.verificationMethod,
    cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
    sslStatus: serviceCustomDomains.sslStatus,
    serviceId: serviceCustomDomains.serviceId,
  })
    .from(serviceCustomDomains)
    .where(inArray(serviceCustomDomains.status, ['active', 'ssl_pending']))
    .orderBy(asc(serviceCustomDomains.updatedAt))
    .limit(batchSize)
    .all();

  const serviceRouteMap = new Map(
    (await listServiceRouteRecordsByIds(
      env.DB,
      [...new Set(domainRows.map((row) => row.serviceId).filter(Boolean))],
    )).map((service) => [service.id, service]),
  );

  const domains = domainRows.map(row => ({
    id: row.id,
    domain: row.domain,
    status: row.status,
    verificationToken: row.verificationToken,
    verificationMethod: row.verificationMethod,
    cfCustomHostnameId: row.cfCustomHostnameId,
    sslStatus: row.sslStatus,
    service: {
      id: row.serviceId,
      hostname: serviceRouteMap.get(row.serviceId)?.hostname ?? null,
    },
  }));

  const summary: CustomDomainReverificationSummary = {
    scanned: domains.length,
    active: 0,
    verifying: 0,
    failed: 0,
    expired: 0,
    sslPromoted: 0,
    errors: 0,
  };

  for (const domain of domains) {
    try {
      // ssl_pending domains: skip DNS re-verification, only check CF SSL status
      if (domain.status === 'ssl_pending') {
        if (!domain.cfCustomHostnameId) {
          // No CF hostname ID — shouldn't be in ssl_pending, reset to dns_verified
          await db.update(serviceCustomDomains)
            .set({ status: 'dns_verified', updatedAt: now() })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.failed += 1;
          continue;
        }

        const cfStatus = await getCloudflareCustomHostnameStatus(env, domain.cfCustomHostnameId);

        if (cfStatus && cfStatus.sslStatus === 'active') {
          // SSL provisioned — promote to active and ensure KV routing
          await db.update(serviceCustomDomains)
            .set({ status: 'active', sslStatus: 'active', updatedAt: now() })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          let target: RoutingTarget | null = null;
          if (domain.service.hostname) {
            const resolved = await resolveHostnameRouting({ env, hostname: domain.service.hostname });
            target = resolved.tombstone ? null : resolved.target;
          }
          if (!target) {
            target = await desiredState.getRoutingTarget(domain.service.id);
          }
          if (target) {
            await upsertHostnameRouting({
              env,
              hostname: domain.domain,
              target,
            });
          }
          summary.sslPromoted += 1;
          summary.active += 1;
        } else if (cfStatus && SSL_FAILURE_STATES.has(cfStatus.sslStatus)) {
          // SSL failed/expired — mark as ssl_failed and remove KV routing
          await db.update(serviceCustomDomains)
            .set({ status: 'ssl_failed', sslStatus: 'failed', updatedAt: now() })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          await deleteHostnameRouting({ env, hostname: domain.domain });
          summary.failed += 1;
        } else {
          // Still pending — just touch updatedAt
          await db.update(serviceCustomDomains)
            .set({ updatedAt: now() })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.verifying += 1;
        }
        continue;
      }

      // Active domains: full DNS ownership re-verification
      await db.update(serviceCustomDomains)
        .set({
          status: 'verifying',
          updatedAt: now(),
        })
        .where(eq(serviceCustomDomains.id, domain.id))
        .run();

      const ownershipValid = await verifyOwnershipRecord(
        domain.domain,
        domain.verificationToken,
        domain.verificationMethod,
        platformDomain
      );

      if (!ownershipValid) {
        await db.update(serviceCustomDomains)
          .set({
            status: 'failed',
            sslStatus: 'failed',
            updatedAt: now(),
          })
          .where(eq(serviceCustomDomains.id, domain.id))
          .run();
        await deleteHostnameRouting({ env, hostname: domain.domain });
        summary.failed += 1;
        continue;
      }

      let nextStatus: 'active' | 'verifying' | 'failed' | 'expired' = 'active';
      let nextSslStatus: 'active' | 'pending' | 'failed' = 'active';

      if (domain.cfCustomHostnameId) {
        const cfStatus = await getCloudflareCustomHostnameStatus(env, domain.cfCustomHostnameId);

        if (cfStatus) {
          if (cfStatus.sslStatus === 'active') {
            nextStatus = 'active';
            nextSslStatus = 'active';
          } else if (SSL_FAILURE_STATES.has(cfStatus.sslStatus)) {
            nextStatus = cfStatus.sslStatus === 'expired' ? 'expired' : 'failed';
            nextSslStatus = 'failed';
          } else if (SSL_PENDING_STATES.has(cfStatus.sslStatus)) {
            nextStatus = 'verifying';
            nextSslStatus = 'pending';
          } else {
            nextStatus = 'verifying';
            nextSslStatus = 'pending';
          }
        } else {
          nextStatus = 'verifying';
          nextSslStatus = 'pending';
        }
      }

      if (nextStatus === 'active') {
        let target: RoutingTarget | null = null;
        if (domain.service.hostname) {
          const resolved = await resolveHostnameRouting({ env, hostname: domain.service.hostname });
          target = resolved.tombstone ? null : resolved.target;
        }
        if (!target) {
          target = await desiredState.getRoutingTarget(domain.service.id);
        }

        if (target) {
          await upsertHostnameRouting({
            env,
            hostname: domain.domain,
            target,
          });
        }
      } else if (nextStatus === 'failed' || nextStatus === 'expired') {
        await deleteHostnameRouting({ env, hostname: domain.domain });
      }

      await db.update(serviceCustomDomains)
        .set({
          status: nextStatus,
          sslStatus: nextSslStatus,
          updatedAt: now(),
        })
        .where(eq(serviceCustomDomains.id, domain.id))
        .run();

      if (nextStatus === 'active') {
        summary.active += 1;
      } else if (nextStatus === 'verifying') {
        summary.verifying += 1;
      } else if (nextStatus === 'expired') {
        summary.expired += 1;
      } else {
        summary.failed += 1;
      }
    } catch (err) {
      summary.errors += 1;
      logError('Reverification error', {
        domainId: domain.id,
        domain: domain.domain,
        error: err instanceof Error ? err.message : String(err),
      }, { module: 'custom-domain-maintenance' });
    }
  }

  return summary;
}

export interface ReconcileStuckDomainsSummary {
  scanned: number;
  cleaned: number;
  reset: number;
  errors: number;
}

export async function reconcileStuckDomains(
  env: Env,
  options?: { staleThresholdMs?: number }
): Promise<ReconcileStuckDomainsSummary> {
  const db = getDb(env.DB);
  const thresholdMs = options?.staleThresholdMs ?? 60 * 60 * 1000; // 1 hour
  const oneHourAgo = new Date(Date.now() - thresholdMs).toISOString();

  const stuckDomains = await db.select()
    .from(serviceCustomDomains)
    .where(
      or(
        and(
          eq(serviceCustomDomains.status, 'dns_verified'),
          isNotNull(serviceCustomDomains.cfCustomHostnameId),
          lt(serviceCustomDomains.updatedAt, oneHourAgo),
        ),
        and(
          eq(serviceCustomDomains.status, 'ssl_pending'),
          lt(serviceCustomDomains.updatedAt, oneHourAgo),
        ),
      )
    )
    .all();

  const summary: ReconcileStuckDomainsSummary = {
    scanned: stuckDomains.length,
    cleaned: 0,
    reset: 0,
    errors: 0,
  };

  for (const domain of stuckDomains) {
    try {
      if (domain.status === 'dns_verified' && domain.cfCustomHostnameId) {
        // Double-failure orphan: dns_verified with a stale CF hostname ID
        // Clean up the orphaned CF hostname and reset DB state
        await deleteCloudflareCustomHostname(env, domain.cfCustomHostnameId);
        await db.update(serviceCustomDomains)
          .set({
            cfCustomHostnameId: null,
            sslStatus: null,
            updatedAt: now(),
          })
          .where(eq(serviceCustomDomains.id, domain.id))
          .run();
        logWarn('Cleaned orphaned CF hostname', { module: 'custom-domain-maintenance', ...{
          domainId: domain.id,
          domain: domain.domain,
          cfHostnameId: domain.cfCustomHostnameId,
        } });
        summary.cleaned += 1;
      } else if (domain.status === 'ssl_pending') {
        // ssl_pending stuck > 1 hour — check CF status
        if (!domain.cfCustomHostnameId) {
          // No CF hostname — reset to dns_verified for retry
          await db.update(serviceCustomDomains)
            .set({ status: 'dns_verified', sslStatus: null, updatedAt: now() })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.reset += 1;
          continue;
        }

        const cfStatus = await getCloudflareCustomHostnameStatus(env, domain.cfCustomHostnameId);

        if (!cfStatus) {
          // CF returned null/error — hostname gone, reset for retry
          await db.update(serviceCustomDomains)
            .set({
              status: 'dns_verified',
              cfCustomHostnameId: null,
              sslStatus: null,
              updatedAt: now(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.reset += 1;
        } else if (SSL_FAILURE_STATES.has(cfStatus.sslStatus)) {
          // CF reports failure
          await db.update(serviceCustomDomains)
            .set({
              status: 'ssl_failed',
              sslStatus: 'failed',
              updatedAt: now(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          await deleteHostnameRouting({ env, hostname: domain.domain });
          summary.cleaned += 1;
        }
        // If still pending at CF, leave alone — CF provisioning can be slow
      }
    } catch (err) {
      summary.errors += 1;
      logError('Stuck domain reconciliation error', {
        domainId: domain.id,
        domain: domain.domain,
        error: err instanceof Error ? err.message : String(err),
      }, { module: 'custom-domain-maintenance' });
    }
  }

  return summary;
}
