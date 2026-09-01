import { and, eq, inArray } from "drizzle-orm";

import {
  getDb,
  toolDescriptorRevisions,
  type SqlDatabaseLike,
} from "../../infra/db/index.ts";
import { stringifyCanonicalJson } from "../../shared/utils/canonical-json.ts";
import { computeSHA256 } from "../../shared/utils/hash.ts";
import {
  appendRunContextResourceReferences,
  RunContextActivationConflictError,
  RunExecutionAuthorityUnavailableError,
  type RunContextResourceReference,
  type RunExecutionAuthority,
} from "../services/runs/run-authority.ts";
import type { ToolDefinition } from "./tool-definitions.ts";

const TOOL_DESCRIPTOR_SCHEMA_VERSION = 1 as const;
export const NATIVE_TOOL_ADAPTER_REVISION = "takos@0.12.1";
export const MAX_PINNED_TOOL_DESCRIPTORS_PER_RUN = 32;
export const MAX_TOOL_DESCRIPTOR_BYTES = 64 * 1024;

const MODEL_VISIBLE_TOOL_NAMES = [
  "toolbox",
  "web_fetch",
  "chat_attachment_read",
  "create_artifact",
  "remember",
  "recall",
  "set_reminder",
  "spawn_agent",
  "wait_agent",
  "store_search",
] as const;

type ToolDescriptorSource = "native" | "mcp";

export interface ToolDescriptorSnapshot {
  schemaVersion: typeof TOOL_DESCRIPTOR_SCHEMA_VERSION;
  kind: "tool_descriptor_revision";
  workspaceId: string;
  resourceId: string;
  logicalName: string;
  source: ToolDescriptorSource;
  adapter: {
    reference: string;
    revision: string;
  };
  schemaDigest: string;
  definition: ToolDefinition;
}

export interface ActivatedToolDescriptor {
  revisionId: string;
  reference: RunContextResourceReference;
  snapshot: ToolDescriptorSnapshot;
}

export class ToolDescriptorRevisionUnavailableError
  extends RunExecutionAuthorityUnavailableError {
  readonly code = "tool_descriptor_revision_invalid" as const;

  constructor(message = "Pinned tool descriptor revision is unavailable") {
    super(message);
    this.name = "ToolDescriptorRevisionUnavailableError";
  }
}

/**
 * Worker-owned provider catalog selection. The complete catalog remains
 * available behind `toolbox`; only these bounded direct contracts enter the
 * model request and therefore must be pinned before the catalog is returned.
 */
export function selectModelVisibleTools(
  tools: readonly ToolDefinition[],
): ToolDefinition[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const toolbox = byName.get("toolbox");
  if (!toolbox) {
    throw new ToolDescriptorRevisionUnavailableError(
      "The Worker-owned toolbox broker is unavailable",
    );
  }
  return MODEL_VISIBLE_TOOL_NAMES.flatMap((name) => {
    const tool = byName.get(name);
    return tool ? [tool] : [];
  });
}

function canonicalJson(value: unknown): string {
  const result = stringifyCanonicalJson(value);
  if (result === undefined) {
    throw new TypeError("Tool descriptor is not JSON serializable");
  }
  return result;
}

async function digest(value: string): Promise<string> {
  return `sha256:${await computeSHA256(value)}`;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    new TextEncoder().encode(value).byteLength <= 512 &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}

function canonicalDefinition(tool: ToolDefinition): ToolDefinition {
  if (
    !/^[A-Za-z0-9_-]{1,64}$/u.test(tool.name) ||
    typeof tool.description !== "string" ||
    tool.risk_level === undefined ||
    tool.side_effects === undefined ||
    !tool.parameters || tool.parameters.type !== "object" ||
    typeof tool.parameters.properties !== "object" ||
    tool.parameters.properties === null
  ) {
    throw new TypeError("Tool definition is missing immutable contract metadata");
  }
  const requiredCapabilities = tool.required_capabilities
    ? [...new Set(tool.required_capabilities)].sort()
    : undefined;
  const composedOperations = tool.composed_operations
    ? [...new Set(tool.composed_operations)].sort()
    : undefined;
  return {
    name: tool.name,
    description: tool.description,
    category: tool.category,
    ...(tool.tool_class ? { tool_class: tool.tool_class } : {}),
    ...(tool.operation_id ? { operation_id: tool.operation_id } : {}),
    ...(composedOperations ? { composed_operations: composedOperations } : {}),
    ...(tool.sensitive_read_policy
      ? { sensitive_read_policy: tool.sensitive_read_policy }
      : {}),
    ...(requiredCapabilities
      ? { required_capabilities: requiredCapabilities }
      : {}),
    ...(tool.canonical_name ? { canonical_name: tool.canonical_name } : {}),
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
    ...(tool.family ? { family: tool.family } : {}),
    risk_level: tool.risk_level,
    side_effects: tool.side_effects,
    ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
    parameters: tool.parameters,
  };
}

