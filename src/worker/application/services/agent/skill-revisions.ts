import { and, desc, eq, inArray, sql } from "drizzle-orm";

import {
  agentResourceTombstones,
  getDb,
  runSkillPlanRevisions,
  runs,
  skillResourceRevisions,
  skillRevisions,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import { stringifyCanonicalJson } from "../../../shared/utils/canonical-json.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import type {
  RunContextResourceReference,
  RunExecutionAuthority,
} from "../runs/run-authority.ts";
import {
  appendRunContextResourceReferences,
  RunContextActivationConflictError,
} from "../runs/run-authority.ts";
import type {
  SkillAvailabilityStatus,
  SkillContext,
} from "./skill-resolution.ts";
import { getSkillTemplateResource } from "./skill-templates.ts";

const SKILL_REVISION_SCHEMA_VERSION = 1;
const SKILL_PLAN_SCHEMA_VERSION = 1;
const INITIAL_SKILL_PLAN_REVISION = 1;
const MAX_SKILLS_PER_PLAN = 8;
const MAX_RESOURCES_PER_SKILL = 8;
const MAX_RESOURCES_PER_PLAN = MAX_SKILLS_PER_PLAN * MAX_RESOURCES_PER_SKILL;
const MAX_SKILL_RESOURCE_BYTES = 16 * 1024;
const MAX_REVISION_JSON_BYTES = 64 * 1024;
const SKILL_SOURCES = new Set(["managed", "custom"]);
const SKILL_CATEGORIES = new Set([
  "research",
  "writing",
  "planning",
  "slides",
  "software",
  "custom",
]);
const DURABLE_OUTPUT_HINTS = new Set([
  "artifact",
  "reminder",
  "repo",
  "app",
  "workspace_file",
]);
const SKILL_OUTPUT_MODES = new Set(["chat", ...DURABLE_OUTPUT_HINTS]);
const SKILL_AVAILABILITY = new Set<SkillAvailabilityStatus>([
  "available",
  "warning",
  "unavailable",
]);

export type SkillResourceManifestEntry = {
  id: string;
  title: string;
  description: string;
  mediaType: "text/markdown";
  byteSize: number;
  digest: string;
};

type StoredSkillResourceManifestEntry = SkillResourceManifestEntry & {
  resourceId: string;
};

type SkillRevisionSnapshotV1 = {
  schemaVersion: 1;
  kind: "skill_revision";
  workspaceId: string;
  resourceId: string;
  source: "managed" | "custom";
  skillId: string;
  name: string;
  description: string;
  instructions: string;
  triggers: string[];
  category: SkillContext["category"] | null;
  locale: SkillContext["locale"] | null;
  version: string | null;
  activationTags: string[];
  executionContract: SkillContext["execution_contract"];
  availability: SkillAvailabilityStatus;
  availabilityReasons: string[];
  priority: number | null;
};

type SkillRevisionSnapshot = SkillRevisionSnapshotV1 & {
  resourceManifest: StoredSkillResourceManifestEntry[];
};

type ParsedSkillRevisionSnapshot = SkillRevisionSnapshotV1 | SkillRevisionSnapshot;

type SkillPlanEntry = {
  revisionId: string;
  resourceId: string;
  resourceDigest: string;
};

type SkillPlanSnapshot = {
  schemaVersion: typeof SKILL_PLAN_SCHEMA_VERSION;
  kind: "skill_plan_revision";
  runId: string;
  revision: 1;
  workspaceId: string;
  resourceId: string;
  skillLocale: "ja" | "en";
  skills: SkillPlanEntry[];
};

type PreparedSkillRevision = {
  id: string;
  accountId: string;
  resourceId: string;
  source: "managed" | "custom";
  skillId: string;
  contentDigest: string;
  contentJson: string;
  snapshot: SkillRevisionSnapshot;
  resources: PreparedSkillResourceRevision[];
};

type PreparedSkillResourceRevision = {
  id: string;
  accountId: string;
  skillRevisionId: string;
  resourceId: string;
  resourceKey: string;
  mediaType: "text/markdown";
  contentDigest: string;
  contentBytes: number;
  contentText: string;
};

export type PinnedSkillResource = {
  manifest: SkillResourceManifestEntry;
  reference: RunContextResourceReference;
};

export type PinnedSkillRevision = {
  revisionId: string;
  skill: SkillContext;
  reference: RunContextResourceReference;
  resources: PinnedSkillResource[];
};

export type PinnedSkillPlan = {
  skillLocale: "ja" | "en";
  selectedSkills: SkillContext[];
  skillRevisions: PinnedSkillRevision[];
  /** Plan plus every exact Skill instruction/resource revision available to this Run. */
  references: RunContextResourceReference[];
  /** Exact subset already activated into the current RunContext. */
  activeReferences: RunContextResourceReference[];
  planReference: RunContextResourceReference;
};

export type SkillManualIdentity = {
  source: "managed" | "custom";
  skillId: string;
};

