import type { ToolDefinition, ToolHandler } from '../../types';
import { generateId, now } from '../../../../shared/utils';
import { getDb, serviceCustomDomains } from '../../../../infra/db';
import { eq, and, desc } from 'drizzle-orm';
import { deleteHostnameRouting, upsertHostnameRouting } from '../../../services/routing/service';
import { createServiceDesiredStateService } from '../../../services/platform/worker-desired-state';
import { getServiceRouteRecord } from '../../../services/platform/workers';

export const DOMAIN_LIST: ToolDefinition = {
  name: 'domain_list',
  description: 'List custom domains for a service',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description: 'Service ID',
      },
    },
    required: ['service_id'],
  },
};

export const DOMAIN_ADD: ToolDefinition = {
  name: 'domain_add',
  description: 'Add a custom domain to a service. Returns DNS records to configure.',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description: 'Service ID',
      },
      domain: {
        type: 'string',
        description: 'Domain name (e.g., myapp.example.com)',
      },
    },
    required: ['service_id', 'domain'],
  },
};

export const DOMAIN_VERIFY: ToolDefinition = {
  name: 'domain_verify',
  description: 'Verify DNS configuration for a custom domain',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description: 'Service ID',
      },
      domain: {
        type: 'string',
        description: 'Domain name to verify',
      },
    },
    required: ['service_id', 'domain'],
  },
};

export const DOMAIN_REMOVE: ToolDefinition = {
  name: 'domain_remove',
  description: 'Remove a custom domain from a service',
  category: 'deploy',
  parameters: {
    type: 'object',
    properties: {
      service_id: {
        type: 'string',
        description: 'Service ID',
      },
      domain: {
        type: 'string',
        description: 'Domain name to remove',
      },
    },
    required: ['service_id', 'domain'],
  },
};

export const domainListHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;

  const db = getDb(context.db);
  const domains = await db.select({
    domain: serviceCustomDomains.domain,
    status: serviceCustomDomains.status,
    verificationToken: serviceCustomDomains.verificationToken,
    createdAt: serviceCustomDomains.createdAt,
  }).from(serviceCustomDomains).where(eq(serviceCustomDomains.serviceId, serviceId))
    .orderBy(desc(serviceCustomDomains.createdAt)).all();

  if (domains.length === 0) {
    return `No custom domains configured for service: ${serviceId}`;
  }

  const lines = domains.map(d => {
    const statusIcon = d.status === 'active' ? '✅' : d.status === 'pending' ? '⏳' : '❌';
    return `${statusIcon} ${d.domain} (${d.status})`;
  });

  return `Custom domains:\n${lines.join('\n')}`;
};

export const domainAddHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;
  const domain = args.domain as string;
  const { env } = context;

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain.toLowerCase())) {
    throw new Error('Invalid domain format');
  }

  const db = getDb(context.db);

  const service = await getServiceRouteRecord(context.db, serviceId);

  if (!service || service.accountId !== context.spaceId) {
    throw new Error(`Service not found: ${serviceId}`);
  }

  const existing = await db.select({ id: serviceCustomDomains.id })
    .from(serviceCustomDomains).where(eq(serviceCustomDomains.domain, domain.toLowerCase())).get();

  if (existing) {
    throw new Error(`Domain already registered: ${domain}`);
  }

  const verifyToken = `takos-verify-${generateId()}`;
  const id = generateId();
  await db.insert(serviceCustomDomains).values({
    id,
    serviceId,
    domain: domain.toLowerCase(),
    status: 'pending',
    verificationToken: verifyToken,
    verificationMethod: 'cname',
    createdAt: now(),
    updatedAt: now(),
  });

  const desiredState = createServiceDesiredStateService(env);
  const target = await desiredState.getRoutingTarget(serviceId);
  if (target) {
    await upsertHostnameRouting({
      env,
      hostname: domain.toLowerCase(),
      target,
    });
  }

  return `Domain added: ${domain}

To verify ownership, add one of these DNS records:

Option 1 - CNAME (recommended):
  Type: CNAME
  Name: ${domain}
  Value: ${env.TENANT_BASE_DOMAIN}

Option 2 - TXT verification:
  Type: TXT
  Name: _takos-verify.${domain}
  Value: ${verifyToken}

After adding DNS records, use domain_verify to complete setup.`;
};

export const domainVerifyHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;
  const domain = args.domain as string;

  const db = getDb(context.db);

  const domainRecord = await db.select({
    id: serviceCustomDomains.id,
    verificationToken: serviceCustomDomains.verificationToken,
  })
    .from(serviceCustomDomains)
    .where(and(eq(serviceCustomDomains.serviceId, serviceId), eq(serviceCustomDomains.domain, domain.toLowerCase())))
    .get();

  if (!domainRecord) {
    throw new Error(`Domain not found: ${domain}`);
  }

  try {
    const cnameResp = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain}&type=CNAME`, {
      headers: { 'Accept': 'application/dns-json' },
    });
    const cnameData = await cnameResp.json() as { Answer?: Array<{ data: string }> };

    if (cnameData.Answer?.length) {
      await db.update(serviceCustomDomains).set({ status: 'active', verifiedAt: now(), updatedAt: now() })
        .where(eq(serviceCustomDomains.id, domainRecord.id));

      return `Domain verified via CNAME: ${domain}\nThe domain is now active.`;
    }

    const txtResp = await fetch(`https://cloudflare-dns.com/dns-query?name=_takos-verify.${domain}&type=TXT`, {
      headers: { 'Accept': 'application/dns-json' },
    });
    const txtData = await txtResp.json() as { Answer?: Array<{ data: string }> };

    if (txtData.Answer?.some(a => a.data.includes(domainRecord.verificationToken))) {
      await db.update(serviceCustomDomains).set({ status: 'active', verifiedAt: now(), updatedAt: now() })
        .where(eq(serviceCustomDomains.id, domainRecord.id));

      return `Domain verified via TXT: ${domain}\nThe domain is now active.`;
    }

    return `DNS verification failed for ${domain}

Expected one of:
- CNAME pointing to the platform domain
- TXT record "_takos-verify.${domain}" with value "${domainRecord.verificationToken}"

Please check your DNS settings and try again.`;
  } catch (error) {
    throw new Error(`DNS lookup failed: ${error}`);
  }
};

export const domainRemoveHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;
  const domain = args.domain as string;
  const { env } = context;

  const db = getDb(context.db);

  const domainRecord = await db.select({ id: serviceCustomDomains.id })
    .from(serviceCustomDomains)
    .where(and(eq(serviceCustomDomains.serviceId, serviceId), eq(serviceCustomDomains.domain, domain.toLowerCase())))
    .get();

  if (!domainRecord) {
    throw new Error(`Domain not found: ${domain}`);
  }

  await db.delete(serviceCustomDomains).where(eq(serviceCustomDomains.id, domainRecord.id));

  await deleteHostnameRouting({ env, hostname: domain.toLowerCase() });

  return `Domain removed: ${domain}`;
};


export const DOMAIN_TOOLS: ToolDefinition[] = [
  DOMAIN_LIST,
  DOMAIN_ADD,
  DOMAIN_VERIFY,
  DOMAIN_REMOVE,
];

export const DOMAIN_HANDLERS: Record<string, ToolHandler> = {
  domain_list: domainListHandler,
  domain_add: domainAddHandler,
  domain_verify: domainVerifyHandler,
  domain_remove: domainRemoveHandler,
};
