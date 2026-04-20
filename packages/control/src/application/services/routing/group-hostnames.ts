import { and, desc, eq, inArray } from "drizzle-orm";

import {
  accounts,
  getDb,
  groups,
  serviceCustomDomains,
  services,
} from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/env.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import type { RoutingBindings, RoutingTarget } from "./routing-models.ts";
import { resolveHostnameRouting } from "./service.ts";

type GroupHostnameEnv = Pick<Env, "DB" | "TENANT_BASE_DOMAIN">;

export type GroupHostnameKind = "auto" | "custom-slug" | "custom-domain";

export interface GroupHostnameEntry {
  hostname: string;
  kind: GroupHostnameKind;
  sourceServiceId?: string;
  sourceDomainId?: string;
}

export interface GroupHostnameSet {
  autoHostname: string | null;
  customSlugHostname: string | null;
  customDomainHostnames: string[];
  hostnames: string[];
  entries: GroupHostnameEntry[];
}

export function normalizeTenantBaseDomain(
  value: string | null | undefined,
): string | null {
  const domain = value?.trim().replace(/^\.+/, "").toLowerCase();
  return domain || null;
}

export function slugifyGroupHostnameSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildGroupAutoHostname(
  spaceSlug: string,
  groupName: string,
  tenantBaseDomain: string,
): string | null {
  const spaceSegment = slugifyGroupHostnameSegment(spaceSlug);
  const groupSegment = slugifyGroupHostnameSegment(groupName);
  const baseDomain = normalizeTenantBaseDomain(tenantBaseDomain);
  if (!spaceSegment || !groupSegment || !baseDomain) return null;
  return `${spaceSegment}-${groupSegment}.${baseDomain}`;
}

function normalizeHostname(hostname: string | null | undefined): string | null {
  const normalized = hostname?.trim().replace(/^\.+/, "").toLowerCase();
  return normalized || null;
}

function appendUnique(
  entries: GroupHostnameEntry[],
  entry: GroupHostnameEntry | null,
): void {
  if (!entry) return;
  if (entries.some((existing) => existing.hostname === entry.hostname)) return;
  entries.push(entry);
}

async function loadGroupHostnameParts(
  env: Pick<Env, "DB">,
  params: { groupId: string; spaceId?: string },
): Promise<{ groupName: string; spaceSlug: string } | null> {
  const db = getDb(env.DB);
  const group = await db.select({
    name: groups.name,
    spaceId: groups.spaceId,
  })
    .from(groups)
    .where(eq(groups.id, params.groupId))
    .get() ?? null;
  const spaceId = group?.spaceId ?? params.spaceId;
  if (!group?.name || !spaceId) return null;

  const space = await db.select({ slug: accounts.slug })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .get() ?? null;
  if (!space?.slug) return null;

  return { groupName: group.name, spaceSlug: space.slug };
}

export async function getGroupAutoHostname(
  env: GroupHostnameEnv,
  params: { groupId: string; spaceId?: string },
): Promise<string | null> {
  const tenantBaseDomain = normalizeTenantBaseDomain(env.TENANT_BASE_DOMAIN);
  if (!tenantBaseDomain) return null;
  const parts = await loadGroupHostnameParts(env, params);
  if (!parts) return null;
  return buildGroupAutoHostname(
    parts.spaceSlug,
    parts.groupName,
    tenantBaseDomain,
  );
}

function parseConfig(raw: string | null): {
  managedBy?: string;
  customSlug?: string;
} {
  return safeJsonParseOrDefault(raw, {});
}

function inferLegacyCustomSlug(
  groupId: string,
  slug: string | null,
  config: { managedBy?: string; customSlug?: string },
): string | null {
  const normalized = slugifyGroupHostnameSegment(slug ?? "");
  if (!normalized || config.managedBy !== "group") return null;
  if (config.customSlug) return slugifyGroupHostnameSegment(config.customSlug);
  const managedPrefix = `grp-${
    slugifyGroupHostnameSegment(groupId.slice(0, 8))
  }`;
  return normalized.startsWith(`${managedPrefix}-`) ? null : normalized;
}