export type SkillResourceIdentity = SkillManualIdentity & {
  resourceId: string;
};

export type ActivatedSkillManual = {
  skill: SkillContext;
  resourceManifest: SkillResourceManifestEntry[];
};

export type ActivatedSkillResource = SkillResourceManifestEntry & {
  manual: SkillManualIdentity;
  content: string;
};

export class SkillRevisionUnavailableError extends Error {
  readonly code = "skill_revision_unavailable" as const;

  constructor(
    message = "Pinned Skill revision is unavailable",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillRevisionUnavailableError";
  }
}

export class SkillRevisionRevokedError extends Error {
  readonly code = "skill_revision_revoked" as const;

  constructor(message = "Pinned Skill was deleted before activation") {
    super(message);
    this.name = "SkillRevisionRevokedError";
  }
}

function canonicalJson(value: unknown): string {
  const result = stringifyCanonicalJson(value);
  if (result === undefined) {
    throw new TypeError("Skill revision is not JSON serializable");
  }
  if (new TextEncoder().encode(result).byteLength > MAX_REVISION_JSON_BYTES) {
    throw new TypeError("Skill revision exceeds the persistence limit");
  }
  return result;
}

async function digest(value: string): Promise<string> {
  return `sha256:${await computeSHA256(value)}`;
}

function isStringArray(value: unknown, maxItems = 64): value is string[] {
  return Array.isArray(value) && value.length <= maxItems &&
    value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCanonicalStoredJson(value: string, label: string): unknown {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (canonicalJson(parsed) !== value) {
      throw new TypeError(`${label} is not canonical JSON`);
    }
    return parsed;
  } catch (error) {
    throw new SkillRevisionUnavailableError(`Malformed ${label}`, {
      cause: error,
    });
  }
}

async function logicalSkillResourceId(skill: Pick<SkillContext, "id" | "source">) {
  if (!SKILL_SOURCES.has(skill.source) || !skill.id || skill.id.length > 128) {
    throw new TypeError("Invalid logical Skill identity");
  }
  return `skill_${await computeSHA256(canonicalJson({
    source: skill.source,
    skillId: skill.id,
  }))}`;
}

export async function skillRevisionSnapshot(
  workspaceId: string,
  skill: SkillContext,
  fallbackLocale: "ja" | "en" = "en",
): Promise<SkillRevisionSnapshot> {
  const resourceId = await logicalSkillResourceId(skill);
  const templateIds = skill.execution_contract.template_ids;
  if (templateIds.length > MAX_RESOURCES_PER_SKILL) {
    throw new TypeError("Skill resource manifest exceeds the per-Skill limit");
  }
  const resourceKeys = new Set<string>();
  const resourceManifest: StoredSkillResourceManifestEntry[] = [];
  for (const templateId of templateIds) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/u.test(templateId) ||
      resourceKeys.has(templateId)
    ) {
      throw new TypeError("Skill resource manifest has an invalid resource id");
    }
    resourceKeys.add(templateId);
    const template = getSkillTemplateResource(
      templateId,
      skill.locale ?? fallbackLocale,
    );
    if (!template) {
      throw new TypeError("Skill resource manifest references an unknown template");
    }
    const contentBytes = new TextEncoder().encode(template.content).byteLength;
    if (contentBytes > MAX_SKILL_RESOURCE_BYTES) {
      throw new TypeError("Skill resource exceeds the model-visible byte limit");
    }
    const contentDigest = await digest(template.content);
    const exactResourceId = `skillresource_${await computeSHA256(canonicalJson({
      source: skill.source,
      skillId: skill.id,
      resourceKey: template.id,
    }))}`;
    resourceManifest.push({
      id: template.id,
      title: template.title,
      description: template.description,
      mediaType: template.mediaType,
      byteSize: contentBytes,
      digest: contentDigest,
      resourceId: exactResourceId,
    });
  }
  return {
    schemaVersion: SKILL_REVISION_SCHEMA_VERSION,
    kind: "skill_revision",
    workspaceId,
    resourceId,
    source: skill.source,
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    triggers: [...skill.triggers],
    category: skill.category ?? null,
    locale: skill.locale ?? null,
    version: skill.version ?? null,
    activationTags: [...(skill.activation_tags ?? [])],
    executionContract: {
      preferred_tools: [...skill.execution_contract.preferred_tools],
      durable_output_hints: [
        ...skill.execution_contract.durable_output_hints,
      ],
      output_modes: [...skill.execution_contract.output_modes],
      required_mcp_servers: [
        ...skill.execution_contract.required_mcp_servers,
      ],
      template_ids: [...skill.execution_contract.template_ids],
    },
    availability: skill.availability,
    availabilityReasons: [...skill.availability_reasons],
    priority: skill.priority ?? null,
    resourceManifest,
  };
}

export async function customSkillResourceId(skillId: string): Promise<string> {
  return await logicalSkillResourceId({ id: skillId, source: "custom" });
}