function adapterIdentity(tool: ToolDefinition): {
  source: ToolDescriptorSource;
  reference: string;
  revision: string;
} {
  if (tool.adapter_identity) {
    if (
      tool.adapter_identity.source !== "mcp" ||
      !isBoundedIdentity(tool.adapter_identity.reference) ||
      !isDigest(tool.adapter_identity.revision)
    ) {
      throw new TypeError("Tool adapter identity is invalid");
    }
    return { ...tool.adapter_identity };
  }
  const reference = `native:${tool.canonical_name ?? tool.name}`;
  if (!isBoundedIdentity(reference)) {
    throw new TypeError("Native tool adapter identity is invalid");
  }
  return {
    source: "native",
    reference,
    revision: NATIVE_TOOL_ADAPTER_REVISION,
  };
}

export async function toolDescriptorSnapshot(
  workspaceId: string,
  tool: ToolDefinition,
): Promise<ToolDescriptorSnapshot> {
  if (!isBoundedIdentity(workspaceId)) {
    throw new TypeError("Tool descriptor Workspace identity is invalid");
  }
  const definition = canonicalDefinition(tool);
  const adapter = adapterIdentity(tool);
  const resourceId = `tooldescriptor_${await computeSHA256(canonicalJson({
    source: adapter.source,
    reference: adapter.reference,
  }))}`;
  return {
    schemaVersion: TOOL_DESCRIPTOR_SCHEMA_VERSION,
    kind: "tool_descriptor_revision",
    workspaceId,
    resourceId,
    logicalName: definition.name,
    source: adapter.source,
    adapter: {
      reference: adapter.reference,
      revision: adapter.revision,
    },
    schemaDigest: await digest(canonicalJson(definition.parameters)),
    definition,
  };
}

async function prepareDescriptor(
  workspaceId: string,
  tool: ToolDefinition,
): Promise<ActivatedToolDescriptor & { descriptorJson: string }> {
  const snapshot = await toolDescriptorSnapshot(workspaceId, tool);
  const descriptorJson = canonicalJson(snapshot);
  if (new TextEncoder().encode(descriptorJson).byteLength > MAX_TOOL_DESCRIPTOR_BYTES) {
    throw new TypeError("Tool descriptor exceeds the immutable snapshot limit");
  }
  const descriptorDigest = await digest(descriptorJson);
  const revisionId = `tooldescriptorrev_${await computeSHA256(canonicalJson({
    workspaceId,
    resourceId: snapshot.resourceId,
    descriptorDigest,
  }))}`;
  return {
    revisionId,
    descriptorJson,
    reference: {
      resourceKind: "tool_descriptor_revision",
      resourceId: snapshot.resourceId,
      resourceDigest: descriptorDigest,
    },
    snapshot,
  };
}

function parseSnapshot(value: unknown): ToolDescriptorSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Partial<ToolDescriptorSnapshot>;
  if (
    snapshot.schemaVersion !== TOOL_DESCRIPTOR_SCHEMA_VERSION ||
    snapshot.kind !== "tool_descriptor_revision" ||
    !isBoundedIdentity(snapshot.workspaceId) ||
    typeof snapshot.resourceId !== "string" ||
    !/^tooldescriptor_[a-f0-9]{64}$/u.test(snapshot.resourceId) ||
    typeof snapshot.logicalName !== "string" ||
    (snapshot.source !== "native" && snapshot.source !== "mcp") ||
    !snapshot.adapter ||
    !isBoundedIdentity(snapshot.adapter.reference) ||
    !isBoundedIdentity(snapshot.adapter.revision) ||
    !isDigest(snapshot.schemaDigest) ||
    !snapshot.definition ||
    snapshot.definition.name !== snapshot.logicalName
  ) {
    return null;
  }
  try {
    canonicalDefinition(snapshot.definition);
  } catch {
    return null;
  }
  return snapshot as ToolDescriptorSnapshot;
}