export async function getGroupCustomSlugHostname(
  env: GroupHostnameEnv,
  groupId: string,
): Promise<GroupHostnameEntry | null> {
  const tenantBaseDomain = normalizeTenantBaseDomain(env.TENANT_BASE_DOMAIN);
  if (!tenantBaseDomain) return null;

  const db = getDb(env.DB);
  const rows = await db.select({
    id: services.id,
    slug: services.slug,
    config: services.config,
    updatedAt: services.updatedAt,
  })
    .from(services)
    .where(eq(services.groupId, groupId))
    .orderBy(desc(services.updatedAt), desc(services.id))
    .all();

  for (const row of rows) {
    const config = parseConfig(row.config);
    const slug = inferLegacyCustomSlug(groupId, row.slug, config);
    if (!slug) continue;
    return {
      hostname: `${slug}.${tenantBaseDomain}`,
      kind: "custom-slug",
      sourceServiceId: row.id,
    };
  }

  return null;
}

export async function listGroupCustomDomainHostnames(
  env: Pick<Env, "DB">,
  groupId: string,
): Promise<GroupHostnameEntry[]> {
  const db = getDb(env.DB);
  const rows = await db.select({
    id: serviceCustomDomains.id,
    domain: serviceCustomDomains.domain,
    serviceId: serviceCustomDomains.serviceId,
  })
    .from(serviceCustomDomains)
    .innerJoin(services, eq(services.id, serviceCustomDomains.serviceId))
    .where(and(
      eq(services.groupId, groupId),
      inArray(serviceCustomDomains.status, ["active", "ssl_pending"]),
    ))
    .orderBy(
      desc(serviceCustomDomains.updatedAt),
      desc(serviceCustomDomains.id),
    )
    .all();

  const entries: GroupHostnameEntry[] = [];
  for (const row of rows) {
    const hostname = normalizeHostname(row.domain);
    if (!hostname) continue;
    appendUnique(entries, {
      hostname,
      kind: "custom-domain",
      sourceServiceId: row.serviceId,
      sourceDomainId: row.id,
    });
  }
  return entries;
}

export async function listGroupRoutingHostnames(
  env: GroupHostnameEnv,
  params: { groupId: string; spaceId?: string },
): Promise<GroupHostnameSet> {
  const entries: GroupHostnameEntry[] = [];
  const autoHostname = await getGroupAutoHostname(env, params);
  appendUnique(
    entries,
    autoHostname ? { hostname: autoHostname, kind: "auto" } : null,
  );

  const customSlug = await getGroupCustomSlugHostname(env, params.groupId);
  appendUnique(entries, customSlug);

  for (
    const customDomain of await listGroupCustomDomainHostnames(
      env,
      params.groupId,
    )
  ) {
    appendUnique(entries, customDomain);
  }

  const customDomainHostnames = entries
    .filter((entry) => entry.kind === "custom-domain")
    .map((entry) => entry.hostname);
  return {
    autoHostname,
    customSlugHostname: customSlug?.hostname ?? null,
    customDomainHostnames,
    hostnames: entries.map((entry) => entry.hostname),
    entries,
  };
}

export async function getCanonicalCnameTargetForService(
  env: GroupHostnameEnv,
  service: {
    id: string;
    space_id: string;
    group_id?: string | null;
    hostname?: string | null;
    slug?: string | null;
  },
): Promise<string | null> {
  const tenantBaseDomain = normalizeTenantBaseDomain(env.TENANT_BASE_DOMAIN);
  if (service.group_id) {
    const hostnames = await listGroupRoutingHostnames(env, {
      groupId: service.group_id,
      spaceId: service.space_id,
    });
    return hostnames.customSlugHostname ?? hostnames.autoHostname;
  }
  if (service.slug && tenantBaseDomain) {
    return `${slugifyGroupHostnameSegment(service.slug)}.${tenantBaseDomain}`;
  }
  return normalizeHostname(service.hostname);
}

export async function resolveRoutingTargetForServiceHostname(
  env: GroupHostnameEnv & RoutingBindings,
  service: {
    id: string;
    space_id: string;
    group_id?: string | null;
    hostname?: string | null;
  },
): Promise<RoutingTarget | null> {
  if (service.group_id) {
    const hostnames = await listGroupRoutingHostnames(env, {
      groupId: service.group_id,
      spaceId: service.space_id,
    });
    for (const hostname of hostnames.hostnames) {
      const resolved = await resolveHostnameRouting({ env, hostname });
      const target = resolved.tombstone ? null : resolved.target;
      if (target) return target;
    }
    return null;
  }

  const hostname = normalizeHostname(service.hostname);
  if (!hostname) return null;
  const resolved = await resolveHostnameRouting({ env, hostname });
  return resolved.tombstone ? null : resolved.target;
}