async function prepareSkillRevision(
  workspaceId: string,
  skill: SkillContext,
  fallbackLocale: "ja" | "en",
): Promise<PreparedSkillRevision> {
  const snapshot = await skillRevisionSnapshot(
    workspaceId,
    skill,
    fallbackLocale,
  );
  const contentJson = canonicalJson(snapshot);
  const contentDigest = await digest(contentJson);
  const identity = canonicalJson({
    workspaceId,
    resourceId: snapshot.resourceId,
    contentDigest,
  });
  const id = `skr_${await computeSHA256(identity)}`;
  const resources = await Promise.all(snapshot.resourceManifest.map(
    async (manifest): Promise<PreparedSkillResourceRevision> => {
      const template = getSkillTemplateResource(
        manifest.id,
        skill.locale ?? fallbackLocale,
      );
      if (!template) {
        throw new TypeError("Skill resource disappeared during revision creation");
      }
      return {
        id: `skrr_${await computeSHA256(canonicalJson({
          skillRevisionId: id,
          resourceId: manifest.resourceId,
          contentDigest: manifest.digest,
        }))}`,
        accountId: workspaceId,
        skillRevisionId: id,
        resourceId: manifest.resourceId,
        resourceKey: manifest.id,
        mediaType: manifest.mediaType,
        contentDigest: manifest.digest,
        contentBytes: manifest.byteSize,
        contentText: template.content,
      };
    },
  ));
  return {
    id,
    accountId: workspaceId,
    resourceId: snapshot.resourceId,
    source: snapshot.source,
    skillId: snapshot.skillId,
    contentDigest,
    contentJson,
    snapshot,
    resources,
  };
}

async function skillPlanResourceId(runId: string): Promise<string> {
  return `skillplan_${await computeSHA256(canonicalJson({ runId }))}`;
}

function parseSkillRevisionSnapshot(
  value: unknown,
  expected: {
    workspaceId: string;
    resourceId: string;
    source: string;
    skillId: string;
  },
): ParsedSkillRevisionSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SKILL_REVISION_SCHEMA_VERSION ||
    value.kind !== "skill_revision" ||
    value.workspaceId !== expected.workspaceId ||
    value.resourceId !== expected.resourceId ||
    value.source !== expected.source ||
    value.skillId !== expected.skillId ||
    !SKILL_SOURCES.has(value.source as string) ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    typeof value.instructions !== "string" ||
    !isStringArray(value.triggers) ||
    !(value.category === null ||
      (typeof value.category === "string" &&
        SKILL_CATEGORIES.has(value.category))) ||
    !(value.locale === null || value.locale === "ja" || value.locale === "en") ||
    !(value.version === null || typeof value.version === "string") ||
    !isStringArray(value.activationTags) ||
    !isRecord(value.executionContract) ||
    !isStringArray(value.executionContract.preferred_tools) ||
    !isStringArray(value.executionContract.durable_output_hints) ||
    value.executionContract.durable_output_hints.some((hint) =>
      !DURABLE_OUTPUT_HINTS.has(hint)
    ) ||
    !isStringArray(value.executionContract.output_modes) ||
    value.executionContract.output_modes.some((mode) =>
      !SKILL_OUTPUT_MODES.has(mode)
    ) ||
    !isStringArray(value.executionContract.required_mcp_servers) ||
    !isStringArray(value.executionContract.template_ids) ||
    !SKILL_AVAILABILITY.has(value.availability as SkillAvailabilityStatus) ||
    !isStringArray(value.availabilityReasons) ||
    !(value.priority === null ||
      (Number.isSafeInteger(value.priority) && Number(value.priority) >= 0))
  ) {
    throw new SkillRevisionUnavailableError("Malformed Skill revision");
  }
  if (value.resourceManifest === undefined) {
    return value as unknown as SkillRevisionSnapshotV1;
  }
  if (
    !Array.isArray(value.resourceManifest) ||
    value.resourceManifest.length > MAX_RESOURCES_PER_SKILL
  ) {
    throw new SkillRevisionUnavailableError("Malformed Skill resource manifest");
  }
  const resourceKeys = new Set<string>();
  const resourceIds = new Set<string>();
  for (const resource of value.resourceManifest) {
    if (
      !isRecord(resource) ||
      typeof resource.id !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/u.test(resource.id) ||
      typeof resource.resourceId !== "string" ||
      !/^skillresource_[a-f0-9]{64}$/u.test(resource.resourceId) ||
      typeof resource.title !== "string" ||
      typeof resource.description !== "string" ||
      resource.mediaType !== "text/markdown" ||
      !Number.isSafeInteger(resource.byteSize) ||
      Number(resource.byteSize) < 0 ||
      Number(resource.byteSize) > MAX_SKILL_RESOURCE_BYTES ||
      typeof resource.digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(resource.digest) ||
      resourceKeys.has(resource.id) ||
      resourceIds.has(resource.resourceId)
    ) {
      throw new SkillRevisionUnavailableError(
        "Malformed Skill resource manifest entry",
      );
    }
    resourceKeys.add(resource.id);
    resourceIds.add(resource.resourceId);
  }
  return value as unknown as SkillRevisionSnapshot;
}

