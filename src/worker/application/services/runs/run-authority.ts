import {
  and,
  eq,
  exists,
  gte,
  inArray,
  lte,
  max,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import {
  getDb,
  accounts,
  agentResourceTombstones,
  mcpConfirmationRunGrants,
  mcpToolConfirmationIdentities,
  mcpToolConfirmations,
  messages,
  providerMaterializationRevisions,
  runContextRevisions,
  runContextProviderMaterializationRefs,
  runContextResourceRefs,
  runContextToolDescriptorRefs,
  runGrants,
  runs,
  type SqlDatabaseLike,
  threads,
  turnProjectionRevisions,
  toolDescriptorRevisions,
} from "../../../infra/db/index.ts";
import type { AgentConfigEnv } from "../../../shared/types/env.ts";
import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import {
  DEFAULT_AGENT_MAX_GRAPH_STEPS,
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  getAgentConfig,
} from "../agent/runner-config.ts";
import {
  computeAgentProfileRevision,
  computeModelRevision,
  computeRunInputRevision,
  computeSystemPromptRevision,
} from "./run-context-identities.ts";
import { resolveActorPrincipalId } from "../identity/principals.ts";
import {
  resolveAllowedCapabilities,
  STANDARD_CAPABILITY_IDS,
  type StandardCapabilityId,
} from "../platform/capabilities.ts";

const RUN_AUTHORITY_SCHEMA_VERSION = 1 as const;
const RUN_GRANT_ENFORCEMENT_MODE = "enforced" as const;
const RUN_CONTEXT_RECORD_MODE = "shadow" as const;
const CAPABILITY_IDS = new Set<string>(STANDARD_CAPABILITY_IDS);

export type RunExecutionBudgets = {
  maxGraphSteps: number;
  maxToolRounds: number;
};

export type CompiledRunGrant = {
  runId: string;
  principalId: string;
  workspaceId: string;
  parentRunId: string | null;
  parentGrantDigest: string | null;
  confirmationGrantIds: string[];
  enforcementMode: typeof RUN_GRANT_ENFORCEMENT_MODE;
  grantJson: string;
  digest: string;
  createdAt: string;
};

export type CompiledRunContextRevision = {
  runId: string;
  revision: 1;
  parentRevision: null;
  activationEventId: null;
  activationEventKey: null;
  principalId: string;
  workspaceId: string;
  threadId: string;
  transcriptCutSequence: number;
  agentProfileRevision: string;
  modelRevision: string;
  systemPromptRevision: string;
  runGrantDigest: string;
  recordMode: typeof RUN_CONTEXT_RECORD_MODE;
  contextJson: string;
  digest: string;
  createdAt: string;
};

export type BaseRunAuthority = {
  grant: CompiledRunGrant;
  context: CompiledRunContextRevision;
};

export type RunAuthorityAttestation = {
  contextRevision: number;
  contextDigest: string;
  runGrantDigest: string;
};

export type RunExecutionAuthority = {
  runId: string;
  principalId: string;
  workspaceId: string;
  threadId: string;
  capabilities: StandardCapabilityId[];
  confirmationGrantIds: string[];
  budgets: RunExecutionBudgets;
  /** Exact content/resource identities carried by the current revision. */
  resourceReferences?: RunContextResourceReference[];
  /** Absent on legacy contexts created before exact model-input identity. */
  modelInput?: {
    transcriptCutSequence: number;
    parentRunId: string | null;
    agentType: string;
    agentProfileRevision: string;
    modelId: string;
    modelRevision: string;
    systemPromptRevision: string;
    runInputJson: string;
    runInputRevision: string;
  };
  /** Revision 1 remains the one-Run confirmation handoff identity. */
  baseAttestation: RunAuthorityAttestation;
  /** Exact current revision required for model/tool/checkpoint execution. */
  attestation: RunAuthorityAttestation;
};

export type RunContextResourceReference = {
  resourceKind:
    | "explicit_memory"
    | "turn_projection"
    | "skill_revision"
    | "tool_descriptor_revision"
    | "provider_materialization_revision"
    | "artifact";
  resourceId: string;
  resourceDigest: string;
};

export class ParentRunGrantUnavailableError extends Error {
  readonly code = "parent_run_grant_unavailable" as const;

  constructor(message = "Parent Run has no valid delegable RunGrant") {
    super(message);
    this.name = "ParentRunGrantUnavailableError";
  }
}

export class RunContextUnavailableError extends Error {
  readonly code = "run_context_unavailable" as const;

  constructor(message: string) {
    super(message);
    this.name = "RunContextUnavailableError";
  }
}

export class RunExecutionAuthorityUnavailableError extends Error {
  readonly code = "run_execution_authority_unavailable" as const;

  constructor(message = "Run has no valid executable authority revision") {
    super(message);
    this.name = "RunExecutionAuthorityUnavailableError";
  }
}

export class RunContextActivationConflictError
  extends RunExecutionAuthorityUnavailableError {
  readonly conflictCode = "run_context_activation_conflict" as const;

  constructor(message = "RunContext changed during progressive activation") {
    super(message);
    this.name = "RunContextActivationConflictError";
  }
}

function canonicalJson(value: unknown): string {
  const json = stringifyCanonicalJson(value);
  if (json === undefined) {
    throw new TypeError("Run authority snapshot is not JSON serializable");
  }
  return json;
}

async function digestJson(json: string): Promise<string> {
  return `sha256:${await computeSHA256(json)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function parseConfirmationGrantIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 1) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (
      typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(id)
    ) {
      return null;
    }
    ids.push(id);
  }
  const canonical = Array.from(new Set(ids)).sort();
  return canonical.length === ids.length &&
      canonical.every((id, index) => id === ids[index])
    ? canonical
    : null;
}

const RESOURCE_REFERENCE_FIELDS = [
  ["explicitMemories", "explicit_memory"],
  ["turnProjections", "turn_projection"],
  ["skills", "skill_revision"],
  ["toolDescriptors", "tool_descriptor_revision"],
  ["interfaceMaterializations", "provider_materialization_revision"],
  ["artifacts", "artifact"],
] as const;

function resourceReferenceKey(
  reference: RunContextResourceReference,
): string {
  return `${reference.resourceKind}\0${reference.resourceId}`;
}

function compareResourceReferences(
  left: RunContextResourceReference,
  right: RunContextResourceReference,
): number {
  return resourceReferenceKey(left).localeCompare(resourceReferenceKey(right));
}

function parseContextResourceReferences(
  references: Record<string, unknown>,
): RunContextResourceReference[] | null {
  const parsed: RunContextResourceReference[] = [];
  for (const [field, resourceKind] of RESOURCE_REFERENCE_FIELDS) {
    const value = references[field];
    // Tolerate fields introduced after an immutable revision was written.
    // The next progressive activation writes the full current shape; no
    // historical context is synthesized or modified in place.
    if (
      (field === "toolDescriptors" ||
        field === "interfaceMaterializations") && value === undefined
    ) continue;
    if (!Array.isArray(value) || value.length > 100) return null;
    let previousId: string | null = null;
    for (const item of value) {
      if (!isRecord(item)) return null;
      const fields = Object.keys(item).sort();
      if (
        fields.length !== 2 || fields[0] !== "digest" || fields[1] !== "id" ||
        typeof item.id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(item.id) ||
        !isSha256Digest(item.digest)
      ) {
        return null;
      }
      if (previousId !== null && previousId.localeCompare(item.id) >= 0) {
        return null;
      }
      previousId = item.id;
      parsed.push({
        resourceKind,
        resourceId: item.id,
        resourceDigest: item.digest,
      });
    }
  }
  return [...parsed].sort(compareResourceReferences);
}

function contextReferencesFromResources(
  current: Record<string, unknown>,
  resources: readonly RunContextResourceReference[],
): Record<string, unknown> {
  const next = { ...current };
  for (const [field, resourceKind] of RESOURCE_REFERENCE_FIELDS) {
    next[field] = resources
      .filter((reference) => reference.resourceKind === resourceKind)
      .map((reference) => ({
        id: reference.resourceId,
        digest: reference.resourceDigest,
      }));
  }
  return next;
}

function sameResourceReferences(
  left: readonly RunContextResourceReference[],
  right: readonly RunContextResourceReference[],
): boolean {
  return left.length === right.length && left.every((reference, index) =>
    reference.resourceKind === right[index]?.resourceKind &&
    reference.resourceId === right[index]?.resourceId &&
    reference.resourceDigest === right[index]?.resourceDigest
  );
}

export function parseRunAuthorityAttestation(
  value: unknown,
): RunAuthorityAttestation | null {
  if (!isRecord(value)) return null;
  if (
    parsePositiveInteger(value.contextRevision, 1_000_000) === null ||
    !isSha256Digest(value.contextDigest) ||
    !isSha256Digest(value.runGrantDigest)
  ) {
    return null;
  }
  return {
    contextRevision: Number(value.contextRevision),
    contextDigest: value.contextDigest,
    runGrantDigest: value.runGrantDigest,
  };
}

export function runAuthorityAttestationsEqual(
  left: RunAuthorityAttestation,
  right: RunAuthorityAttestation,
): boolean {
  return left.contextRevision === right.contextRevision &&
    left.contextDigest === right.contextDigest &&
    left.runGrantDigest === right.runGrantDigest;
}

function parsePositiveInteger(
  value: unknown,
  maximum: number,
): number | null {
  return Number.isInteger(value) && Number(value) > 0 &&
      Number(value) <= maximum
    ? Number(value)
    : null;
}

async function loadParentGrant(params: {
  db: SqlDatabaseLike;
  parentRunId: string;
  principalId: string;
  workspaceId: string;
}): Promise<{
  digest: string;
  capabilities: StandardCapabilityId[];
  budgets: RunExecutionBudgets;
}> {
  const authority = await loadRunExecutionAuthority({
    db: params.db,
    runId: params.parentRunId,
  }).catch(() => null);
  if (
    !authority || authority.principalId !== params.principalId ||
    authority.workspaceId !== params.workspaceId
  ) {
    throw new ParentRunGrantUnavailableError();
  }
  return {
    digest: authority.attestation.runGrantDigest,
    capabilities: authority.capabilities,
    budgets: authority.budgets,
  };
}

/**
 * Load and cryptographically verify the exact authority accepted with a Run.
 *
 * Legacy Runs without revision 1, shadow-only grants, non-canonical identities,
 * and any row/JSON/digest disagreement fail closed. Live Workspace policy is
 * deliberately not folded in here; the tool setup layer intersects it with
 * this immutable upper bound immediately before catalog or execution.
 */
export async function loadRunExecutionAuthority(params: {
  db: SqlDatabaseLike;
  runId: string;
}): Promise<RunExecutionAuthority> {
  const db = getDb(params.db);
  const run = await db.select({
    accountId: runs.accountId,
    requesterAccountId: runs.requesterAccountId,
    threadId: runs.threadId,
    parentRunId: runs.parentRunId,
    agentType: runs.agentType,
    input: runs.input,
    model: runs.model,
    currentContextRevision: runs.currentContextRevision,
    threadAccountId: threads.accountId,
    threadStatus: threads.status,
    workspaceStatus: accounts.status,
  }).from(runs)
    .innerJoin(threads, eq(threads.id, runs.threadId))
    .innerJoin(accounts, eq(accounts.id, runs.accountId))
    .where(eq(runs.id, params.runId)).get();
  const currentRevision = parsePositiveInteger(
    run?.currentContextRevision,
    1_000_000,
  );
  if (
    !run || currentRevision === null ||
    run.threadAccountId !== run.accountId || run.threadStatus !== "active" ||
    run.workspaceStatus !== "active"
  ) {
    throw new RunExecutionAuthorityUnavailableError();
  }

  const contextSelection = {
    revision: runContextRevisions.revision,
    parentRevision: runContextRevisions.parentRevision,
    activationEventId: runContextRevisions.activationEventId,
    activationEventKey: runContextRevisions.activationEventKey,
    formatVersion: runContextRevisions.formatVersion,
    principalId: runContextRevisions.principalId,
    workspaceId: runContextRevisions.workspaceId,
    threadId: runContextRevisions.threadId,
    transcriptCutSequence: runContextRevisions.transcriptCutSequence,
    agentProfileRevision: runContextRevisions.agentProfileRevision,
    modelRevision: runContextRevisions.modelRevision,
    systemPromptRevision: runContextRevisions.systemPromptRevision,
    runGrantDigest: runContextRevisions.runGrantDigest,
    recordMode: runContextRevisions.recordMode,
    contextJson: runContextRevisions.contextJson,
    digest: runContextRevisions.digest,
    createdAt: runContextRevisions.createdAt,
  };
  const loadContext = (revision: number) =>
    db.select(contextSelection).from(runContextRevisions).where(and(
      eq(runContextRevisions.runId, params.runId),
      eq(runContextRevisions.revision, revision),
    )).get();
  const loadResourceRows = (revision: number) =>
    db.select({
      runId: runContextResourceRefs.runId,
      contextRevision: runContextResourceRefs.contextRevision,
      workspaceId: runContextResourceRefs.workspaceId,
      resourceKind: runContextResourceRefs.resourceKind,
      resourceId: runContextResourceRefs.resourceId,
      resourceDigest: runContextResourceRefs.resourceDigest,
      tombstoneId: agentResourceTombstones.id,
    }).from(runContextResourceRefs).leftJoin(
      agentResourceTombstones,
      and(
        eq(
          agentResourceTombstones.accountId,
          runContextResourceRefs.workspaceId,
        ),
        eq(
          agentResourceTombstones.resourceKind,
          runContextResourceRefs.resourceKind,
        ),
        eq(
          agentResourceTombstones.resourceId,
          runContextResourceRefs.resourceId,
        ),
      ),
    ).where(and(
      eq(runContextResourceRefs.runId, params.runId),
      eq(runContextResourceRefs.contextRevision, revision),
    )).all();
  const loadToolDescriptorRows = (revision: number) =>
    db.select({
      runId: runContextToolDescriptorRefs.runId,
      contextRevision: runContextToolDescriptorRefs.contextRevision,
      workspaceId: runContextToolDescriptorRefs.workspaceId,
      resourceId: runContextToolDescriptorRefs.resourceId,
      resourceDigest: runContextToolDescriptorRefs.resourceDigest,
      descriptorDigest: toolDescriptorRevisions.descriptorDigest,
      descriptorJson: toolDescriptorRevisions.descriptorJson,
    }).from(runContextToolDescriptorRefs).leftJoin(
      toolDescriptorRevisions,
      and(
        eq(
          toolDescriptorRevisions.accountId,
          runContextToolDescriptorRefs.workspaceId,
        ),
        eq(
          toolDescriptorRevisions.resourceId,
          runContextToolDescriptorRefs.resourceId,
        ),
        eq(
          toolDescriptorRevisions.descriptorDigest,
          runContextToolDescriptorRefs.resourceDigest,
        ),
      ),
    ).where(and(
      eq(runContextToolDescriptorRefs.runId, params.runId),
      eq(runContextToolDescriptorRefs.contextRevision, revision),
    )).all();
  const loadProviderMaterializationRows = (revision: number) =>
    db.select({
      runId: runContextProviderMaterializationRefs.runId,
      contextRevision: runContextProviderMaterializationRefs.contextRevision,
      workspaceId: runContextProviderMaterializationRefs.workspaceId,
      resourceId: runContextProviderMaterializationRefs.resourceId,
      resourceDigest: runContextProviderMaterializationRefs.resourceDigest,
      materializationId: providerMaterializationRevisions.id,
      materializationAccountId: providerMaterializationRevisions.accountId,
      materializationRunId: providerMaterializationRevisions.runId,
      materializationResourceId: providerMaterializationRevisions.resourceId,
      materializationDigest:
        providerMaterializationRevisions.materializationDigest,
      materializationJson: providerMaterializationRevisions.materializationJson,
    }).from(runContextProviderMaterializationRefs).leftJoin(
      providerMaterializationRevisions,
      and(
        eq(
          providerMaterializationRevisions.accountId,
          runContextProviderMaterializationRefs.workspaceId,
        ),
        eq(
          providerMaterializationRevisions.resourceId,
          runContextProviderMaterializationRefs.resourceId,
        ),
        eq(
          providerMaterializationRevisions.materializationDigest,
          runContextProviderMaterializationRefs.resourceDigest,
        ),
      ),
    ).where(and(
      eq(runContextProviderMaterializationRefs.runId, params.runId),
      eq(runContextProviderMaterializationRefs.contextRevision, revision),
    )).all();

  const [
    grant,
    context,
    baseContext,
    resourceRows,
    baseResourceRows,
    toolDescriptorRows,
    baseToolDescriptorRows,
    providerMaterializationRows,
    baseProviderMaterializationRows,
    confirmationClaims,
  ] = await Promise.all([
    db.select({
      formatVersion: runGrants.formatVersion,
      principalId: runGrants.principalId,
      workspaceId: runGrants.workspaceId,
      parentRunId: runGrants.parentRunId,
      parentGrantDigest: runGrants.parentGrantDigest,
      enforcementMode: runGrants.enforcementMode,
      grantJson: runGrants.grantJson,
      digest: runGrants.digest,
      createdAt: runGrants.createdAt,
    }).from(runGrants).where(eq(runGrants.runId, params.runId)).get(),
    loadContext(currentRevision),
    loadContext(1),
    loadResourceRows(currentRevision),
    currentRevision === 1 ? Promise.resolve([]) : loadResourceRows(1),
    loadToolDescriptorRows(currentRevision),
    currentRevision === 1
      ? Promise.resolve([])
      : loadToolDescriptorRows(1),
    loadProviderMaterializationRows(currentRevision),
    currentRevision === 1
      ? Promise.resolve([])
      : loadProviderMaterializationRows(1),
    db.select({
      confirmationId: mcpConfirmationRunGrants.confirmationId,
      runId: mcpConfirmationRunGrants.runId,
      principalId: mcpConfirmationRunGrants.principalId,
      workspaceId: mcpConfirmationRunGrants.workspaceId,
      threadId: mcpConfirmationRunGrants.threadId,
      contextRevision: mcpConfirmationRunGrants.runContextRevision,
      contextDigest: mcpConfirmationRunGrants.runContextDigest,
      runGrantDigest: mcpConfirmationRunGrants.runGrantDigest,
      originIdentityHash: mcpConfirmationRunGrants.originIdentityHash,
      identityVersion: mcpToolConfirmationIdentities.identityVersion,
      identityPrincipalId: mcpToolConfirmationIdentities.principalId,
      identityRequestedThreadId:
        mcpToolConfirmationIdentities.requestedThreadId,
      identityHash: mcpToolConfirmationIdentities.identityHash,
      confirmationWorkspaceId: mcpToolConfirmations.accountId,
    }).from(mcpConfirmationRunGrants)
      .innerJoin(
        mcpToolConfirmationIdentities,
        eq(
          mcpToolConfirmationIdentities.confirmationId,
          mcpConfirmationRunGrants.confirmationId,
        ),
      )
      .innerJoin(
        mcpToolConfirmations,
        eq(
          mcpToolConfirmations.id,
          mcpConfirmationRunGrants.confirmationId,
        ),
      )
      .where(eq(mcpConfirmationRunGrants.runId, params.runId))
      .all(),
  ]);

  const unavailable = () => {
    throw new RunExecutionAuthorityUnavailableError();
  };
  if (
    !run.requesterAccountId || !run.model || !grant || !context ||
    !baseContext ||
    grant.formatVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    grant.enforcementMode !== RUN_GRANT_ENFORCEMENT_MODE ||
    context.revision !== currentRevision ||
    (currentRevision === 1
      ? context.parentRevision !== null ||
        context.activationEventId !== null ||
        context.activationEventKey !== null
      : context.parentRevision !== currentRevision - 1 ||
        context.activationEventId !== null ||
        typeof context.activationEventKey !== "string" ||
        !/^[A-Za-z0-9_-]{1,256}$/u.test(context.activationEventKey)) ||
    context.formatVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    context.recordMode !== RUN_CONTEXT_RECORD_MODE ||
    grant.workspaceId !== run.accountId ||
    context.workspaceId !== run.accountId ||
    context.threadId !== run.threadId ||
    grant.parentRunId !== run.parentRunId ||
    context.runGrantDigest !== grant.digest ||
    !isSha256Digest(grant.digest) || !isSha256Digest(context.digest) ||
    !isSha256Digest(context.agentProfileRevision) ||
    !isSha256Digest(context.modelRevision) ||
    !isSha256Digest(context.systemPromptRevision) ||
    await digestJson(grant.grantJson) !== grant.digest ||
    await digestJson(context.contextJson) !== context.digest
  ) {
    return unavailable();
  }

  const principalId = await resolveActorPrincipalId(
    params.db,
    run.requesterAccountId,
  );
  if (
    !principalId || grant.principalId !== principalId ||
    context.principalId !== principalId
  ) {
    return unavailable();
  }

  let decodedGrant: unknown;
  let decodedContext: unknown;
  let decodedBaseContext: unknown;
  try {
    decodedGrant = JSON.parse(grant.grantJson);
    decodedContext = JSON.parse(context.contextJson);
    decodedBaseContext = JSON.parse(baseContext.contextJson);
  } catch {
    return unavailable();
  }
  if (
    !isRecord(decodedGrant) || !isRecord(decodedContext) ||
    !isRecord(decodedBaseContext)
  ) {
    return unavailable();
  }
  const grantEnforcement = decodedGrant.enforcement;
  const grantPolicy = decodedGrant.policy;
  const contextTranscriptCut = decodedContext.transcriptCut;
  const contextModel = decodedContext.model;
  const contextGrant = decodedContext.runGrant;
  const contextRunInput = decodedContext.runInput;
  const contextReferences = decodedContext.references;
  const baseReferences = decodedBaseContext.references;
  const baseRunInput = decodedBaseContext.runInput;
  const confirmationGrantIds = parseConfirmationGrantIds(
    decodedGrant.confirmationGrants,
  );
  const contextConfirmationGrantIds = isRecord(contextReferences)
    ? parseConfirmationGrantIds(contextReferences.toolConfirmations)
    : null;
  const contextResourceReferences = isRecord(contextReferences)
    ? parseContextResourceReferences(contextReferences)
    : null;
  const baseResourceReferences = isRecord(baseReferences)
    ? parseContextResourceReferences(baseReferences)
    : null;
  const normalizedResourceRows = [
    ...resourceRows.map((row) => ({
      resourceKind: row.resourceKind,
      resourceId: row.resourceId,
      resourceDigest: row.resourceDigest,
    })),
    ...toolDescriptorRows.map((row) => ({
      resourceKind: "tool_descriptor_revision" as const,
      resourceId: row.resourceId,
      resourceDigest: row.resourceDigest,
    })),
    ...providerMaterializationRows.map((row) => ({
      resourceKind: "provider_materialization_revision" as const,
      resourceId: row.resourceId,
      resourceDigest: row.resourceDigest,
    })),
  ] as RunContextResourceReference[];
  normalizedResourceRows.sort(compareResourceReferences);
  const turnProjectionReferences = resourceRows.filter((row) =>
    row.resourceKind === "turn_projection"
  );
  const turnProjectionRows = turnProjectionReferences.length === 0
    ? []
    : await db.select({
      id: turnProjectionRevisions.id,
      accountId: turnProjectionRevisions.accountId,
      resourceId: turnProjectionRevisions.resourceId,
      projectionDigest: turnProjectionRevisions.projectionDigest,
      projectionJson: turnProjectionRevisions.projectionJson,
    }).from(turnProjectionRevisions).where(and(
      eq(turnProjectionRevisions.accountId, run.accountId),
      inArray(
        turnProjectionRevisions.resourceId,
        turnProjectionReferences.map((row) => row.resourceId),
      ),
    )).all();
  const turnProjectionRowsByReference = new Map(
    turnProjectionRows.map((row) => [
      `${row.resourceId}\0${row.projectionDigest}`,
      row,
    ]),
  );
  const turnProjectionRowsInvalid =
    turnProjectionRows.length !== turnProjectionReferences.length ||
    (
      await Promise.all(turnProjectionReferences.map(async (reference) => {
        const row = turnProjectionRowsByReference.get(
          `${reference.resourceId}\0${reference.resourceDigest}`,
        );
        return !row || row.id !== row.resourceId ||
          row.accountId !== run.accountId ||
          await digestJson(row.projectionJson) !== reference.resourceDigest;
      }))
    ).some(Boolean);
  const toolDescriptorRowsInvalid = (
    await Promise.all(toolDescriptorRows.map(async (row) =>
      row.runId !== params.runId ||
      row.contextRevision !== currentRevision ||
      row.workspaceId !== run.accountId ||
      row.descriptorDigest !== row.resourceDigest ||
      typeof row.descriptorJson !== "string" ||
      await digestJson(row.descriptorJson) !== row.resourceDigest
    ))
  ).some(Boolean);
  const providerMaterializationRowsInvalid =
    providerMaterializationRows.length > 1 ||
    (
      await Promise.all(providerMaterializationRows.map(async (row) =>
        row.runId !== params.runId ||
        row.contextRevision !== currentRevision ||
        row.workspaceId !== run.accountId ||
        row.materializationId !== row.resourceId ||
        row.materializationAccountId !== run.accountId ||
        row.materializationRunId !== params.runId ||
        row.materializationResourceId !== row.resourceId ||
        row.materializationDigest !== row.resourceDigest ||
        typeof row.materializationJson !== "string" ||
        await digestJson(row.materializationJson) !== row.resourceDigest
      ))
    ).some(Boolean);
  if (
    decodedGrant.schemaVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    decodedGrant.runId !== params.runId ||
    decodedGrant.principalId !== principalId ||
    decodedGrant.workspaceId !== run.accountId ||
    decodedGrant.parentRunId !== run.parentRunId ||
    decodedGrant.parentGrantDigest !== grant.parentGrantDigest ||
    decodedGrant.createdAt !== grant.createdAt ||
    !Array.isArray(decodedGrant.capabilities) ||
    confirmationGrantIds === null ||
    !isRecord(grantEnforcement) ||
    grantEnforcement.runtimeMode !== RUN_GRANT_ENFORCEMENT_MODE ||
    grantEnforcement.childCreationRequiresParentGrant !== true ||
    grantEnforcement.livePolicyRevalidationRequired !== true ||
    !isRecord(grantPolicy) ||
    (grantPolicy.securityPosture !== "standard" &&
      grantPolicy.securityPosture !== "restricted_egress") ||
    decodedContext.schemaVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    decodedContext.recordMode !== RUN_CONTEXT_RECORD_MODE ||
    decodedContext.runId !== params.runId ||
    decodedContext.revision !== currentRevision ||
    decodedContext.principalId !== principalId ||
    decodedContext.workspaceId !== run.accountId ||
    decodedContext.threadId !== run.threadId ||
    decodedContext.agentProfileRevision !== context.agentProfileRevision ||
    decodedContext.systemPromptRevision !== context.systemPromptRevision ||
    decodedContext.createdAt !== context.createdAt ||
    !isRecord(contextTranscriptCut) ||
    contextTranscriptCut.maxSequence !== context.transcriptCutSequence ||
    !isRecord(contextModel) || contextModel.id !== run.model ||
    contextModel.revision !== context.modelRevision ||
    !isRecord(contextGrant) || contextGrant.digest !== grant.digest ||
    (currentRevision === 1
      ? decodedContext.parentRevision !== undefined ||
        decodedContext.activation !== undefined
      : decodedContext.parentRevision !== context.parentRevision ||
        !isRecord(decodedContext.activation) ||
        decodedContext.activation.kind !== "resource_reference" ||
        decodedContext.activation.eventKey !== context.activationEventKey ||
        decodedContext.activation.parentRevision !== context.parentRevision) ||
    contextConfirmationGrantIds === null ||
    contextConfirmationGrantIds.length !== confirmationGrantIds.length ||
    contextConfirmationGrantIds.some((id, index) =>
      id !== confirmationGrantIds[index]
    ) ||
    contextResourceReferences === null ||
    !sameResourceReferences(
      contextResourceReferences,
      normalizedResourceRows,
    ) ||
    resourceRows.some((row) =>
      row.runId !== params.runId ||
      row.contextRevision !== currentRevision ||
      row.workspaceId !== run.accountId ||
      row.tombstoneId !== null
    ) ||
    toolDescriptorRowsInvalid || providerMaterializationRowsInvalid ||
    turnProjectionRowsInvalid ||
    baseContext.revision !== 1 || baseContext.parentRevision !== null ||
    baseContext.activationEventId !== null ||
    baseContext.activationEventKey !== null ||
    baseContext.formatVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    baseContext.principalId !== principalId ||
    baseContext.workspaceId !== run.accountId ||
    baseContext.threadId !== run.threadId ||
    baseContext.runGrantDigest !== grant.digest ||
    baseContext.recordMode !== RUN_CONTEXT_RECORD_MODE ||
    !isSha256Digest(baseContext.digest) ||
    await digestJson(baseContext.contextJson) !== baseContext.digest ||
    decodedBaseContext.schemaVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    decodedBaseContext.recordMode !== RUN_CONTEXT_RECORD_MODE ||
    decodedBaseContext.runId !== params.runId ||
    decodedBaseContext.revision !== 1 ||
    decodedBaseContext.principalId !== principalId ||
    decodedBaseContext.workspaceId !== run.accountId ||
    decodedBaseContext.threadId !== run.threadId ||
    !isRecord(decodedBaseContext.runGrant) ||
    decodedBaseContext.runGrant.digest !== grant.digest ||
    baseResourceReferences === null || baseResourceReferences.length !== 0 ||
    baseResourceRows.length !== 0 || baseToolDescriptorRows.length !== 0 ||
    baseProviderMaterializationRows.length !== 0
  ) {
    return unavailable();
  }

  if (await computeModelRevision(run.model) !== context.modelRevision) {
    return unavailable();
  }

  let verifiedRunInputJson: string | null = null;
  let verifiedRunInputRevision: string | null = null;
  if (contextRunInput !== undefined || baseRunInput !== undefined) {
    if (
      !isRecord(contextRunInput) || !isRecord(baseRunInput) ||
      !isSha256Digest(contextRunInput.revision) ||
      contextRunInput.revision !== baseRunInput.revision ||
      await computeRunInputRevision(run.input) !== contextRunInput.revision
    ) {
      return unavailable();
    }
    verifiedRunInputJson = run.input;
    verifiedRunInputRevision = contextRunInput.revision;
  }

  const capabilities: StandardCapabilityId[] = [];
  for (const capability of decodedGrant.capabilities) {
    if (typeof capability !== "string" || !CAPABILITY_IDS.has(capability)) {
      return unavailable();
    }
    capabilities.push(capability as StandardCapabilityId);
  }
  const canonicalCapabilities = Array.from(new Set(capabilities)).sort();
  if (
    canonicalCapabilities.length !== capabilities.length ||
    canonicalCapabilities.some((capability, index) =>
      capability !== capabilities[index]
    )
  ) {
    return unavailable();
  }

  if (confirmationClaims.length !== confirmationGrantIds.length) {
    return unavailable();
  }
  const claimsById = new Map(
    confirmationClaims.map((claim) => [claim.confirmationId, claim]),
  );
  for (const confirmationId of confirmationGrantIds) {
    const claim = claimsById.get(confirmationId);
    if (
      !claim || claim.runId !== params.runId ||
      claim.principalId !== principalId ||
      claim.workspaceId !== run.accountId || claim.threadId !== run.threadId ||
      claim.contextRevision !== 1 ||
      claim.contextDigest !== baseContext.digest ||
      claim.runGrantDigest !== grant.digest ||
      claim.identityVersion !== 1 ||
      claim.identityPrincipalId !== principalId ||
      claim.identityRequestedThreadId !== run.threadId ||
      claim.originIdentityHash !== claim.identityHash ||
      claim.confirmationWorkspaceId !== run.accountId
    ) {
      return unavailable();
    }
  }

  const rawGrantBudgets = decodedGrant.budgets;
  const rawContextBudgets = decodedContext.budgets;
  if (!isRecord(rawGrantBudgets) || !isRecord(rawContextBudgets)) {
    return unavailable();
  }
  const maxGraphSteps = parsePositiveInteger(
    rawGrantBudgets.maxGraphSteps,
    128,
  );
  const maxToolRounds = parsePositiveInteger(rawGrantBudgets.maxToolRounds, 16);
  if (
    maxGraphSteps === null || maxToolRounds === null ||
    rawContextBudgets.maxGraphSteps !== maxGraphSteps ||
    rawContextBudgets.maxToolRounds !== maxToolRounds
  ) {
    return unavailable();
  }

  return {
    runId: params.runId,
    principalId,
    workspaceId: run.accountId,
    threadId: run.threadId,
    capabilities: canonicalCapabilities,
    confirmationGrantIds,
    budgets: { maxGraphSteps, maxToolRounds },
    resourceReferences: normalizedResourceRows,
    ...(verifiedRunInputJson !== null && verifiedRunInputRevision !== null
      ? {
        modelInput: {
          transcriptCutSequence: context.transcriptCutSequence,
          parentRunId: run.parentRunId,
          agentType: run.agentType,
          agentProfileRevision: context.agentProfileRevision,
          modelId: run.model,
          modelRevision: context.modelRevision,
          systemPromptRevision: context.systemPromptRevision,
          runInputJson: verifiedRunInputJson,
          runInputRevision: verifiedRunInputRevision,
        },
      }
      : {}),
    baseAttestation: {
      contextRevision: 1,
      contextDigest: baseContext.digest,
      runGrantDigest: grant.digest,
    },
    attestation: {
      contextRevision: currentRevision,
      contextDigest: context.digest,
      runGrantDigest: grant.digest,
    },
  };
}

/**
 * Verify that an attestation names one exact immutable revision on the
 * current RunContext lineage.
 *
 * A durable engine checkpoint may legitimately lag the Run pointer by one or
 * more progressive activations when the container crashes after a tool result
 * was committed but before the next loop checkpoint was saved. The checkpoint
 * therefore binds to its historical revision while execution resumes with the
 * separately verified current authority. We accept only a bounded, contiguous
 * ancestor chain with the same RunGrant and re-verify the historical row,
 * canonical JSON, resource references, and tombstones before exposing state.
 */
export async function verifyRunContextAttestation(params: {
  db: SqlDatabaseLike;
  runId: string;
  expected: RunAuthorityAttestation;
  currentAuthority?: RunExecutionAuthority;
}): Promise<RunExecutionAuthority> {
  const authority = params.currentAuthority ??
    await loadRunExecutionAuthority({ db: params.db, runId: params.runId });
  if (
    params.expected.runGrantDigest !== authority.attestation.runGrantDigest ||
    params.expected.contextRevision > authority.attestation.contextRevision ||
    authority.attestation.contextRevision - params.expected.contextRevision >
      authority.budgets.maxGraphSteps
  ) {
    throw new RunExecutionAuthorityUnavailableError(
      "Checkpoint RunContext is not on the active Run lineage",
    );
  }
  if (
    params.expected.contextRevision === authority.attestation.contextRevision
  ) {
    if (
      !runAuthorityAttestationsEqual(
        params.expected,
        authority.attestation,
      )
    ) {
      throw new RunExecutionAuthorityUnavailableError(
        "Checkpoint RunContext digest does not match the active revision",
      );
    }
    return authority;
  }
  const db = getDb(params.db);
  const lineage = await db.select({
    revision: runContextRevisions.revision,
    parentRevision: runContextRevisions.parentRevision,
    runGrantDigest: runContextRevisions.runGrantDigest,
  }).from(runContextRevisions).where(and(
    eq(runContextRevisions.runId, params.runId),
    gte(
      runContextRevisions.revision,
      params.expected.contextRevision,
    ),
    lte(
      runContextRevisions.revision,
      authority.attestation.contextRevision,
    ),
  )).orderBy(runContextRevisions.revision).all();
  const expectedLineageLength =
    authority.attestation.contextRevision -
    params.expected.contextRevision + 1;
  if (
    lineage.length !== expectedLineageLength ||
    lineage.some((revision, index) => {
      const expectedRevision = params.expected.contextRevision + index;
      return revision.revision !== expectedRevision ||
        revision.runGrantDigest !== params.expected.runGrantDigest ||
        (index === 0
          ? revision.parentRevision !==
            (expectedRevision === 1 ? null : expectedRevision - 1)
          : revision.parentRevision !== expectedRevision - 1);
    })
  ) {
    throw new RunExecutionAuthorityUnavailableError(
      "Checkpoint RunContext lineage is not contiguous",
    );
  }
  if (params.expected.contextRevision === 1) {
    if (
      !runAuthorityAttestationsEqual(params.expected, authority.baseAttestation)
    ) {
      throw new RunExecutionAuthorityUnavailableError(
        "Checkpoint RunContext digest does not match the base revision",
      );
    }
    return authority;
  }

  const [
    context,
    resourceRows,
    toolDescriptorRows,
    providerMaterializationRows,
  ] = await Promise.all([
    db.select({
      revision: runContextRevisions.revision,
      parentRevision: runContextRevisions.parentRevision,
      activationEventId: runContextRevisions.activationEventId,
      activationEventKey: runContextRevisions.activationEventKey,
      formatVersion: runContextRevisions.formatVersion,
      principalId: runContextRevisions.principalId,
      workspaceId: runContextRevisions.workspaceId,
      threadId: runContextRevisions.threadId,
      transcriptCutSequence: runContextRevisions.transcriptCutSequence,
      agentProfileRevision: runContextRevisions.agentProfileRevision,
      modelRevision: runContextRevisions.modelRevision,
      systemPromptRevision: runContextRevisions.systemPromptRevision,
      runGrantDigest: runContextRevisions.runGrantDigest,
      recordMode: runContextRevisions.recordMode,
      contextJson: runContextRevisions.contextJson,
      digest: runContextRevisions.digest,
      createdAt: runContextRevisions.createdAt,
    }).from(runContextRevisions).where(and(
      eq(runContextRevisions.runId, params.runId),
      eq(
        runContextRevisions.revision,
        params.expected.contextRevision,
      ),
    )).get(),
    db.select({
      runId: runContextResourceRefs.runId,
      contextRevision: runContextResourceRefs.contextRevision,
      workspaceId: runContextResourceRefs.workspaceId,
      resourceKind: runContextResourceRefs.resourceKind,
      resourceId: runContextResourceRefs.resourceId,
      resourceDigest: runContextResourceRefs.resourceDigest,
      tombstoneId: agentResourceTombstones.id,
    }).from(runContextResourceRefs).leftJoin(
      agentResourceTombstones,
      and(
        eq(
          agentResourceTombstones.accountId,
          runContextResourceRefs.workspaceId,
        ),
        eq(
          agentResourceTombstones.resourceKind,
          runContextResourceRefs.resourceKind,
        ),
        eq(
          agentResourceTombstones.resourceId,
          runContextResourceRefs.resourceId,
        ),
      ),
    ).where(and(
      eq(runContextResourceRefs.runId, params.runId),
      eq(
        runContextResourceRefs.contextRevision,
        params.expected.contextRevision,
      ),
    )).all(),
    db.select({
      runId: runContextToolDescriptorRefs.runId,
      contextRevision: runContextToolDescriptorRefs.contextRevision,
      workspaceId: runContextToolDescriptorRefs.workspaceId,
      resourceId: runContextToolDescriptorRefs.resourceId,
      resourceDigest: runContextToolDescriptorRefs.resourceDigest,
      descriptorDigest: toolDescriptorRevisions.descriptorDigest,
      descriptorJson: toolDescriptorRevisions.descriptorJson,
    }).from(runContextToolDescriptorRefs).leftJoin(
      toolDescriptorRevisions,
      and(
        eq(
          toolDescriptorRevisions.accountId,
          runContextToolDescriptorRefs.workspaceId,
        ),
        eq(
          toolDescriptorRevisions.resourceId,
          runContextToolDescriptorRefs.resourceId,
        ),
        eq(
          toolDescriptorRevisions.descriptorDigest,
          runContextToolDescriptorRefs.resourceDigest,
        ),
      ),
    ).where(and(
      eq(runContextToolDescriptorRefs.runId, params.runId),
      eq(
        runContextToolDescriptorRefs.contextRevision,
        params.expected.contextRevision,
      ),
    )).all(),
    db.select({
      runId: runContextProviderMaterializationRefs.runId,
      contextRevision: runContextProviderMaterializationRefs.contextRevision,
      workspaceId: runContextProviderMaterializationRefs.workspaceId,
      resourceId: runContextProviderMaterializationRefs.resourceId,
      resourceDigest: runContextProviderMaterializationRefs.resourceDigest,
      materializationId: providerMaterializationRevisions.id,
      materializationAccountId: providerMaterializationRevisions.accountId,
      materializationRunId: providerMaterializationRevisions.runId,
      materializationResourceId: providerMaterializationRevisions.resourceId,
      materializationDigest:
        providerMaterializationRevisions.materializationDigest,
      materializationJson: providerMaterializationRevisions.materializationJson,
    }).from(runContextProviderMaterializationRefs).leftJoin(
      providerMaterializationRevisions,
      and(
        eq(
          providerMaterializationRevisions.accountId,
          runContextProviderMaterializationRefs.workspaceId,
        ),
        eq(
          providerMaterializationRevisions.resourceId,
          runContextProviderMaterializationRefs.resourceId,
        ),
        eq(
          providerMaterializationRevisions.materializationDigest,
          runContextProviderMaterializationRefs.resourceDigest,
        ),
      ),
    ).where(and(
      eq(runContextProviderMaterializationRefs.runId, params.runId),
      eq(
        runContextProviderMaterializationRefs.contextRevision,
        params.expected.contextRevision,
      ),
    )).all(),
  ]);
  if (
    !context || context.revision !== params.expected.contextRevision ||
    context.digest !== params.expected.contextDigest ||
    context.runGrantDigest !== params.expected.runGrantDigest ||
    context.formatVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    context.recordMode !== RUN_CONTEXT_RECORD_MODE ||
    context.principalId !== authority.principalId ||
    context.workspaceId !== authority.workspaceId ||
    context.threadId !== authority.threadId ||
    !isSha256Digest(context.agentProfileRevision) ||
    !isSha256Digest(context.modelRevision) ||
    !isSha256Digest(context.systemPromptRevision) ||
    await digestJson(context.contextJson) !== context.digest
  ) {
    throw new RunExecutionAuthorityUnavailableError(
      "Checkpoint RunContext revision is invalid",
    );
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(context.contextJson);
  } catch {
    throw new RunExecutionAuthorityUnavailableError(
      "Checkpoint RunContext is not valid JSON",
    );
  }
  if (!isRecord(decoded) || !isRecord(decoded.references)) {
    throw new RunExecutionAuthorityUnavailableError(
      "Checkpoint RunContext snapshot is invalid",
    );
  }
  const references = parseContextResourceReferences(decoded.references);
  const confirmationGrantIds = parseConfirmationGrantIds(
    decoded.references.toolConfirmations,
  );
  const normalizedResourceRows = [
    ...resourceRows.map((row) => ({
      resourceKind: row.resourceKind,
      resourceId: row.resourceId,
      resourceDigest: row.resourceDigest,
    })),
    ...toolDescriptorRows.map((row) => ({
      resourceKind: "tool_descriptor_revision" as const,
      resourceId: row.resourceId,
      resourceDigest: row.resourceDigest,
    })),
    ...providerMaterializationRows.map((row) => ({
      resourceKind: "provider_materialization_revision" as const,
      resourceId: row.resourceId,
      resourceDigest: row.resourceDigest,
    })),
  ] as RunContextResourceReference[];
  normalizedResourceRows.sort(compareResourceReferences);
  const turnProjectionReferences = resourceRows.filter((row) =>
    row.resourceKind === "turn_projection"
  );
  const turnProjectionRows = turnProjectionReferences.length === 0
    ? []
    : await db.select({
      id: turnProjectionRevisions.id,
      accountId: turnProjectionRevisions.accountId,
      resourceId: turnProjectionRevisions.resourceId,
      projectionDigest: turnProjectionRevisions.projectionDigest,
      projectionJson: turnProjectionRevisions.projectionJson,
    }).from(turnProjectionRevisions).where(and(
      eq(turnProjectionRevisions.accountId, authority.workspaceId),
      inArray(
        turnProjectionRevisions.resourceId,
        turnProjectionReferences.map((row) => row.resourceId),
      ),
    )).all();
  const turnProjectionRowsByReference = new Map(
    turnProjectionRows.map((row) => [
      `${row.resourceId}\0${row.projectionDigest}`,
      row,
    ]),
  );
  const turnProjectionRowsInvalid =
    turnProjectionRows.length !== turnProjectionReferences.length ||
    (
      await Promise.all(turnProjectionReferences.map(async (reference) => {
        const row = turnProjectionRowsByReference.get(
          `${reference.resourceId}\0${reference.resourceDigest}`,
        );
        return !row || row.id !== row.resourceId ||
          row.accountId !== authority.workspaceId ||
          await digestJson(row.projectionJson) !== reference.resourceDigest;
      }))
    ).some(Boolean);
  const toolDescriptorRowsInvalid = (
    await Promise.all(toolDescriptorRows.map(async (row) =>
      row.runId !== params.runId ||
      row.contextRevision !== params.expected.contextRevision ||
      row.workspaceId !== authority.workspaceId ||
      row.descriptorDigest !== row.resourceDigest ||
      typeof row.descriptorJson !== "string" ||
      await digestJson(row.descriptorJson) !== row.resourceDigest
    ))
  ).some(Boolean);
  const providerMaterializationRowsInvalid =
    providerMaterializationRows.length > 1 ||
    (
      await Promise.all(providerMaterializationRows.map(async (row) =>
        row.runId !== params.runId ||
        row.contextRevision !== params.expected.contextRevision ||
        row.workspaceId !== authority.workspaceId ||
        row.materializationId !== row.resourceId ||
        row.materializationAccountId !== authority.workspaceId ||
        row.materializationRunId !== params.runId ||
        row.materializationResourceId !== row.resourceId ||
        row.materializationDigest !== row.resourceDigest ||
        typeof row.materializationJson !== "string" ||
        await digestJson(row.materializationJson) !== row.resourceDigest
      ))
    ).some(Boolean);
  const expectedParent = params.expected.contextRevision - 1;
  if (
    decoded.schemaVersion !== RUN_AUTHORITY_SCHEMA_VERSION ||
    decoded.recordMode !== RUN_CONTEXT_RECORD_MODE ||
    decoded.runId !== params.runId ||
    decoded.revision !== params.expected.contextRevision ||
    decoded.parentRevision !== expectedParent ||
    decoded.principalId !== authority.principalId ||
    decoded.workspaceId !== authority.workspaceId ||
    decoded.threadId !== authority.threadId ||
    decoded.agentProfileRevision !== context.agentProfileRevision ||
    decoded.systemPromptRevision !== context.systemPromptRevision ||
    decoded.createdAt !== context.createdAt ||
    !isRecord(decoded.transcriptCut) ||
    decoded.transcriptCut.maxSequence !== context.transcriptCutSequence ||
    !isRecord(decoded.model) ||
    decoded.model.revision !== context.modelRevision ||
    !isRecord(decoded.runGrant) ||
    decoded.runGrant.digest !== params.expected.runGrantDigest ||
    !isRecord(decoded.activation) ||
    decoded.activation.kind !== "resource_reference" ||
    decoded.activation.eventKey !== context.activationEventKey ||
    decoded.activation.parentRevision !== expectedParent ||
    context.parentRevision !== expectedParent ||
    context.activationEventId !== null ||
    typeof context.activationEventKey !== "string" ||
    references === null ||
    !sameResourceReferences(references, normalizedResourceRows) ||
    resourceRows.some((row) =>
      row.runId !== params.runId ||
      row.contextRevision !== params.expected.contextRevision ||
      row.workspaceId !== authority.workspaceId ||
      row.tombstoneId !== null
    ) ||
    toolDescriptorRowsInvalid || providerMaterializationRowsInvalid ||
    turnProjectionRowsInvalid ||
    confirmationGrantIds === null ||
    confirmationGrantIds.length !== authority.confirmationGrantIds.length ||
    confirmationGrantIds.some((id, index) =>
      id !== authority.confirmationGrantIds[index]
    ) ||
    !isRecord(decoded.budgets) ||
    decoded.budgets.maxGraphSteps !== authority.budgets.maxGraphSteps ||
    decoded.budgets.maxToolRounds !== authority.budgets.maxToolRounds
  ) {
    throw new RunExecutionAuthorityUnavailableError(
      "Checkpoint RunContext snapshot does not match its immutable record",
    );
  }
  return authority;
}

export async function runContextActivationEventKey(
  activationEventId: string,
): Promise<string> {
  if (
    !activationEventId || activationEventId.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(activationEventId)
  ) {
    throw new TypeError("Invalid RunContext activation event identity");
  }
  return `event_${await computeSHA256(activationEventId)}`;
}

/**
 * Append one immutable resource-reference revision with a Run pointer CAS.
 *
 * The activation key is derived from a Worker-authenticated event identity, so
 * a retry after response loss returns the existing winner. Competing events do
 * not fork a revision: one pointer update wins and every loser must resolve
 * again from that winner before exposing source content.
 */
export async function appendRunContextResourceReferences(params: {
  db: SqlDatabaseLike;
  runId: string;
  expectedAttestation: RunAuthorityAttestation;
  activationEventId: string;
  references: readonly RunContextResourceReference[];
}): Promise<RunExecutionAuthority> {
  const requested = [...params.references].sort(compareResourceReferences);
  if (
    requested.length === 0 || requested.length > 100 ||
    requested.some((reference, index) =>
      !RESOURCE_REFERENCE_FIELDS.some(([, kind]) =>
        kind === reference.resourceKind
      ) ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(reference.resourceId) ||
      !isSha256Digest(reference.resourceDigest) ||
      (index > 0 && resourceReferenceKey(requested[index - 1]) ===
        resourceReferenceKey(reference))
    )
  ) {
    throw new RunExecutionAuthorityUnavailableError(
      "RunContext resource references are invalid",
    );
  }

  const activationEventKey = await runContextActivationEventKey(
    params.activationEventId,
  );
  const authority = await loadRunExecutionAuthority({
    db: params.db,
    runId: params.runId,
  });
  if (
    authority.attestation.runGrantDigest !==
      params.expectedAttestation.runGrantDigest
  ) {
    throw new RunContextActivationConflictError();
  }

  const db = getDb(params.db);
  const current = await db.select({
    revision: runContextRevisions.revision,
    parentRevision: runContextRevisions.parentRevision,
    activationEventKey: runContextRevisions.activationEventKey,
    principalId: runContextRevisions.principalId,
    workspaceId: runContextRevisions.workspaceId,
    threadId: runContextRevisions.threadId,
    transcriptCutSequence: runContextRevisions.transcriptCutSequence,
    agentProfileRevision: runContextRevisions.agentProfileRevision,
    modelRevision: runContextRevisions.modelRevision,
    systemPromptRevision: runContextRevisions.systemPromptRevision,
    runGrantDigest: runContextRevisions.runGrantDigest,
    recordMode: runContextRevisions.recordMode,
    contextJson: runContextRevisions.contextJson,
    digest: runContextRevisions.digest,
  }).from(runContextRevisions).where(and(
    eq(runContextRevisions.runId, params.runId),
    eq(
      runContextRevisions.revision,
      authority.attestation.contextRevision,
    ),
  )).get();
  if (!current) throw new RunExecutionAuthorityUnavailableError();

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(current.contextJson);
  } catch {
    throw new RunExecutionAuthorityUnavailableError();
  }
  if (!isRecord(snapshot) || !isRecord(snapshot.references)) {
    throw new RunExecutionAuthorityUnavailableError();
  }
  const existing = parseContextResourceReferences(snapshot.references);
  if (existing === null) throw new RunExecutionAuthorityUnavailableError();

  const byKey = new Map(existing.map((reference) => [
    resourceReferenceKey(reference),
    reference,
  ]));
  for (const reference of requested) {
    const prior = byKey.get(resourceReferenceKey(reference));
    if (prior && prior.resourceDigest !== reference.resourceDigest) {
      throw new RunContextActivationConflictError(
        "RunContext cannot replace a pinned resource revision",
      );
    }
    byKey.set(resourceReferenceKey(reference), reference);
  }
  const merged = Array.from(byKey.values()).sort(compareResourceReferences);
  const requestedAlreadyPinned = requested.every((reference) => {
    const prior = existing.find((candidate) =>
      resourceReferenceKey(candidate) === resourceReferenceKey(reference)
    );
    return prior?.resourceDigest === reference.resourceDigest;
  });
  if (requestedAlreadyPinned) {
    if (
      runAuthorityAttestationsEqual(
        authority.attestation,
        params.expectedAttestation,
      ) ||
      (
        authority.attestation.contextRevision ===
          params.expectedAttestation.contextRevision + 1 &&
        current.parentRevision === params.expectedAttestation.contextRevision &&
        current.activationEventKey === activationEventKey
      )
    ) {
      return authority;
    }
    throw new RunContextActivationConflictError(
      "RunContext activation identity does not match the pinned revision",
    );
  }

  if (
    !runAuthorityAttestationsEqual(
      authority.attestation,
      params.expectedAttestation,
    )
  ) {
    throw new RunContextActivationConflictError(
      "RunContext changed before resource references were pinned",
    );
  }
  const nextRevision = current.revision + 1;
  if (!Number.isSafeInteger(nextRevision) || nextRevision > 1_000_000) {
    throw new RunExecutionAuthorityUnavailableError();
  }
  const createdAt = new Date().toISOString();
  const nextSnapshot = {
    ...snapshot,
    revision: nextRevision,
    parentRevision: current.revision,
    activation: {
      kind: "resource_reference",
      eventKey: activationEventKey,
      parentRevision: current.revision,
    },
    references: contextReferencesFromResources(snapshot.references, merged),
    createdAt,
  };
  const contextJson = canonicalJson(nextSnapshot);
  const digest = await digestJson(contextJson);
  const tombstonePredicates = requested
    .filter((reference) =>
      reference.resourceKind !== "tool_descriptor_revision" &&
      reference.resourceKind !== "provider_materialization_revision"
    )
    .map((reference) => and(
    eq(agentResourceTombstones.accountId, current.workspaceId),
    eq(agentResourceTombstones.resourceKind, reference.resourceKind),
    eq(agentResourceTombstones.resourceId, reference.resourceId),
  ));
  const sourceStillActive = tombstonePredicates.length === 0
    ? sql<boolean>`1 = 1`
    : tombstonePredicates.length === 1
    ? notExists(
      db.select({ id: agentResourceTombstones.id })
        .from(agentResourceTombstones)
        .where(tombstonePredicates[0]),
    )
    : notExists(
      db.select({ id: agentResourceTombstones.id })
        .from(agentResourceTombstones)
        .where(or(...tombstonePredicates)),
    );
  const contextInsert = db.insert(runContextRevisions).select(
    db.select({
      runId: sql<string>`${params.runId}`.as("run_id"),
      revision: sql<number>`${nextRevision}`.as("revision"),
      parentRevision: sql<number>`${current.revision}`.as("parent_revision"),
      activationEventId: sql<number | null>`NULL`.as("activation_event_id"),
      activationEventKey: sql<string>`${activationEventKey}`.as(
        "activation_event_key",
      ),
      formatVersion: sql<number>`1`.as("format_version"),
      principalId: sql<string>`${current.principalId}`.as("principal_id"),
      workspaceId: sql<string>`${current.workspaceId}`.as("workspace_id"),
      threadId: sql<string>`${current.threadId}`.as("thread_id"),
      transcriptCutSequence: sql<number>`${current.transcriptCutSequence}`.as(
        "transcript_cut_sequence",
      ),
      agentProfileRevision: sql<string>`${current.agentProfileRevision}`.as(
        "agent_profile_revision",
      ),
      modelRevision: sql<string>`${current.modelRevision}`.as("model_revision"),
      systemPromptRevision: sql<string>`${current.systemPromptRevision}`.as(
        "system_prompt_revision",
      ),
      runGrantDigest: sql<string>`${current.runGrantDigest}`.as(
        "run_grant_digest",
      ),
      recordMode: sql<string>`${current.recordMode}`.as("record_mode"),
      contextJson: sql<string>`${contextJson}`.as("context_json"),
      digest: sql<string>`${digest}`.as("digest"),
      createdAt: sql<string>`${createdAt}`.as("created_at"),
    }).from(runs).where(and(
      eq(runs.id, params.runId),
      eq(runs.status, "running"),
      eq(runs.currentContextRevision, current.revision),
      sourceStillActive,
    )),
  ).onConflictDoNothing();
  const candidateExists = exists(
    db.select({ runId: runContextRevisions.runId })
      .from(runContextRevisions)
      .where(and(
        eq(runContextRevisions.runId, params.runId),
        eq(runContextRevisions.revision, nextRevision),
        eq(runContextRevisions.digest, digest),
        eq(runContextRevisions.activationEventKey, activationEventKey),
      )),
  );
  const ordinaryReferenceInserts = merged
    .filter((reference) =>
      reference.resourceKind !== "tool_descriptor_revision" &&
      reference.resourceKind !== "provider_materialization_revision"
    )
    .map((reference) =>
    db.insert(runContextResourceRefs).select(
      db.select({
        runId: runContextRevisions.runId,
        contextRevision: runContextRevisions.revision,
        workspaceId: sql<string>`${current.workspaceId}`.as("workspace_id"),
        resourceKind: sql<string>`${reference.resourceKind}`.as(
          "resource_kind",
        ),
        resourceId: sql<string>`${reference.resourceId}`.as("resource_id"),
        resourceDigest: sql<string>`${reference.resourceDigest}`.as(
          "resource_digest",
        ),
        createdAt: sql<string>`${createdAt}`.as("created_at"),
      }).from(runContextRevisions).where(and(
        eq(runContextRevisions.runId, params.runId),
        eq(runContextRevisions.revision, nextRevision),
        eq(runContextRevisions.digest, digest),
        eq(runContextRevisions.activationEventKey, activationEventKey),
      )),
    ).onConflictDoNothing()
  );
  const toolDescriptorReferenceInserts = merged
    .filter((reference) =>
      reference.resourceKind === "tool_descriptor_revision"
    )
    .map((reference) =>
      db.insert(runContextToolDescriptorRefs).select(
        db.select({
          runId: runContextRevisions.runId,
          contextRevision: runContextRevisions.revision,
          workspaceId: sql<string>`${current.workspaceId}`.as("workspace_id"),
          resourceId: sql<string>`${reference.resourceId}`.as("resource_id"),
          resourceDigest: sql<string>`${reference.resourceDigest}`.as(
            "resource_digest",
          ),
          createdAt: sql<string>`${createdAt}`.as("created_at"),
        }).from(runContextRevisions).where(and(
          eq(runContextRevisions.runId, params.runId),
          eq(runContextRevisions.revision, nextRevision),
          eq(runContextRevisions.digest, digest),
          eq(runContextRevisions.activationEventKey, activationEventKey),
        )),
      ).onConflictDoNothing()
    );
  const providerMaterializationReferenceInserts = merged
    .filter((reference) =>
      reference.resourceKind === "provider_materialization_revision"
    )
    .map((reference) =>
      db.insert(runContextProviderMaterializationRefs).select(
        db.select({
          runId: runContextRevisions.runId,
          contextRevision: runContextRevisions.revision,
          workspaceId: sql<string>`${current.workspaceId}`.as("workspace_id"),
          resourceId: sql<string>`${reference.resourceId}`.as("resource_id"),
          resourceDigest: sql<string>`${reference.resourceDigest}`.as(
            "resource_digest",
          ),
          createdAt: sql<string>`${createdAt}`.as("created_at"),
        }).from(runContextRevisions).where(and(
          eq(runContextRevisions.runId, params.runId),
          eq(runContextRevisions.revision, nextRevision),
          eq(runContextRevisions.digest, digest),
          eq(runContextRevisions.activationEventKey, activationEventKey),
        )),
      ).onConflictDoNothing()
    );
  const pointerUpdate = db.update(runs).set({
    currentContextRevision: nextRevision,
  }).where(and(
    eq(runs.id, params.runId),
    eq(runs.status, "running"),
    eq(runs.currentContextRevision, current.revision),
    candidateExists,
  ));
  await db.batch([
    contextInsert,
    ...ordinaryReferenceInserts,
    ...toolDescriptorReferenceInserts,
    ...providerMaterializationReferenceInserts,
    pointerUpdate,
  ]);

  const winner = await loadRunExecutionAuthority({
    db: params.db,
    runId: params.runId,
  });
  const winnerContext = await db.select({
    activationEventKey: runContextRevisions.activationEventKey,
  }).from(runContextRevisions).where(and(
    eq(runContextRevisions.runId, params.runId),
    eq(
      runContextRevisions.revision,
      winner.attestation.contextRevision,
    ),
  )).get();
  if (
    winnerContext?.activationEventKey !== activationEventKey ||
    winner.attestation.contextRevision !== nextRevision
  ) {
    throw new RunContextActivationConflictError(
      "A competing RunContext activation won",
    );
  }
  return winner;
}

async function loadTranscriptCut(params: {
  db: SqlDatabaseLike;
  workspaceId: string;
  threadId: string;
}): Promise<number> {
  const db = getDb(params.db);
  const thread = await db.select({
    accountId: threads.accountId,
    status: threads.status,
  }).from(threads).where(eq(threads.id, params.threadId)).get();
  if (
    !thread || thread.accountId !== params.workspaceId ||
    thread.status !== "active"
  ) {
    throw new RunContextUnavailableError(
      "Run context requires an active Thread in the requested Workspace",
    );
  }

  const row = await db.select({ sequence: max(messages.sequence) })
    .from(messages)
    .where(eq(messages.threadId, params.threadId))
    .get();
  const sequence = Number(row?.sequence ?? -1);
  if (!Number.isSafeInteger(sequence) || sequence < -1) {
    throw new RunContextUnavailableError("Invalid Thread transcript cut");
  }
  return sequence;
}

/**
 * Compile the immutable revision-1 identity for a newly accepted Run.
 *
 * The record is intentionally shadow-only until the container consumes exact
 * revisions. It contains only allowlisted identity, policy, digest, reference,
 * and budget data: Run input, prompt text, credentials, env values, message
 * content, and tool results are never serialized into either snapshot.
 */
export async function compileBaseRunAuthority(params: {
  db: SqlDatabaseLike;
  env: AgentConfigEnv;
  runId: string;
  threadId: string;
  workspaceId: string;
  requesterAccountId: string;
  parentRunId: string | null;
  agentType: string;
  model: string;
  runInputJson: string;
  createdAt: string;
  confirmationGrantIds?: readonly string[];
}): Promise<BaseRunAuthority> {
  const principalId = await resolveActorPrincipalId(
    params.db,
    params.requesterAccountId,
  );
  if (!principalId) {
    throw new RunContextUnavailableError("Run principal is not active");
  }

  const [{ ctx, allowed }, transcriptCutSequence] = await Promise.all([
    resolveAllowedCapabilities({
      db: params.db,
      spaceId: params.workspaceId,
      userId: params.requesterAccountId,
    }),
    loadTranscriptCut({
      db: params.db,
      workspaceId: params.workspaceId,
      threadId: params.threadId,
    }),
  ]);

  const config = getAgentConfig(params.agentType, params.env);
  const localBudgets: RunExecutionBudgets = {
    maxGraphSteps: config.maxGraphSteps ?? DEFAULT_AGENT_MAX_GRAPH_STEPS,
    maxToolRounds: config.maxToolRounds ?? DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  };
  let capabilities = Array.from(allowed).sort();
  let budgets = localBudgets;
  let parentGrantDigest: string | null = null;
  const confirmationGrantIds = parseConfirmationGrantIds(
    params.confirmationGrantIds ?? [],
  );
  if (confirmationGrantIds === null) {
    throw new RunContextUnavailableError(
      "Run may claim at most one valid MCP confirmation grant",
    );
  }

  if (params.parentRunId) {
    const parent = await loadParentGrant({
      db: params.db,
      parentRunId: params.parentRunId,
      principalId,
      workspaceId: params.workspaceId,
    });
    const parentCapabilities = new Set(parent.capabilities);
    capabilities = capabilities.filter((capability) =>
      parentCapabilities.has(capability)
    );
    budgets = {
      maxGraphSteps: Math.min(
        localBudgets.maxGraphSteps,
        parent.budgets.maxGraphSteps,
      ),
      maxToolRounds: Math.min(
        localBudgets.maxToolRounds,
        parent.budgets.maxToolRounds,
      ),
    };
    parentGrantDigest = parent.digest;
  }

  const grantSnapshot = {
    schemaVersion: RUN_AUTHORITY_SCHEMA_VERSION,
    runId: params.runId,
    principalId,
    workspaceId: params.workspaceId,
    parentRunId: params.parentRunId,
    parentGrantDigest,
    capabilities,
    confirmationGrants: confirmationGrantIds,
    budgets,
    policy: {
      securityPosture: ctx.securityPosture,
    },
    enforcement: {
      runtimeMode: RUN_GRANT_ENFORCEMENT_MODE,
      childCreationRequiresParentGrant: true,
      livePolicyRevalidationRequired: true,
    },
    createdAt: params.createdAt,
  };
  const grantJson = canonicalJson(grantSnapshot);
  const grantDigest = await digestJson(grantJson);

  const systemPromptRevision = await computeSystemPromptRevision(
    config.systemPrompt,
  );
  const agentProfileRevision = await computeAgentProfileRevision({
    agentType: config.type,
    systemPromptRevision,
    temperature: config.temperature,
    budgets,
  });
  const modelRevision = await computeModelRevision(params.model);
  const runInputRevision = await computeRunInputRevision(params.runInputJson);
  const contextSnapshot = {
    schemaVersion: RUN_AUTHORITY_SCHEMA_VERSION,
    recordMode: RUN_CONTEXT_RECORD_MODE,
    runId: params.runId,
    revision: 1,
    principalId,
    workspaceId: params.workspaceId,
    threadId: params.threadId,
    transcriptCut: {
      maxSequence: transcriptCutSequence,
    },
    agentProfileRevision,
    model: {
      id: params.model,
      revision: modelRevision,
    },
    systemPromptRevision,
    runInput: {
      revision: runInputRevision,
    },
    references: {
      explicitMemories: [],
      turnProjections: [],
      skills: [],
      artifacts: [],
      toolDescriptors: [],
      interfaceMaterializations: [],
      toolConfirmations: confirmationGrantIds,
    },
    runGrant: {
      digest: grantDigest,
    },
    budgets,
    compatibility: {
      liveSourcesUntilCutover: [
        "conversation",
        "memory",
        "skills",
        "tools",
        "provider_credentials",
      ],
    },
    createdAt: params.createdAt,
  };
  const contextJson = canonicalJson(contextSnapshot);

  return {
    grant: {
      runId: params.runId,
      principalId,
      workspaceId: params.workspaceId,
      parentRunId: params.parentRunId,
      parentGrantDigest,
      confirmationGrantIds,
      enforcementMode: RUN_GRANT_ENFORCEMENT_MODE,
      grantJson,
      digest: grantDigest,
      createdAt: params.createdAt,
    },
    context: {
      runId: params.runId,
      revision: 1,
      parentRevision: null,
      activationEventId: null,
      activationEventKey: null,
      principalId,
      workspaceId: params.workspaceId,
      threadId: params.threadId,
      transcriptCutSequence,
      agentProfileRevision,
      modelRevision,
      systemPromptRevision,
      runGrantDigest: grantDigest,
      recordMode: RUN_CONTEXT_RECORD_MODE,
      contextJson,
      digest: await digestJson(contextJson),
      createdAt: params.createdAt,
    },
  };
}
