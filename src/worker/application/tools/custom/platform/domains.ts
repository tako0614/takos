import type { ToolDefinition, ToolHandler } from "../../tool-definitions.ts";
import {
  addCustomDomain,
  deleteCustomDomain,
  listCustomDomains,
  verifyCustomDomain,
} from "../../../services/platform/custom-domains.ts";
import { getDb, services } from "../../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";

type ListedCustomDomain = Awaited<ReturnType<typeof listCustomDomains>>[
  "domains"
][number];

/**
 * SECURITY (tenant binding): the underlying custom-domain service authorizes by
 * the user's membership of the SERVICE's own account, ignoring the active space.
 * Without this guard an agent run scoped to space A could manage custom domains
 * on a service that lives in space B (a confused deputy / cross-space write,
 * including tearing down space B's live routing). Bind every custom-domain tool
 * to the run's current space, mirroring the sibling platform tools
 * (ensureServiceInWorkspace / resolveWorkerRef).
 */
async function assertServiceInSpace(
  serviceId: string,
  context: Parameters<ToolHandler>[1],
): Promise<void> {
  const db = getDb(context.db);
  const owned = await db.select({ id: services.id })
    .from(services)
    .where(and(
      eq(services.id, serviceId),
      eq(services.accountId, context.spaceId),
    ))
    .get();
  if (!owned) {
    throw new Error(`Service not found: ${serviceId}`);
  }
}

function findDomainByName(
  domains: ListedCustomDomain[],
  domain: string,
): ListedCustomDomain | undefined {
  const normalized = domain.trim().toLowerCase();
  return domains.find((entry) => entry.domain === normalized);
}

function formatDnsInstruction(prefix: string, instruction: {
  type: string;
  name: string;
  value: string;
  description: string;
}): string {
  return [
    `${prefix}:`,
    `  Type: ${instruction.type}`,
    `  Name: ${instruction.name}`,
    `  Value: ${instruction.value}`,
    `  ${instruction.description}`,
  ].join("\n");
}

export const DOMAIN_LIST: ToolDefinition = {
  name: "domain_list",
  description: "List custom domains for a service",
  category: "deploy",
  namespace: "deploy",
  family: "deploy.domains",
  risk_level: "none",
  side_effects: false,
  tool_class: "space_mapped",
  operation_id: "custom_domain.list",
  parameters: {
    type: "object",
    properties: {
      service_id: {
        type: "string",
        description: "Service ID",
      },
    },
    required: ["service_id"],
  },
};

export const DOMAIN_ADD: ToolDefinition = {
  name: "domain_add",
  description:
    "Add a custom domain to a service. Returns DNS records to configure.",
  category: "deploy",
  namespace: "deploy",
  family: "deploy.domains",
  risk_level: "medium",
  side_effects: true,
  tool_class: "space_mapped",
  operation_id: "custom_domain.add",
  parameters: {
    type: "object",
    properties: {
      service_id: {
        type: "string",
        description: "Service ID",
      },
      domain: {
        type: "string",
        description: "Domain name (e.g., myapp.example.com)",
      },
    },
    required: ["service_id", "domain"],
  },
};

export const DOMAIN_VERIFY: ToolDefinition = {
  name: "domain_verify",
  description: "Verify DNS configuration for a custom domain",
  category: "deploy",
  namespace: "deploy",
  family: "deploy.domains",
  risk_level: "low",
  side_effects: true,
  tool_class: "space_mapped",
  operation_id: "custom_domain.verify",
  parameters: {
    type: "object",
    properties: {
      service_id: {
        type: "string",
        description: "Service ID",
      },
      domain: {
        type: "string",
        description: "Domain name to verify",
      },
    },
    required: ["service_id", "domain"],
  },
};

export const DOMAIN_REMOVE: ToolDefinition = {
  name: "domain_remove",
  description: "Remove a custom domain from a service",
  category: "deploy",
  namespace: "deploy",
  family: "deploy.domains",
  risk_level: "medium",
  side_effects: true,
  tool_class: "space_mapped",
  operation_id: "custom_domain.delete",
  parameters: {
    type: "object",
    properties: {
      service_id: {
        type: "string",
        description: "Service ID",
      },
      domain: {
        type: "string",
        description: "Domain name to remove",
      },
    },
    required: ["service_id", "domain"],
  },
};

export const domainListHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;
  await assertServiceInSpace(serviceId, context);

  const { domains } = await listCustomDomains(
    context.env,
    serviceId,
    context.userId,
  );

  if (domains.length === 0) {
    return `No custom domains configured for service: ${serviceId}`;
  }

  const lines = domains.map((d) => {
    const statusIcon = d.status === "active"
      ? "✅"
      : d.status === "pending"
      ? "⏳"
      : "❌";
    return `${statusIcon} ${d.domain} (${d.status})`;
  });

  return `Custom domains:\n${lines.join("\n")}`;
};

export const domainAddHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;
  const domain = args.domain as string;
  await assertServiceInSpace(serviceId, context);
  const result = await addCustomDomain(context.env, serviceId, context.userId, {
    domain,
    verification_method: "cname",
  });
  const { body } = result;

  return [
    `Domain added: ${body.domain}`,
    "",
    "Configure these DNS records before verification:",
    "",
    formatDnsInstruction("Route target", body.instructions.step1),
    "",
    formatDnsInstruction("Ownership verification", body.instructions.step2),
    "",
    "After adding DNS records, use domain_verify to complete setup.",
  ].join("\n");
};

export const domainVerifyHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;
  const domain = args.domain as string;
  await assertServiceInSpace(serviceId, context);

  const { domains } = await listCustomDomains(
    context.env,
    serviceId,
    context.userId,
  );
  const domainRecord = findDomainByName(domains, domain);
  if (!domainRecord) {
    throw new Error(`Domain not found: ${domain}`);
  }

  const result = await verifyCustomDomain(
    context.env,
    serviceId,
    context.userId,
    domainRecord.id,
  );
  const body = result.body;
  if ("error" in body) {
    throw new Error(body.error);
  }

  return [
    `Domain verification result: ${domainRecord.domain}`,
    `Status: ${body.status}`,
    `Message: ${body.message}`,
    `DNS verified: ${body.dns_verified ?? body.verified ?? false}`,
    `SSL verified: ${body.ssl_verified ?? false}`,
    body.ssl_status ? `SSL status: ${body.ssl_status}` : undefined,
  ].filter((line): line is string => !!line).join("\n");
};

export const domainRemoveHandler: ToolHandler = async (args, context) => {
  const serviceId = args.service_id as string;
  const domain = args.domain as string;
  await assertServiceInSpace(serviceId, context);

  const { domains } = await listCustomDomains(
    context.env,
    serviceId,
    context.userId,
  );
  const domainRecord = findDomainByName(domains, domain);
  if (!domainRecord) {
    throw new Error(`Domain not found: ${domain}`);
  }

  await deleteCustomDomain(
    context.env,
    serviceId,
    context.userId,
    domainRecord.id,
  );

  return `Domain removed: ${domainRecord.domain}`;
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