function toSkillContext(snapshot: ParsedSkillRevisionSnapshot): SkillContext {
  return {
    id: snapshot.skillId,
    name: snapshot.name,
    description: snapshot.description,
    instructions: snapshot.instructions,
    triggers: [...snapshot.triggers],
    source: snapshot.source,
    category: snapshot.category ?? undefined,
    locale: snapshot.locale ?? undefined,
    version: snapshot.version ?? undefined,
    activation_tags: [...snapshot.activationTags],
    execution_contract: {
      preferred_tools: [...snapshot.executionContract.preferred_tools],
      durable_output_hints: [
        ...snapshot.executionContract.durable_output_hints,
      ],
      output_modes: [...snapshot.executionContract.output_modes],
      required_mcp_servers: [
        ...snapshot.executionContract.required_mcp_servers,
      ],
      template_ids: [...snapshot.executionContract.template_ids],
    },
    availability: snapshot.availability,
    availability_reasons: [...snapshot.availabilityReasons],
    priority: snapshot.priority ?? undefined,
  };
}

function resourceManifestFromSnapshot(
  snapshot: ParsedSkillRevisionSnapshot,
): StoredSkillResourceManifestEntry[] {
  return "resourceManifest" in snapshot
    ? snapshot.resourceManifest
    : [];
}

function parsePlanSnapshot(
  value: unknown,
  expected: {
    runId: string;
    workspaceId: string;
    resourceId: string;
  },
): SkillPlanSnapshot {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SKILL_PLAN_SCHEMA_VERSION ||
    value.kind !== "skill_plan_revision" ||
    value.runId !== expected.runId ||
    value.revision !== INITIAL_SKILL_PLAN_REVISION ||
    value.workspaceId !== expected.workspaceId ||
    value.resourceId !== expected.resourceId ||
    (value.skillLocale !== "ja" && value.skillLocale !== "en") ||
    !Array.isArray(value.skills) ||
    value.skills.length > MAX_SKILLS_PER_PLAN
  ) {
    throw new SkillRevisionUnavailableError("Malformed Skill plan revision");
  }
  const entries: SkillPlanEntry[] = [];
  const ids = new Set<string>();
  const resourceIds = new Set<string>();
  for (const entry of value.skills) {
    if (
      !isRecord(entry) ||
      typeof entry.revisionId !== "string" ||
      !/^skr_[a-f0-9]{64}$/u.test(entry.revisionId) ||
      typeof entry.resourceId !== "string" ||
      !/^skill_[a-f0-9]{64}$/u.test(entry.resourceId) ||
      typeof entry.resourceDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(entry.resourceDigest) ||
      ids.has(entry.revisionId) ||
      resourceIds.has(entry.resourceId)
    ) {
      throw new SkillRevisionUnavailableError("Invalid Skill plan entry");
    }
    ids.add(entry.revisionId);
    resourceIds.add(entry.resourceId);
    entries.push({
      revisionId: entry.revisionId,
      resourceId: entry.resourceId,
      resourceDigest: entry.resourceDigest,
    });
  }
  return { ...(value as unknown as SkillPlanSnapshot), skills: entries };
}