async function loadPinnedDescriptors(params: {
  db: SqlDatabaseLike;
  authority: RunExecutionAuthority;
}): Promise<ActivatedToolDescriptor[]> {
  const references = (params.authority.resourceReferences ?? []).filter(
    (reference) => reference.resourceKind === "tool_descriptor_revision",
  );
  if (references.length === 0) return [];
  if (references.length > MAX_PINNED_TOOL_DESCRIPTORS_PER_RUN) {
    throw new ToolDescriptorRevisionUnavailableError(
      "Run exceeds the pinned tool descriptor limit",
    );
  }
  const db = getDb(params.db);
  const rows = await db.select({
    id: toolDescriptorRevisions.id,
    accountId: toolDescriptorRevisions.accountId,
    resourceId: toolDescriptorRevisions.resourceId,
    logicalName: toolDescriptorRevisions.logicalName,
    source: toolDescriptorRevisions.source,
    adapterReference: toolDescriptorRevisions.adapterReference,
    adapterRevision: toolDescriptorRevisions.adapterRevision,
    schemaDigest: toolDescriptorRevisions.schemaDigest,
    descriptorDigest: toolDescriptorRevisions.descriptorDigest,
    descriptorJson: toolDescriptorRevisions.descriptorJson,
  }).from(toolDescriptorRevisions).where(and(
    eq(toolDescriptorRevisions.accountId, params.authority.workspaceId),
    inArray(
      toolDescriptorRevisions.resourceId,
      references.map((reference) => reference.resourceId),
    ),
  )).all();
  const results: ActivatedToolDescriptor[] = [];
  for (const reference of references) {
    const matches = rows.filter((row) =>
      row.resourceId === reference.resourceId &&
      row.descriptorDigest === reference.resourceDigest
    );
    const row = matches[0];
    let decoded: unknown;
    try {
      decoded = row ? JSON.parse(row.descriptorJson) : null;
    } catch {
      decoded = null;
    }
    const snapshot = parseSnapshot(decoded);
    if (
      matches.length !== 1 || !row || !snapshot ||
      row.accountId !== params.authority.workspaceId ||
      row.logicalName !== snapshot.logicalName ||
      row.source !== snapshot.source ||
      row.adapterReference !== snapshot.adapter.reference ||
      row.adapterRevision !== snapshot.adapter.revision ||
      row.schemaDigest !== snapshot.schemaDigest ||
      row.descriptorDigest !== reference.resourceDigest ||
      row.resourceId !== snapshot.resourceId ||
      await digest(row.descriptorJson) !== row.descriptorDigest ||
      await digest(canonicalJson(snapshot.definition.parameters)) !==
        snapshot.schemaDigest
    ) {
      throw new ToolDescriptorRevisionUnavailableError();
    }
    results.push({
      revisionId: row.id,
      reference,
      snapshot,
    });
  }
  const names = new Set<string>();
  if (results.some((descriptor) => {
    if (names.has(descriptor.snapshot.logicalName)) return true;
    names.add(descriptor.snapshot.logicalName);
    return false;
  })) {
    throw new ToolDescriptorRevisionUnavailableError(
      "Run pins multiple descriptors for one logical tool name",
    );
  }
  return results;
}

