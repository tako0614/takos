import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { RunExecutionAuthority } from "../../runs/run-authority.ts";
import type { SkillContext } from "../skill-resolution.ts";
import {
  getSkillTemplateResource,
  listSkillTemplateDescriptors,
  listSkillTemplates,
} from "../skill-templates.ts";
import {
  ensureInitialSkillPlan,
  loadPinnedSkillPlan,
  SkillRevisionUnavailableError,
} from "../skill-revisions.ts";

const RUN_GRANT_DIGEST = `sha256:${"a".repeat(64)}`;
const CONTEXT_DIGEST = `sha256:${"b".repeat(64)}`;

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE runs (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      current_context_revision INTEGER
    );
    CREATE TABLE skill_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL,
      source TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (account_id, resource_id, content_digest)
    );
    CREATE TABLE skill_resource_revisions (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      skill_revision_id TEXT NOT NULL REFERENCES skill_revisions(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL,
      resource_key TEXT NOT NULL,
      media_type TEXT NOT NULL,
      content_digest TEXT NOT NULL,
      content_bytes INTEGER NOT NULL,
      content_text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (skill_revision_id, resource_key),
      UNIQUE (account_id, resource_id, content_digest)
    );
    CREATE TABLE run_skill_plan_revisions (
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      resource_id TEXT NOT NULL UNIQUE,
      plan_digest TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, revision)
    );
    INSERT INTO accounts (id) VALUES ('workspace-a');
    INSERT INTO runs (id, account_id, status, current_context_revision)
      VALUES ('run-a', 'workspace-a', 'running', 1);
  `);
  return { client, db: drizzle(client, { schema }) };
}

function authority(
  resourceReferences: RunExecutionAuthority["resourceReferences"] = [],
): RunExecutionAuthority {
  return {
    runId: "run-a",
    principalId: "principal-a",
    workspaceId: "workspace-a",
    threadId: "thread-a",
    capabilities: [],
    confirmationGrantIds: [],
    budgets: { maxGraphSteps: 32, maxToolRounds: 4 },
    resourceReferences,
    baseAttestation: {
      contextRevision: 1,
      contextDigest: CONTEXT_DIGEST,
      runGrantDigest: RUN_GRANT_DIGEST,
    },
    attestation: {
      contextRevision: resourceReferences.length === 0 ? 1 : 2,
      contextDigest: CONTEXT_DIGEST,
      runGrantDigest: RUN_GRANT_DIGEST,
    },
  };
}

function skill(
  id: string,
  instructions: string,
  templateIds: string[] = [],
): SkillContext {
  return {
    id,
    name: `Skill ${id}`,
    description: `Description for ${id}`,
    instructions,
    triggers: [id],
    source: "custom",
    category: "custom",
    locale: "en",
    activation_tags: [id],
    execution_contract: {
      preferred_tools: [],
      durable_output_hints: [],
      output_modes: ["chat"],
      required_mcp_servers: [],
      template_ids: templateIds,
    },
    availability: "available",
    availability_reasons: [],
    priority: 10,
  };
}

test("every declared Skill template has bounded immutable content in both locales", () => {
  const encoder = new TextEncoder();
  const templates = listSkillTemplates();
  expect(templates.length).toBeGreaterThan(0);
  for (const template of templates) {
    for (const locale of ["ja", "en"] as const) {
      const resource = getSkillTemplateResource(template.id, locale);
      expect(resource?.id).toBe(template.id);
      expect(resource?.mediaType).toBe("text/markdown");
      expect(resource?.content.trim().length).toBeGreaterThan(0);
      expect(encoder.encode(resource?.content ?? "").byteLength)
        .toBeLessThanOrEqual(
          16 * 1024,
        );
    }
  }
  for (const locale of ["ja", "en"] as const) {
    const descriptors = listSkillTemplateDescriptors(locale);
    expect(descriptors).toHaveLength(templates.length);
    expect(descriptors.every((descriptor) => !("content" in descriptor))).toBe(
      true,
    );
  }
});

test("zero-Skill selection is persisted and replayed as an exact plan", async () => {
  const fixture = await createFixture();
  try {
    const prepared = await ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "ja",
      selectedSkills: [],
    });
    expect(prepared.selectedSkills).toEqual([]);
    expect(prepared.references).toHaveLength(1);

    const replay = await loadPinnedSkillPlan({
      db: fixture.db,
      authority: authority(prepared.references),
    });
    expect(replay?.skillLocale).toBe("ja");
    expect(replay?.selectedSkills).toEqual([]);
    expect(replay?.references).toEqual(prepared.references);
  } finally {
    fixture.client.close();
  }
});

test("Skill revision pins a bounded resource manifest without exposing its body", async () => {
  const fixture = await createFixture();
  try {
    const prepared = await ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: [
        skill("custom-resource", "read the resource when needed", [
          "research-brief",
        ]),
      ],
    });
    const manual = prepared.skillRevisions[0];
    expect(manual?.resources).toHaveLength(1);
    expect(manual?.resources[0]?.manifest.id).toBe("research-brief");
    expect(manual?.resources[0]?.manifest).not.toHaveProperty("content");
    expect(prepared.references).toHaveLength(3);

    const descriptorOnly = await loadPinnedSkillPlan({
      db: fixture.db,
      authority: authority([prepared.planReference]),
    });
    expect(descriptorOnly?.skillRevisions[0]?.resources[0]?.manifest.id).toBe(
      "research-brief",
    );
    expect(descriptorOnly?.activeReferences).toEqual([prepared.planReference]);
  } finally {
    fixture.client.close();
  }
});

test("the first immutable plan wins when mutable Skill content changes", async () => {
  const fixture = await createFixture();
  try {
    const first = await ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: [skill("custom-a", "immutable v1")],
    });
    const competingRetry = await ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: [skill("custom-a", "mutable v2")],
    });

    expect(competingRetry.references).toEqual(first.references);
    expect(competingRetry.selectedSkills[0]?.instructions).toBe(
      "immutable v1",
    );
    const descriptorOnly = await loadPinnedSkillPlan({
      db: fixture.db,
      authority: authority([first.planReference]),
    });
    expect(descriptorOnly?.selectedSkills[0]?.instructions).toBe(
      "immutable v1",
    );
    expect(descriptorOnly?.activeReferences).toEqual([first.planReference]);
    expect(descriptorOnly?.references).toHaveLength(2);
    const rows = await fixture.client.execute(
      "SELECT COUNT(*) AS count FROM run_skill_plan_revisions",
    );
    expect(Number(rows.rows[0]?.count)).toBe(1);
  } finally {
    fixture.client.close();
  }
});

test("RunContext accepts only progressive subsets of the exact pinned plan", async () => {
  const fixture = await createFixture();
  try {
    const prepared = await ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: [
        skill("custom-a", "instruction a"),
        skill("custom-b", "instruction b"),
      ],
    });
    const oneContentReference = prepared.skillRevisions[0]?.reference;
    if (!oneContentReference) throw new Error("Expected Skill revision");
    const progressive = await loadPinnedSkillPlan({
      db: fixture.db,
      authority: authority([prepared.planReference, oneContentReference]),
    });
    expect(progressive?.activeReferences).toEqual([
      prepared.planReference,
      oneContentReference,
    ]);

    await expect(loadPinnedSkillPlan({
      db: fixture.db,
      authority: authority([prepared.planReference, {
        resourceKind: "skill_revision",
        resourceId: `skill_${"f".repeat(64)}`,
        resourceDigest: `sha256:${"e".repeat(64)}`,
      }]),
    })).rejects.toBeInstanceOf(SkillRevisionUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("missing or tampered pinned Skill content fails closed", async () => {
  const fixture = await createFixture();
  try {
    const prepared = await ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: [skill("custom-a", "trusted instructions")],
    });
    const pinnedAuthority = authority(prepared.references);
    await fixture.client.execute(
      "UPDATE skill_revisions SET content_json = '{}'",
    );
    await expect(loadPinnedSkillPlan({
      db: fixture.db,
      authority: pinnedAuthority,
    })).rejects.toBeInstanceOf(SkillRevisionUnavailableError);

    await fixture.client.execute("DELETE FROM skill_revisions");
    await expect(loadPinnedSkillPlan({
      db: fixture.db,
      authority: pinnedAuthority,
    })).rejects.toBeInstanceOf(SkillRevisionUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("Skill plans enforce the eight-item and logical-identity bounds", async () => {
  const fixture = await createFixture();
  try {
    const eight = Array.from(
      { length: 8 },
      (_, index) => skill(`custom-${index}`, `instructions ${index}`),
    );
    const prepared = await ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: eight,
    });
    expect(prepared.selectedSkills).toHaveLength(8);

    await expect(ensureInitialSkillPlan({
      db: fixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: [...eight, skill("custom-8", "ninth")],
    })).rejects.toThrow("selected Skill limit");
  } finally {
    fixture.client.close();
  }

  const duplicateFixture = await createFixture();
  try {
    await expect(ensureInitialSkillPlan({
      db: duplicateFixture.db,
      authority: authority(),
      skillLocale: "en",
      selectedSkills: [
        skill("duplicate", "one"),
        skill("duplicate", "two"),
      ],
    })).rejects.toThrow("duplicate logical Skill");
  } finally {
    duplicateFixture.client.close();
  }
});