async function loadStoredPlan(params: {
  db: SqlDatabaseLike;
  runId: string;
  workspaceId: string;
  allowedReferences?: readonly RunContextResourceReference[];
}): Promise<PinnedSkillPlan | null> {
  const db = getDb(params.db);
  const rows = await db.select({
    runId: runSkillPlanRevisions.runId,
    revision: runSkillPlanRevisions.revision,
    accountId: runSkillPlanRevisions.accountId,
    resourceId: runSkillPlanRevisions.resourceId,
    planDigest: runSkillPlanRevisions.planDigest,
    planJson: runSkillPlanRevisions.planJson,
  }).from(runSkillPlanRevisions).where(and(
    eq(runSkillPlanRevisions.runId, params.runId),
    eq(runSkillPlanRevisions.accountId, params.workspaceId),
  )).orderBy(desc(runSkillPlanRevisions.revision)).limit(2).all();
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0].revision !== INITIAL_SKILL_PLAN_REVISION) {
    throw new SkillRevisionUnavailableError("Ambiguous Skill plan revision");
  }
  const row = rows[0];
  const planReference: RunContextResourceReference = {
    resourceKind: "skill_revision",
    resourceId: row.resourceId,
    resourceDigest: row.planDigest,
  };
  if (
    params.allowedReferences &&
    !params.allowedReferences.some((reference) =>
      reference.resourceKind === planReference.resourceKind &&
      reference.resourceId === planReference.resourceId &&
      reference.resourceDigest === planReference.resourceDigest
    )
  ) {
    return null;
  }
  if (await digest(row.planJson) !== row.planDigest) {
    throw new SkillRevisionUnavailableError("Skill plan digest mismatch");
  }
  const plan = parsePlanSnapshot(
    parseCanonicalStoredJson(row.planJson, "Skill plan revision"),
    {
      runId: params.runId,
      workspaceId: params.workspaceId,
      resourceId: row.resourceId,
    },
  );
  const revisionIds = plan.skills.map((entry) => entry.revisionId);
  const revisionRows = revisionIds.length === 0
    ? []
    : await db.select({
      id: skillRevisions.id,
      accountId: skillRevisions.accountId,
      resourceId: skillRevisions.resourceId,
      source: skillRevisions.source,
      skillId: skillRevisions.skillId,
      contentDigest: skillRevisions.contentDigest,
      contentJson: skillRevisions.contentJson,
    }).from(skillRevisions).where(and(
      eq(skillRevisions.accountId, params.workspaceId),
      inArray(skillRevisions.id, revisionIds),
    )).all();
  if (revisionRows.length !== revisionIds.length) {
    throw new SkillRevisionUnavailableError("Skill revision row is missing");
  }
  const rowsById = new Map(revisionRows.map((revision) => [
    revision.id,
    revision,
  ]));
  const parsedRevisions: Array<{
    entry: SkillPlanEntry;
    revision: (typeof revisionRows)[number];
    snapshot: ParsedSkillRevisionSnapshot;
  }> = [];
  let resourceCount = 0;
  for (const entry of plan.skills) {
    const revision = rowsById.get(entry.revisionId);
    if (
      !revision ||
      revision.resourceId !== entry.resourceId ||
      revision.contentDigest !== entry.resourceDigest ||
      await digest(revision.contentJson) !== revision.contentDigest
    ) {
      throw new SkillRevisionUnavailableError("Skill revision digest mismatch");
    }
    const snapshot = parseSkillRevisionSnapshot(
      parseCanonicalStoredJson(revision.contentJson, "Skill revision"),
      {
        workspaceId: params.workspaceId,
        resourceId: revision.resourceId,
        source: revision.source,
        skillId: revision.skillId,
      },
    );
    resourceCount += resourceManifestFromSnapshot(snapshot).length;
    parsedRevisions.push({ entry, revision, snapshot });
  }
  if (resourceCount > MAX_RESOURCES_PER_PLAN) {
    throw new SkillRevisionUnavailableError("Skill plan resource limit exceeded");
  }
  const resourceRows = resourceCount === 0
    ? []
    : await db.select({
      id: skillResourceRevisions.id,
      accountId: skillResourceRevisions.accountId,
      skillRevisionId: skillResourceRevisions.skillRevisionId,
      resourceId: skillResourceRevisions.resourceId,
      resourceKey: skillResourceRevisions.resourceKey,
      mediaType: skillResourceRevisions.mediaType,
      contentDigest: skillResourceRevisions.contentDigest,
      contentBytes: skillResourceRevisions.contentBytes,
    }).from(skillResourceRevisions).where(and(
      eq(skillResourceRevisions.accountId, params.workspaceId),
      inArray(skillResourceRevisions.skillRevisionId, revisionIds),
    )).all();
  if (resourceRows.length !== resourceCount) {
    throw new SkillRevisionUnavailableError("Skill resource revision row is missing");
  }
  const resourceRowsByKey = new Map(resourceRows.map((resource) => [
    `${resource.skillRevisionId}\0${resource.resourceKey}`,
    resource,
  ]));
  const selectedSkills: SkillContext[] = [];
  const skillRevisionEntries: PinnedSkillRevision[] = [];
  const references: RunContextResourceReference[] = [planReference];
  for (const { revision, snapshot } of parsedRevisions) {
    const skill = toSkillContext(snapshot);
    const reference: RunContextResourceReference = {
      resourceKind: "skill_revision",
      resourceId: revision.resourceId,
      resourceDigest: revision.contentDigest,
    };
    const resources: PinnedSkillResource[] = resourceManifestFromSnapshot(
      snapshot,
    ).map((manifest) => {
        const row = resourceRowsByKey.get(`${revision.id}\0${manifest.id}`);
        if (
          !row ||
          row.resourceId !== manifest.resourceId ||
          row.mediaType !== manifest.mediaType ||
          row.contentDigest !== manifest.digest ||
          row.contentBytes !== manifest.byteSize ||
          !/^skrr_[a-f0-9]{64}$/u.test(row.id)
        ) {
          throw new SkillRevisionUnavailableError(
            "Skill resource revision manifest mismatch",
          );
        }
        const resourceReference: RunContextResourceReference = {
          resourceKind: "skill_revision",
          resourceId: manifest.resourceId,
          resourceDigest: manifest.digest,
        };
        references.push(resourceReference);
        return {
          manifest: {
            id: manifest.id,
            title: manifest.title,
            description: manifest.description,
            mediaType: manifest.mediaType,
            byteSize: manifest.byteSize,
            digest: manifest.digest,
          },
          reference: resourceReference,
        };
    });
    selectedSkills.push(skill);
    skillRevisionEntries.push({
      revisionId: revision.id,
      skill,
      reference,
      resources,
    });
    references.push(reference);
  }
  if (params.allowedReferences) {
    const unknownReference = params.allowedReferences.find((allowed) =>
      allowed.resourceKind !== "skill_revision" ||
      !references.some((reference) =>
        allowed.resourceId === reference.resourceId &&
        allowed.resourceDigest === reference.resourceDigest
      )
    );
    if (unknownReference) {
      throw new SkillRevisionUnavailableError(
        "RunContext contains a Skill reference outside the pinned plan",
      );
    }
    for (const skillRevision of skillRevisionEntries) {
      const resourceActive = skillRevision.resources.some((resource) =>
        params.allowedReferences?.some((allowed) =>
          allowed.resourceId === resource.reference.resourceId &&
          allowed.resourceDigest === resource.reference.resourceDigest
        )
      );
      const instructionsActive = params.allowedReferences.some((allowed) =>
        allowed.resourceId === skillRevision.reference.resourceId &&
        allowed.resourceDigest === skillRevision.reference.resourceDigest
      );
      if (resourceActive && !instructionsActive) {
        throw new SkillRevisionUnavailableError(
          "Skill resource is active without its parent instructions",
        );
      }
    }
  }
  return {
    skillLocale: plan.skillLocale,
    selectedSkills,
    skillRevisions: skillRevisionEntries,
    references,
    activeReferences: [...(params.allowedReferences ?? [])],
    planReference,
  };
}