export async function activateToolDescriptors(params: {
  db: SqlDatabaseLike;
  authority: RunExecutionAuthority;
  activationEventId: string;
  tools: readonly ToolDefinition[];
}): Promise<{
  authority: RunExecutionAuthority;
  descriptors: ActivatedToolDescriptor[];
}> {
  if (params.tools.length === 0 || params.tools.length > 20) {
    throw new TypeError("Tool descriptor activation count is invalid");
  }
  const prepared = await Promise.all(params.tools.map((tool) =>
    prepareDescriptor(params.authority.workspaceId, tool)
  ));
  const candidateNames = new Set<string>();
  const candidateResources = new Set<string>();
  for (const descriptor of prepared) {
    if (
      candidateNames.has(descriptor.snapshot.logicalName) ||
      candidateResources.has(descriptor.reference.resourceId)
    ) {
      throw new TypeError("Tool descriptor activation contains duplicates");
    }
    candidateNames.add(descriptor.snapshot.logicalName);
    candidateResources.add(descriptor.reference.resourceId);
  }
  const existing = await loadPinnedDescriptors(params);
  if (existing.length + prepared.length > MAX_PINNED_TOOL_DESCRIPTORS_PER_RUN) {
    const alreadyPinned = new Set(existing.map((entry) => entry.snapshot.logicalName));
    const netNew = prepared.filter((entry) =>
      !alreadyPinned.has(entry.snapshot.logicalName)
    ).length;
    if (existing.length + netNew > MAX_PINNED_TOOL_DESCRIPTORS_PER_RUN) {
      throw new ToolDescriptorRevisionUnavailableError(
        "Run exceeds the pinned tool descriptor limit",
      );
    }
  }
  const existingByName = new Map(existing.map((entry) => [
    entry.snapshot.logicalName,
    entry,
  ]));
  for (const descriptor of prepared) {
    const prior = existingByName.get(descriptor.snapshot.logicalName);
    if (
      prior &&
      (prior.reference.resourceId !== descriptor.reference.resourceId ||
        prior.reference.resourceDigest !== descriptor.reference.resourceDigest)
    ) {
      throw new RunContextActivationConflictError(
        `Tool descriptor for ${descriptor.snapshot.logicalName} changed during the Run`,
      );
    }
  }

  const db = getDb(params.db);
  const createdAt = new Date().toISOString();
  await db.batch(prepared.map((descriptor) =>
    db.insert(toolDescriptorRevisions).values({
      id: descriptor.revisionId,
      accountId: params.authority.workspaceId,
      resourceId: descriptor.reference.resourceId,
      logicalName: descriptor.snapshot.logicalName,
      source: descriptor.snapshot.source,
      adapterReference: descriptor.snapshot.adapter.reference,
      adapterRevision: descriptor.snapshot.adapter.revision,
      schemaDigest: descriptor.snapshot.schemaDigest,
      descriptorDigest: descriptor.reference.resourceDigest,
      descriptorJson: descriptor.descriptorJson,
      createdAt,
    }).onConflictDoNothing()
  ));

  const authority = await appendRunContextResourceReferences({
    db: params.db,
    runId: params.authority.runId,
    expectedAttestation: params.authority.attestation,
    activationEventId: params.activationEventId,
    references: prepared.map((descriptor) => descriptor.reference),
  });
  const pinned = await loadPinnedDescriptors({ db: params.db, authority });
  const pinnedByName = new Map(pinned.map((entry) => [
    entry.snapshot.logicalName,
    entry,
  ]));
  const descriptors = prepared.map((descriptor) =>
    pinnedByName.get(descriptor.snapshot.logicalName)
  );
  if (descriptors.some((descriptor) => descriptor === undefined)) {
    throw new ToolDescriptorRevisionUnavailableError(
      "Activated tool descriptor is missing from the winning RunContext",
    );
  }
  return {
    authority,
    descriptors: descriptors.filter(
      (descriptor): descriptor is ActivatedToolDescriptor =>
        descriptor !== undefined,
    ),
  };
}

export async function assertPinnedToolDescriptorForExecution(params: {
  db: SqlDatabaseLike;
  authority: RunExecutionAuthority;
  tool: ToolDefinition;
}): Promise<ActivatedToolDescriptor> {
  const live = await prepareDescriptor(
    params.authority.workspaceId,
    params.tool,
  );
  const pinned = (await loadPinnedDescriptors(params)).find((descriptor) =>
    descriptor.snapshot.logicalName === params.tool.name
  );
  if (
    !pinned ||
    pinned.reference.resourceId !== live.reference.resourceId ||
    pinned.reference.resourceDigest !== live.reference.resourceDigest
  ) {
    throw new ToolDescriptorRevisionUnavailableError(
      `Tool descriptor for ${params.tool.name} is not pinned or has drifted`,
    );
  }
  return pinned;
}
