import type { Env } from "../../../../shared/types/index.ts";
import {
  getDb,
  serviceCustomDomains,
  services,
} from "../../../../infra/db/index.ts";
import { and, count, eq } from "drizzle-orm";
import {
  generateDomainId,
  generateVerificationToken,
  isDomainReserved,
  isValidDomain,
  normalizeDomain,
} from "../../../../shared/utils/domain-validation.ts";

import { deleteHostnameRouting } from "../../routing/service.ts";
import { ServiceDesiredStateService } from "../worker-desired-state.ts";
import { logError } from "../../../../shared/utils/logger.ts";
import {
  CustomDomainError,
  MAX_CUSTOM_DOMAINS_PER_GROUP,
  MAX_CUSTOM_DOMAINS_PER_SERVICE,
} from "./domain-models.ts";
import type { AddCustomDomainResult, DnsInstruction } from "./domain-models.ts";
import { getServiceForUser, requireServiceWriteAccess } from "./access.ts";
import { deleteManagedCustomHostname } from "./custom-hostname-provider.ts";
import {
  getCanonicalCnameTargetForService,
  resolveRoutingTargetForServiceHostname,
} from "../../routing/group-hostnames.ts";

export async function listCustomDomains(
  env: Env,
  serviceId: string,
  userId: string,
) {
  const db = getDb(env.DB);

  const service = await getServiceForUser(env, serviceId, userId);
  if (!service) {
    throw new CustomDomainError("Service not found", 404);
  }

  const domains = service.group_id
    ? await db.select({
      id: serviceCustomDomains.id,
      serviceId: serviceCustomDomains.serviceId,
      domain: serviceCustomDomains.domain,
      status: serviceCustomDomains.status,
      verificationToken: serviceCustomDomains.verificationToken,
      verificationMethod: serviceCustomDomains.verificationMethod,
      cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
      sslStatus: serviceCustomDomains.sslStatus,
      verifiedAt: serviceCustomDomains.verifiedAt,
      createdAt: serviceCustomDomains.createdAt,
      updatedAt: serviceCustomDomains.updatedAt,
    }).from(serviceCustomDomains)
      .innerJoin(services, eq(services.id, serviceCustomDomains.serviceId))
      .where(eq(services.groupId, service.group_id))
      .orderBy(serviceCustomDomains.createdAt)
      .all()
    : await db.select().from(serviceCustomDomains)
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
  body: { domain?: string; verification_method?: "cname" | "txt" } | null,
): Promise<AddCustomDomainResult> {
  const db = getDb(env.DB);

  const service = await requireServiceWriteAccess(env, serviceId, userId);
  const desiredState = new ServiceDesiredStateService(env);
  const activeRoutingTarget =
    await resolveRoutingTargetForServiceHostname(env, service) ??
      await desiredState.getRoutingTarget(serviceId);

  if (!activeRoutingTarget) {
    throw new CustomDomainError("Service is not active", 400);
  }

  if (!service.group_id && !service.slug) {
    throw new CustomDomainError(
      "Service is not properly configured for custom domains",
      400,
    );
  }

  if (!body) {
    throw new CustomDomainError("Invalid JSON body", 400);
  }

  if (!body.domain) {
    throw new CustomDomainError("Domain is required", 400);
  }

  const domain = normalizeDomain(body.domain);
  const verificationMethod = body.verification_method || "cname";

  if (!isValidDomain(domain)) {
    throw new CustomDomainError("Invalid domain format", 400);
  }

  if (isDomainReserved(domain, env.TENANT_BASE_DOMAIN)) {
    throw new CustomDomainError("This domain cannot be used", 400);
  }

  const domainCountResult = service.group_id
    ? await db.select({ count: count() }).from(serviceCustomDomains)
      .innerJoin(services, eq(services.id, serviceCustomDomains.serviceId))
      .where(eq(services.groupId, service.group_id))
      .get()
    : await db.select({ count: count() }).from(serviceCustomDomains)
      .where(eq(serviceCustomDomains.serviceId, serviceId))
      .get();

  const maxDomains = service.group_id
    ? MAX_CUSTOM_DOMAINS_PER_GROUP
    : MAX_CUSTOM_DOMAINS_PER_SERVICE;
  if ((domainCountResult?.count ?? 0) >= maxDomains) {
    throw new CustomDomainError(
      `Maximum ${maxDomains} custom domains allowed`,
      400,
    );
  }

  const existing = await db.select({ id: serviceCustomDomains.id }).from(
    serviceCustomDomains,
  )
    .where(eq(serviceCustomDomains.domain, domain))
    .get();

  if (existing) {
    throw new CustomDomainError("Domain is already registered", 409);
  }

  const domainId = generateDomainId();
  const verificationToken = generateVerificationToken();
  const cnameTarget = await getCanonicalCnameTargetForService(env, service);
  if (!cnameTarget) {
    throw new CustomDomainError(
      "Service is not properly configured for custom domains",
      400,
    );
  }

  try {
    const timestamp = new Date().toISOString();
    await db.insert(serviceCustomDomains).values({
      id: domainId,
      serviceId,
      domain,
      status: "pending",
      verificationToken,
      verificationMethod,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const verifyHost = `verify.${env.TENANT_BASE_DOMAIN}`;

    const instructions: { step1: DnsInstruction; step2: DnsInstruction } =
      verificationMethod === "cname"
        ? {
          step1: {
            type: "CNAME",
            name: domain,
            value: cnameTarget,
            description: `Point your domain to ${cnameTarget}`,
          },
          step2: {
            type: "CNAME",
            name: `_acme-challenge.${domain}`,
            value: `${verificationToken}.${verifyHost}`,
            description: "Add this record to verify domain ownership",
          },
        }
        : {
          step1: {
            type: "CNAME",
            name: domain,
            value: cnameTarget,
            description: `Point your domain to ${cnameTarget}`,
          },
          step2: {
            type: "TXT",
            name: `_takos-verify.${domain}`,
            value: `takos-verify=${verificationToken}`,
            description: "Add this record to verify domain ownership",
          },
        };

    return {
      status: 201,
      body: {
        id: domainId,
        domain,
        status: "pending",
        verification_method: verificationMethod,
        verification_token: verificationToken,
        instructions,
      },
    };
  } catch (err) {
    logError("Failed to create custom domain", err, {
      module: "services/platform/custom-domains",
    });
    throw new CustomDomainError("Failed to create custom domain", 500);
  }
}

export async function deleteCustomDomain(
  env: Env,
  serviceId: string,
  userId: string,
  domainId: string,
) {
  const db = getDb(env.DB);

  const service = await requireServiceWriteAccess(env, serviceId, userId);

  const customDomain = service.group_id
    ? await db.select({
      id: serviceCustomDomains.id,
      serviceId: serviceCustomDomains.serviceId,
      domain: serviceCustomDomains.domain,
      status: serviceCustomDomains.status,
      verificationToken: serviceCustomDomains.verificationToken,
      verificationMethod: serviceCustomDomains.verificationMethod,
      cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
      sslStatus: serviceCustomDomains.sslStatus,
      verifiedAt: serviceCustomDomains.verifiedAt,
      createdAt: serviceCustomDomains.createdAt,
      updatedAt: serviceCustomDomains.updatedAt,
    }).from(serviceCustomDomains)
      .innerJoin(services, eq(services.id, serviceCustomDomains.serviceId))
      .where(and(
        eq(serviceCustomDomains.id, domainId),
        eq(services.groupId, service.group_id),
      ))
      .get()
    : await db.select().from(serviceCustomDomains)
      .where(and(
        eq(serviceCustomDomains.id, domainId),
        eq(serviceCustomDomains.serviceId, serviceId),
      ))
      .get();

  if (!customDomain) {
    throw new CustomDomainError("Custom domain not found", 404);
  }

  // Delete KV routing entry FIRST to stop traffic immediately.
  // If KV delete fails, we abort before removing the D1 record so
  // the domain can be retried later (no orphaned routing entries).
  try {
    await deleteHostnameRouting({ env, hostname: customDomain.domain });
  } catch (kvError) {
    logError("Failed to delete hostname routing from KV", kvError, {
      module: "services/platform/custom-domains",
    });
    throw new CustomDomainError(
      "Failed to remove routing entry. Domain not deleted. Please retry.",
      500,
    );
  }

  const cleanupErrors: string[] = [];

  try {
    await db.delete(serviceCustomDomains).where(
      eq(serviceCustomDomains.id, domainId),
    );
  } catch (dbError) {
    logError(
      "Failed to delete custom domain from DB after KV cleanup",
      dbError,
      { module: "services/platform/custom-domains" },
    );
    cleanupErrors.push("DB record cleanup failed — routing already removed");
  }

  if (customDomain.cfCustomHostnameId) {
    try {
      await deleteManagedCustomHostname(
        env,
        customDomain.cfCustomHostnameId,
      );
    } catch (cfError) {
      logError("Failed to delete managed custom hostname", cfError, {
        module: "services/platform/custom-domains",
      });
      cleanupErrors.push("Managed hostname cleanup failed");
    }
  }

  if (cleanupErrors.length > 0) {
    return {
      success: true,
      warnings: cleanupErrors,
      message: "Domain routing removed but some cleanup tasks failed",
    };
  }

  return { success: true };
}