export async function loadPinnedSkillPlan(params: {
  db: SqlDatabaseLike;
  authority: RunExecutionAuthority;
}): Promise<PinnedSkillPlan | null> {
  const skillReferences = params.authority.resourceReferences?.filter(
    (reference) => reference.resourceKind === "skill_revision",
  ) ?? [];
  if (skillReferences.length === 0) return null;
  const plan = await loadStoredPlan({
    db: params.db,
    runId: params.authority.runId,
    workspaceId: params.authority.workspaceId,
    allowedReferences: skillReferences,
  });
  if (!plan) {
    throw new SkillRevisionUnavailableError(
      "RunContext references a missing Skill plan",
    );
  }
  return plan;
}

export async function ensureInitialSkillPlan(params: {
  db: SqlDatabaseLike;
  authority: RunExecutionAuthority;
  skillLocale: "ja" | "en";
  selectedSkills: readonly SkillContext[];
}): Promise<PinnedSkillPlan> {
  if (params.selectedSkills.length > MAX_SKILLS_PER_PLAN) {
    throw new TypeError("Skill plan exceeds the selected Skill limit");
  }
  const existing = await loadPinnedSkillPlan({
    db: params.db,
    authority: params.authority,
  });
  if (existing) return existing;

  const prepared = await Promise.all(
    params.selectedSkills.map((skill) =>
      prepareSkillRevision(
        params.authority.workspaceId,
        skill,
        params.skillLocale,
      )
    ),
  );
  const resourceCount = prepared.reduce(
    (count, revision) => count + revision.resources.length,
    0,
  );
  if (resourceCount > MAX_RESOURCES_PER_PLAN) {
    throw new TypeError("Skill plan exceeds the resource manifest limit");
  }
  const logicalResourceIds = new Set<string>();
  for (const revision of prepared) {
    if (logicalResourceIds.has(revision.resourceId)) {
      throw new TypeError("Skill plan contains a duplicate logical Skill");
    }
    logicalResourceIds.add(revision.resourceId);
  }
  const resourceId = await skillPlanResourceId(params.authority.runId);
  const plan: SkillPlanSnapshot = {
    schemaVersion: SKILL_PLAN_SCHEMA_VERSION,
    kind: "skill_plan_revision",
    runId: params.authority.runId,
    revision: INITIAL_SKILL_PLAN_REVISION,
    workspaceId: params.authority.workspaceId,
    resourceId,
    skillLocale: params.skillLocale,
    skills: prepared.map((revision) => ({
      revisionId: revision.id,
      resourceId: revision.resourceId,
      resourceDigest: revision.contentDigest,
    })),
  };
  const planJson = canonicalJson(plan);
  const planDigest = await digest(planJson);
  const createdAt = new Date().toISOString();
  const db = getDb(params.db);
  const revisionInserts = prepared.map((revision) =>
    db.insert(skillRevisions).values({
      id: revision.id,
      accountId: revision.accountId,
      resourceId: revision.resourceId,
      source: revision.source,
      skillId: revision.skillId,
      contentDigest: revision.contentDigest,
      contentJson: revision.contentJson,
      createdAt,
    }).onConflictDoNothing()
  );
  const resourceInserts = prepared.flatMap((revision) =>
    revision.resources.map((resource) =>
      db.insert(skillResourceRevisions).values({
        id: resource.id,
        accountId: resource.accountId,
        skillRevisionId: resource.skillRevisionId,
        resourceId: resource.resourceId,
        resourceKey: resource.resourceKey,
        mediaType: resource.mediaType,
        contentDigest: resource.contentDigest,
        contentBytes: resource.contentBytes,
        contentText: resource.contentText,
        createdAt,
      }).onConflictDoNothing()
    )
  );
  const planInsert = db.insert(runSkillPlanRevisions).select(
    db.select({
      runId: runs.id,
      revision: sql<number>`${INITIAL_SKILL_PLAN_REVISION}`.as("revision"),
      accountId: runs.accountId,
      resourceId: sql<string>`${resourceId}`.as("resource_id"),
      planDigest: sql<string>`${planDigest}`.as("plan_digest"),
      planJson: sql<string>`${planJson}`.as("plan_json"),
      createdAt: sql<string>`${createdAt}`.as("created_at"),
    }).from(runs).where(and(
      eq(runs.id, params.authority.runId),
      eq(runs.accountId, params.authority.workspaceId),
      eq(runs.status, "running"),
      eq(
        runs.currentContextRevision,
        params.authority.attestation.contextRevision,
      ),
    )),
  ).onConflictDoNothing();
  await db.batch([...revisionInserts, ...resourceInserts, planInsert]);

  const winner = await loadStoredPlan({
    db: params.db,
    runId: params.authority.runId,
    workspaceId: params.authority.workspaceId,
  });
  if (!winner) {
    throw new RunContextActivationConflictError(
      "Skill plan was not committed under the active Run authority",
    );
  }
  return winner;
}

/**
 * Make exact pinned instructions model-visible through one tool call.
 *
 * The caller supplies only the logical identities selected from the internal
 * descriptor registry. Content IDs and digests are resolved again from the
 * Run-owned immutable plan, then appended to RunContext before any instruction
 * text is returned. A retry of the same tool-call identity converges on the
 * existing revision; a conflicting concurrent activation never forks it.
 */
export async function activatePinnedSkillInstructions(params: {
  db: SqlDatabaseLike;
  authority: RunExecutionAuthority;
  activationEventId: string;
  manuals: readonly SkillManualIdentity[];
}): Promise<{
  authority: RunExecutionAuthority;
  manuals: ActivatedSkillManual[];
}> {
  if (
    params.manuals.length === 0 ||
    params.manuals.length > MAX_SKILLS_PER_PLAN
  ) {
    throw new TypeError("Skill activation requires one to eight manuals");
  }
  const requestedKeys = new Set<string>();
  for (const manual of params.manuals) {
    if (
      !SKILL_SOURCES.has(manual.source) ||
      !manual.skillId ||
      manual.skillId.length > 128
    ) {
      throw new TypeError("Invalid Skill activation identity");
    }
    const key = `${manual.source}\0${manual.skillId}`;
    if (requestedKeys.has(key)) {
      throw new TypeError("Skill activation contains a duplicate manual");
    }
    requestedKeys.add(key);
  }

  const plan = await loadPinnedSkillPlan({
    db: params.db,
    authority: params.authority,
  });
  if (!plan) {
    throw new SkillRevisionUnavailableError(
      "Run has no pinned Skill plan",
    );
  }
  const selected = params.manuals.map((manual) => {
    const entry = plan.skillRevisions.find(({ skill }) =>
      skill.source === manual.source && skill.id === manual.skillId
    );
    if (!entry) {
      throw new SkillRevisionUnavailableError(
        "Requested manual is outside the pinned Skill plan",
      );
    }
    return entry;
  });
  const references = selected.map((entry) => entry.reference);
  const db = getDb(params.db);
  const isRevoked = async () =>
    Boolean(await db.select({ id: agentResourceTombstones.id })
      .from(agentResourceTombstones)
      .where(and(
        eq(agentResourceTombstones.accountId, params.authority.workspaceId),
        eq(agentResourceTombstones.resourceKind, "skill_revision"),
        inArray(
          agentResourceTombstones.resourceId,
          references.map((reference) => reference.resourceId),
        ),
      )).limit(1).get());
  if (await isRevoked()) throw new SkillRevisionRevokedError();
  let authority: RunExecutionAuthority;
  try {
    authority = await appendRunContextResourceReferences({
      db: params.db,
      runId: params.authority.runId,
      expectedAttestation: params.authority.attestation,
      activationEventId: params.activationEventId,
      references,
    });
  } catch (error) {
    // Close the delete-vs-activation race with a precise non-content error.
    // appendRunContextResourceReferences performs the authoritative atomic
    // tombstone predicate; this read only improves classification afterwards.
    if (
      error instanceof RunContextActivationConflictError &&
      await isRevoked()
    ) {
      throw new SkillRevisionRevokedError();
    }
    throw error;
  }
  return {
    authority,
    manuals: selected.map((entry) => ({
      skill: entry.skill,
      resourceManifest: entry.resources.map((resource) => ({
        ...resource.manifest,
      })),
    })),
  };
}

/**
 * Make one exact pinned Skill resource model-visible after its manual.
 *
 * The logical manual/resource identity comes from the descriptor manifest.
 * The immutable row ID, digest, and body are re-resolved from the Run-owned
 * plan. The parent instruction reference is included in the atomic append so
 * deleting the logical Skill cannot race a resource activation.
 */
export async function activatePinnedSkillResource(params: {
  db: SqlDatabaseLike;
  authority: RunExecutionAuthority;
  activationEventId: string;
  resource: SkillResourceIdentity;
}): Promise<{
  authority: RunExecutionAuthority;
  resource: ActivatedSkillResource;
}> {
  const requested = params.resource;
  if (
    !SKILL_SOURCES.has(requested.source) ||
    !requested.skillId ||
    requested.skillId.length > 128 ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(requested.resourceId)
  ) {
    throw new TypeError("Invalid Skill resource activation identity");
  }
  const plan = await loadPinnedSkillPlan({
    db: params.db,
    authority: params.authority,
  });
  if (!plan) {
    throw new SkillRevisionUnavailableError("Run has no pinned Skill plan");
  }
  const manual = plan.skillRevisions.find(({ skill }) =>
    skill.source === requested.source && skill.id === requested.skillId
  );
  if (!manual) {
    throw new SkillRevisionUnavailableError(
      "Requested resource manual is outside the pinned Skill plan",
    );
  }
  const instructionsActive = params.authority.resourceReferences?.some(
    (reference) =>
      reference.resourceKind === manual.reference.resourceKind &&
      reference.resourceId === manual.reference.resourceId &&
      reference.resourceDigest === manual.reference.resourceDigest,
  ) ?? false;
  if (!instructionsActive) {
    throw new SkillRevisionUnavailableError(
      "Skill instructions must be activated before a resource",
    );
  }
  const pinnedResource = manual.resources.find((resource) =>
    resource.manifest.id === requested.resourceId
  );
  if (!pinnedResource) {
    throw new SkillRevisionUnavailableError(
      "Requested resource is outside the pinned Skill manifest",
    );
  }
  const db = getDb(params.db);
  const isRevoked = async () =>
    Boolean(await db.select({ id: agentResourceTombstones.id })
      .from(agentResourceTombstones)
      .where(and(
        eq(agentResourceTombstones.accountId, params.authority.workspaceId),
        eq(agentResourceTombstones.resourceKind, "skill_revision"),
        eq(agentResourceTombstones.resourceId, manual.reference.resourceId),
      )).limit(1).get());
  if (await isRevoked()) throw new SkillRevisionRevokedError();
  const rows = await db.select({
    id: skillResourceRevisions.id,
    resourceId: skillResourceRevisions.resourceId,
    resourceKey: skillResourceRevisions.resourceKey,
    mediaType: skillResourceRevisions.mediaType,
    contentDigest: skillResourceRevisions.contentDigest,
    contentBytes: skillResourceRevisions.contentBytes,
    contentText: skillResourceRevisions.contentText,
  }).from(skillResourceRevisions).where(and(
    eq(skillResourceRevisions.accountId, params.authority.workspaceId),
    eq(skillResourceRevisions.skillRevisionId, manual.revisionId),
    eq(skillResourceRevisions.resourceKey, requested.resourceId),
  )).limit(2).all();
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    row.resourceId !== pinnedResource.reference.resourceId ||
    row.resourceKey !== pinnedResource.manifest.id ||
    row.mediaType !== pinnedResource.manifest.mediaType ||
    row.contentDigest !== pinnedResource.manifest.digest ||
    row.contentBytes !== pinnedResource.manifest.byteSize ||
    new TextEncoder().encode(row.contentText).byteLength !== row.contentBytes ||
    await digest(row.contentText) !== row.contentDigest
  ) {
    throw new SkillRevisionUnavailableError(
      "Skill resource revision is missing or invalid",
    );
  }
  let authority: RunExecutionAuthority;
  try {
    authority = await appendRunContextResourceReferences({
      db: params.db,
      runId: params.authority.runId,
      expectedAttestation: params.authority.attestation,
      activationEventId: params.activationEventId,
      references: [manual.reference, pinnedResource.reference],
    });
  } catch (error) {
    if (
      error instanceof RunContextActivationConflictError &&
      await isRevoked()
    ) {
      throw new SkillRevisionRevokedError();
    }
    throw error;
  }
  return {
    authority,
    resource: {
      ...pinnedResource.manifest,
      manual: { source: requested.source, skillId: requested.skillId },
      content: row.contentText,
    },
  };
}
