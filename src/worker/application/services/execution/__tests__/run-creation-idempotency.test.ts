import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Env, RunQueueMessage } from "../../../../shared/types/index.ts";
import * as schema from "../../../../infra/db/schema.ts";
import { createThreadRun } from "../run-creation.ts";
import { MAX_RUN_INPUT_BYTES } from "../../../../shared/utils/run-input.ts";
import { computeSHA256 } from "../../../../shared/utils/hash.ts";
import { stringifyCanonicalJson } from "../../../../shared/utils/canonical-json.ts";
import {
  appendRunContextResourceReferences,
  compileBaseRunAuthority,
  loadRunExecutionAuthority,
  RunContextActivationConflictError,
  RunExecutionAuthorityUnavailableError,
  verifyRunContextAttestation,
} from "../../runs/run-authority.ts";
import { computeRunInputRevision } from "../../runs/run-context-identities.ts";
import {
  resolveRunModelInput,
  RunModelInputUnavailableError,
} from "../../runs/run-model-input.ts";
import {
  decideMcpToolConfirmation,
  requireMcpToolInvocationConfirmation,
} from "../../platform/mcp/tool-confirmation.ts";
import {
  handleSkillRuntimeContext,
  type RemoteToolExecutorDependencies,
} from "../../../../runtime/container-hosts/executor-control-rpc.ts";
import { deleteSkill } from "../../source/skills.ts";
import {
  activatePinnedSkillInstructions,
  activatePinnedSkillResource,
  SkillRevisionRevokedError,
  SkillRevisionUnavailableError,
} from "../../agent/skill-revisions.ts";
import type { ToolDefinition } from "../../../tools/tool-definitions.ts";
import { SEMANTIC_TURN_PROJECTION_ALGORITHM_REVISION } from "../../agent/memory-projection.ts";
import {
  activateToolDescriptors,
  assertPinnedToolDescriptorForExecution,
  NATIVE_TOOL_ADAPTER_REVISION,
  selectModelVisibleTools,
  ToolDescriptorRevisionUnavailableError,
} from "../../../tools/tool-descriptor-revisions.ts";
import {
  ensureRunProviderMaterialization,
  resolveRunProviderCredential,
} from "../../runs/provider-materialization.ts";

async function createFixture() {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL,
      name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT, picture TEXT,
      bio TEXT, email TEXT, trust_tier TEXT NOT NULL, setup_completed INTEGER NOT NULL,
      default_repository_id TEXT, head_snapshot_id TEXT, ai_model TEXT,
      model_backend TEXT, security_posture TEXT NOT NULL, owner_account_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE account_memberships (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, member_id TEXT NOT NULL,
      role TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, title TEXT, locale TEXT,
      status TEXT NOT NULL, summary TEXT, key_points TEXT NOT NULL,
      retrieval_index INTEGER NOT NULL, context_window INTEGER NOT NULL,
      next_message_sequence INTEGER NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, account_id TEXT NOT NULL,
      requester_account_id TEXT, session_id TEXT, parent_run_id TEXT,
      child_thread_id TEXT, root_thread_id TEXT, root_run_id TEXT,
      agent_type TEXT NOT NULL, model TEXT, status TEXT NOT NULL,
      last_event_id INTEGER NOT NULL DEFAULT 0, input TEXT NOT NULL,
      output TEXT, error TEXT, usage TEXT NOT NULL, service_id TEXT,
      service_heartbeat TEXT, lease_version INTEGER NOT NULL DEFAULT 0,
      completion_key TEXT, current_context_revision INTEGER,
      terminal_reason TEXT, transcript_sequence_start INTEGER,
      engine_checkpoint TEXT, engine_checkpoint_updated_at TEXT,
      started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, r2_key TEXT, tool_calls TEXT, tool_call_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}', sequence INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE run_grants (
      run_id TEXT PRIMARY KEY, format_version INTEGER NOT NULL,
      principal_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      parent_run_id TEXT, parent_grant_digest TEXT,
      enforcement_mode TEXT NOT NULL, grant_json TEXT NOT NULL,
      digest TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE run_context_revisions (
      run_id TEXT NOT NULL, revision INTEGER NOT NULL,
      parent_revision INTEGER, activation_event_id INTEGER,
      activation_event_key TEXT,
      format_version INTEGER NOT NULL, principal_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, thread_id TEXT NOT NULL,
      transcript_cut_sequence INTEGER NOT NULL,
      agent_profile_revision TEXT NOT NULL, model_revision TEXT NOT NULL,
      system_prompt_revision TEXT NOT NULL, run_grant_digest TEXT NOT NULL,
      record_mode TEXT NOT NULL, context_json TEXT NOT NULL,
      digest TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, revision)
    );
    CREATE TABLE run_context_resource_refs (
      run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
      workspace_id TEXT NOT NULL, resource_kind TEXT NOT NULL,
      resource_id TEXT NOT NULL, resource_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, context_revision, resource_kind, resource_id)
    );
    CREATE TABLE turn_projection_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, run_id TEXT NOT NULL,
      thread_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      projection_kind TEXT NOT NULL, format_version INTEGER NOT NULL,
      algorithm_revision TEXT NOT NULL, source_start_sequence INTEGER NOT NULL,
      source_end_sequence INTEGER NOT NULL, projection_digest TEXT NOT NULL,
      projection_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (account_id, run_id, projection_kind),
      UNIQUE (account_id, resource_id, projection_digest)
    );
    CREATE TABLE turn_projection_vector_refs (
      projection_id TEXT NOT NULL, account_id TEXT NOT NULL,
      vector_id TEXT NOT NULL UNIQUE, chunk_index INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL, chunk_digest TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (projection_id, chunk_index)
    );
    CREATE TABLE tool_descriptor_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      logical_name TEXT NOT NULL, source TEXT NOT NULL,
      adapter_reference TEXT NOT NULL, adapter_revision TEXT NOT NULL,
      schema_digest TEXT NOT NULL, descriptor_digest TEXT NOT NULL,
      descriptor_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (account_id, resource_id, descriptor_digest)
    );
    CREATE TABLE run_context_tool_descriptor_refs (
      run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
      workspace_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      resource_digest TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, context_revision, resource_id)
    );
    CREATE TABLE provider_materialization_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE,
      resource_id TEXT NOT NULL, source_kind TEXT NOT NULL,
      protocol TEXT NOT NULL, endpoint TEXT,
      materialization_digest TEXT NOT NULL, materialization_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (account_id, resource_id, materialization_digest)
    );
    CREATE TABLE run_context_provider_materialization_refs (
      run_id TEXT NOT NULL, context_revision INTEGER NOT NULL,
      workspace_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      resource_digest TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, context_revision, resource_id)
    );
    CREATE TABLE agent_resource_tombstones (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
      source_digest TEXT NOT NULL, deleted_by_account_id TEXT,
      deleted_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE agent_resource_deletion_outbox (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      resource_kind TEXT NOT NULL, resource_id TEXT NOT NULL,
      vector_ids TEXT NOT NULL DEFAULT '[]',
      offload_object_keys TEXT NOT NULL DEFAULT '[]',
      delivery_status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, claim_token TEXT, claimed_at TEXT,
      next_attempt_at TEXT, completed_at TEXT, last_error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE skill_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      source TEXT NOT NULL, skill_id TEXT NOT NULL, content_digest TEXT NOT NULL,
      content_json TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (account_id, resource_id, content_digest)
    );
    CREATE TABLE skill_resource_revisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      skill_revision_id TEXT NOT NULL, resource_id TEXT NOT NULL,
      resource_key TEXT NOT NULL, media_type TEXT NOT NULL,
      content_digest TEXT NOT NULL, content_bytes INTEGER NOT NULL,
      content_text TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (skill_revision_id, resource_key),
      UNIQUE (account_id, resource_id, content_digest)
    );
    CREATE TABLE run_skill_plan_revisions (
      run_id TEXT NOT NULL, revision INTEGER NOT NULL, account_id TEXT NOT NULL,
      resource_id TEXT NOT NULL UNIQUE, plan_digest TEXT NOT NULL,
      plan_json TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (run_id, revision)
    );
    CREATE TABLE skills (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT, instructions TEXT NOT NULL, triggers TEXT,
      metadata TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, name TEXT NOT NULL,
      url TEXT NOT NULL, transport TEXT NOT NULL, source_type TEXT NOT NULL,
      auth_mode TEXT NOT NULL, service_id TEXT, bundle_deployment_id TEXT,
      oauth_access_token TEXT, oauth_refresh_token TEXT,
      oauth_token_expires_at TEXT, oauth_scope TEXT, oauth_issuer_url TEXT,
      oauth_resource_uri TEXT, oauth_resource_metadata_url TEXT,
      oauth_client_id TEXT, oauth_client_secret TEXT,
      oauth_client_id_issued_at INTEGER, oauth_client_secret_expires_at INTEGER,
      oauth_registration_mode TEXT, oauth_token_endpoint_auth_method TEXT,
      enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE mcp_tool_confirmations (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, user_id TEXT NOT NULL,
      server_id TEXT NOT NULL, server_name TEXT NOT NULL, tool_name TEXT NOT NULL,
      schema_hash TEXT NOT NULL, arguments_hash TEXT NOT NULL,
      arguments_ciphertext TEXT NOT NULL, requested_run_id TEXT NOT NULL,
      requested_thread_id TEXT NOT NULL, consumed_run_id TEXT,
      status TEXT NOT NULL, expires_at TEXT NOT NULL, decided_at TEXT,
      consumed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE mcp_tool_confirmation_identities (
      confirmation_id TEXT PRIMARY KEY, identity_version INTEGER NOT NULL,
      principal_id TEXT NOT NULL, requested_run_id TEXT NOT NULL,
      requested_thread_id TEXT NOT NULL, run_context_revision INTEGER NOT NULL,
      run_context_digest TEXT NOT NULL, run_grant_digest TEXT NOT NULL,
      identity_extension_version INTEGER, active_context_revision INTEGER,
      active_context_digest TEXT,
      requested_tool_call_id TEXT NOT NULL, identity_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE mcp_confirmation_run_grants (
      confirmation_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
      principal_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      thread_id TEXT NOT NULL, run_context_revision INTEGER NOT NULL,
      run_context_digest TEXT NOT NULL, run_grant_digest TEXT NOT NULL,
      origin_identity_hash TEXT NOT NULL, consumed_tool_call_id TEXT,
      consumed_at TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO accounts (
      id, type, status, name, slug, trust_tier, setup_completed, ai_model,
      model_backend, security_posture, owner_account_id, created_at, updated_at
    ) VALUES
      ('user_a', 'user', 'active', 'User A', 'user-a', 'trusted', 1,
       'gpt-5.5', 'openai', 'standard', NULL, '2026-08-09T00:00:00.000Z',
       '2026-08-09T00:00:00.000Z'),
      ('user_b', 'user', 'active', 'User B', 'user-b', 'trusted', 1,
       'gpt-5.5', 'openai', 'standard', NULL, '2026-08-09T00:00:00.000Z',
       '2026-08-09T00:00:00.000Z'),
      ('space_a', 'team', 'active', 'Space A', 'space-a', 'trusted', 1,
       'gpt-5.5', 'openai', 'standard', 'user_a', '2026-08-09T00:00:00.000Z',
       '2026-08-09T00:00:00.000Z');
    INSERT INTO account_memberships (
      id, account_id, member_id, role, status, updated_at, created_at
    ) VALUES
      ('membership_a', 'space_a', 'user_a', 'owner', 'active',
       '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'),
      ('membership_b', 'space_a', 'user_b', 'editor', 'active',
       '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z');
    INSERT INTO threads (
      id, account_id, status, key_points, retrieval_index, context_window,
      next_message_sequence, created_at, updated_at
    ) VALUES
      ('thread_a', 'space_a', 'active', '[]', -1, 50, 1,
       '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'),
      ('thread_b', 'space_a', 'active', '[]', -1, 50, 0,
       '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z');
    INSERT INTO messages (
      id, thread_id, role, content, sequence, created_at
    ) VALUES (
      'message_a', 'thread_a', 'user', 'hello', 0,
      '2026-08-09T00:00:00.000Z'
    );
  `);
  const db = drizzle(client, { schema });
  const queued: RunQueueMessage[] = [];
  const env = {
    DB: db,
    ENCRYPTION_KEY: "run-confirmation-test-secret",
    RUN_QUEUE: {
      send: async (message: RunQueueMessage) => {
        queued.push(message);
      },
    },
  } as unknown as Env;
  return { client, env, queued };
}

test("Run creation reuses one deterministic row and queue delivery", async () => {
  const fixture = await createFixture();
  const key = "ab".repeat(16);
  const input = {
    userId: "user_a",
    threadId: "thread_a",
    model: "gpt-5.5",
    input: {
      locale: "en",
      context: { beta: 2, alpha: 1 },
      apiKey: "sentinel-secret",
    },
    idempotencyKey: key,
  };

  try {
    const first = await createThreadRun(fixture.env, input);
    const replay = await createThreadRun(fixture.env, {
      ...input,
      input: {
        apiKey: "sentinel-secret",
        context: { alpha: 1, beta: 2 },
        locale: "en",
      },
    });
    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) throw new Error("Expected successful Runs");
    expect(first.status).toBe(201);
    expect(first.reused).toBe(false);
    expect(first.run?.id).toBe(`run_request_${key}`);
    expect(replay.status).toBe(200);
    expect(replay.reused).toBe(true);
    expect(replay.run?.id).toBe(first.run?.id);
    expect(fixture.queued).toHaveLength(1);

    const grants = await fixture.client.execute(
      "SELECT * FROM run_grants WHERE run_id = ?",
      [first.run!.id],
    );
    const contexts = await fixture.client.execute(
      "SELECT * FROM run_context_revisions WHERE run_id = ? ORDER BY revision",
      [first.run!.id],
    );
    expect(grants.rows).toHaveLength(1);
    expect(contexts.rows).toHaveLength(1);
    const grantJson = String(grants.rows[0].grant_json);
    const contextJson = String(contexts.rows[0].context_json);
    expect(String(grants.rows[0].digest)).toBe(
      `sha256:${await computeSHA256(grantJson)}`,
    );
    expect(String(contexts.rows[0].digest)).toBe(
      `sha256:${await computeSHA256(contextJson)}`,
    );
    expect(grantJson).not.toContain("sentinel-secret");
    expect(contextJson).not.toContain("sentinel-secret");
    expect(JSON.parse(grantJson)).toMatchObject({
      schemaVersion: 1,
      runId: first.run!.id,
      principalId: "user_a",
      workspaceId: "space_a",
      parentRunId: null,
      budgets: { maxGraphSteps: 64, maxToolRounds: 8 },
      enforcement: {
        runtimeMode: "enforced",
        childCreationRequiresParentGrant: true,
        livePolicyRevalidationRequired: true,
      },
    });
    expect(JSON.parse(contextJson)).toMatchObject({
      schemaVersion: 1,
      recordMode: "shadow",
      runId: first.run!.id,
      revision: 1,
      principalId: "user_a",
      workspaceId: "space_a",
      threadId: "thread_a",
      transcriptCut: { maxSequence: 0 },
      model: { id: "gpt-5.5" },
      references: {
        explicitMemories: [],
        turnProjections: [],
        skills: [],
        toolDescriptors: [],
        interfaceMaterializations: [],
      },
    });
    const executionAuthority = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: first.run!.id,
    });
    expect(executionAuthority).toMatchObject({
      runId: first.run!.id,
      principalId: "user_a",
      workspaceId: "space_a",
      threadId: "thread_a",
      budgets: { maxGraphSteps: 64, maxToolRounds: 8 },
      attestation: {
        contextRevision: 1,
        contextDigest: String(contexts.rows[0].digest),
        runGrantDigest: String(grants.rows[0].digest),
      },
    });

    await fixture.client.execute(
      "UPDATE threads SET status = 'archived' WHERE id = 'thread_a'",
    );
    const replayAfterArchive = await createThreadRun(fixture.env, input);
    expect(replayAfterArchive.ok).toBe(true);
    if (!replayAfterArchive.ok) {
      throw new Error("Expected the accepted Run retry to remain replayable");
    }
    expect(replayAfterArchive.status).toBe(200);
    expect(replayAfterArchive.reused).toBe(true);
    await fixture.client.execute(
      "UPDATE threads SET status = 'active' WHERE id = 'thread_a'",
    );

    const crossThread = await createThreadRun(fixture.env, {
      ...input,
      threadId: "thread_b",
    });
    expect(crossThread).toEqual({
      ok: false,
      status: 409,
      error: "Idempotency key already used by another request",
    });
    const changedRequest = await createThreadRun(fixture.env, {
      ...input,
      agentType: "planner",
      input: { locale: "ja" },
    });
    expect(changedRequest).toEqual({
      ok: false,
      status: 409,
      error: "Idempotency key already used by another request",
    });
    for (
      const changedIdentity of [
        { ...input, model: "deepseek/chat" },
        { ...input, parentRunId: "parent_run" },
      ]
    ) {
      expect(await createThreadRun(fixture.env, changedIdentity)).toEqual({
        ok: false,
        status: 409,
        error: "Idempotency key already used by another request",
      });
    }
    expect(
      await createThreadRun(fixture.env, {
        ...input,
        userId: "user_b",
      }),
    ).toEqual({
      ok: false,
      status: 404,
      error: "Thread not found",
    });
    expect(fixture.queued).toHaveLength(1);
  } finally {
    fixture.client.close();
  }
});

test("provider materialization pins no secret and resolves a live key per attempt", async () => {
  const fixture = await createFixture();
  const providerEnv = {
    ...fixture.env,
    OPENAI_API_KEY: "first-provider-secret",
    TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY: "true",
  } as unknown as Env;
  try {
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.run) throw new Error("Expected created Run");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );
    const base = await loadRunExecutionAuthority({
      db: providerEnv.DB,
      runId: created.run.id,
    });
    const first = await ensureRunProviderMaterialization({
      env: providerEnv,
      runId: created.run.id,
      expectedAuthority: base.attestation,
    });
    expect(first.authority.attestation.contextRevision).toBe(2);
    expect(first.materialization.snapshot).toMatchObject({
      sourceKind: "deployment_shared_key",
      protocol: "openai_chat_completions",
      endpoint: "https://api.openai.com/v1/chat/completions",
      credentialSource: "OPENAI_API_KEY",
    });

    const stored = await fixture.client.execute(
      `SELECT materialization_json FROM provider_materialization_revisions
       WHERE run_id = ?`,
      [created.run.id],
    );
    expect(stored.rows).toHaveLength(1);
    expect(String(stored.rows[0]?.materialization_json)).not.toContain(
      "first-provider-secret",
    );
    const context = await fixture.client.execute(
      `SELECT context_json FROM run_context_revisions
       WHERE run_id = ? AND revision = 2`,
      [created.run.id],
    );
    expect(String(context.rows[0]?.context_json)).not.toContain(
      "first-provider-secret",
    );
    expect(JSON.parse(String(context.rows[0]?.context_json))).toMatchObject({
      references: {
        interfaceMaterializations: [{
          id: first.materialization.resourceId,
          digest: first.materialization.materializationDigest,
        }],
      },
    });

    // A lost api-keys response replays the same activation instead of
    // creating another context revision.
    const replay = await ensureRunProviderMaterialization({
      env: providerEnv,
      runId: created.run.id,
      expectedAuthority: base.attestation,
    });
    expect(replay.authority.attestation).toEqual(first.authority.attestation);

    const rotatedEnv = {
      ...providerEnv,
      OPENAI_API_KEY: "rotated-live-provider-secret",
    } as unknown as Env;
    const credential = await resolveRunProviderCredential({
      env: rotatedEnv,
      runId: created.run.id,
      authority: replay.authority,
    });
    expect(credential).toMatchObject({
      materializationId: first.materialization.resourceId,
      materializationDigest: first.materialization.materializationDigest,
      protocol: "openai_chat_completions",
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: "rotated-live-provider-secret",
    });
    await expect(resolveRunProviderCredential({
      env: {
        ...rotatedEnv,
        OPENAI_BASE_URL: "https://other-provider.example/v1",
      } as unknown as Env,
      runId: created.run.id,
      authority: replay.authority,
    })).rejects.toThrow("no longer authorized");
  } finally {
    fixture.client.close();
  }
});

test("Takosumi provider materialization pins exact Interface and Binding revisions", async () => {
  const fixture = await createFixture();
  const providerEnv = {
    ...fixture.env,
    OIDC_ISSUER_URL: "https://accounts.example.test",
    OIDC_CLIENT_ID: "takos-client",
    ENCRYPTION_KEY: "provider-materialization-test-key",
    TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://internal-accounts.example.test",
  } as unknown as Env;
  let bindingGeneration = 2;
  let issuedTokens = 0;
  const dependencies = {
    accountsDelegatedAuthorization: async () => ({
      accessToken: "delegated-accounts-token",
      workspaceId: "external-workspace",
      subjectId: "external-subject",
    }),
    fetchAuthorizedRuntimeInterfaces: async () => [{
      interface: {
        apiVersion: "takosumi.dev/v1alpha1",
        kind: "Interface",
        metadata: {
          id: "if_ai_gateway",
          workspaceId: "external-workspace",
          name: "default-ai",
          ownerRef: { kind: "Workspace", id: "external-workspace" },
          generation: 4,
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
        spec: {
          type: "takosumi.ai.gateway",
          version: "v1",
          document: { protocol: "openai-compatible" },
          inputs: {
            endpoint: {
              source: "literal",
              value: "https://gateway.example.test/v1",
            },
          },
          access: {
            visibility: "workspace",
            resourceUriInput: "endpoint",
          },
        },
        status: {
          phase: "Resolved",
          observedGeneration: 4,
          resolvedRevision: 7,
          resolvedInputs: {
            endpoint: "https://gateway.example.test/v1",
          },
        },
      },
      binding: {
        apiVersion: "takosumi.dev/v1alpha1",
        kind: "InterfaceBinding",
        metadata: {
          id: "ifb_ai_gateway",
          workspaceId: "external-workspace",
          generation: bindingGeneration,
          createdAt: "2026-08-10T00:00:00.000Z",
          updatedAt: "2026-08-10T00:00:00.000Z",
        },
        spec: {
          interfaceId: "if_ai_gateway",
          subjectRef: { kind: "Principal", id: "external-subject" },
          permissions: ["ai.chat"],
          delivery: { type: "oauth2" },
        },
        status: {
          phase: "Ready",
          observedInterfaceRevision: 7,
        },
      },
    }] as never,
    issueRuntimeInterfaceAccessToken: async () => {
      issuedTokens += 1;
      return `fresh-runtime-token-${issuedTokens}`;
    },
    fetch: async () => {
      throw new Error("typed runtime-interface clients are dependency-injected");
    },
  } as never;
  try {
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.run) throw new Error("Expected created Run");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );
    const base = await loadRunExecutionAuthority({
      db: providerEnv.DB,
      runId: created.run.id,
    });
    const pinned = await ensureRunProviderMaterialization({
      env: providerEnv,
      runId: created.run.id,
      expectedAuthority: base.attestation,
      dependencies,
    });
    expect(pinned.materialization.snapshot).toMatchObject({
      sourceKind: "takosumi_interface",
      endpoint: "https://gateway.example.test/v1/chat/completions",
      externalWorkspaceId: "external-workspace",
      externalSubjectId: "external-subject",
      interfaceId: "if_ai_gateway",
      interfaceGeneration: 4,
      interfaceResolvedRevision: 7,
      bindingId: "ifb_ai_gateway",
      bindingGeneration: 2,
      bindingObservedInterfaceRevision: 7,
    });
    const credential = await resolveRunProviderCredential({
      env: providerEnv,
      runId: created.run.id,
      authority: pinned.authority,
      dependencies,
    });
    expect(credential.apiKey).toBe("fresh-runtime-token-1");
    expect(issuedTokens).toBe(1);

    bindingGeneration = 3;
    await expect(resolveRunProviderCredential({
      env: providerEnv,
      runId: created.run.id,
      authority: pinned.authority,
      dependencies,
    })).rejects.toThrow("no longer authorized");
    expect(issuedTokens).toBe(1);
  } finally {
    fixture.client.close();
  }
});

test("exact model input is pinned to RunContext and excludes mutable history sources", async () => {
  const fixture = await createFixture();
  let offloadReads = 0;
  let vectorQueries = 0;
  const exactEnv = {
    ...fixture.env,
    TAKOS_OFFLOAD: {
      get: async () => {
        offloadReads += 1;
        throw new Error("pinned history must not hydrate mutable R2 content");
      },
    },
    VECTORIZE: {
      query: async () => {
        vectorQueries += 1;
        throw new Error("pinned history must not query mutable vectors");
      },
    },
  } as unknown as Env;

  try {
    const created = await createThreadRun(exactEnv, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: {
        locale: "en",
        context: { stable: true },
        apiKey: "never-copy-run-input-secret",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.run) throw new Error("Expected created Run");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );

    const runRow = await fixture.client.execute(
      "SELECT input FROM runs WHERE id = ?",
      [created.run.id],
    );
    const contextRow = await fixture.client.execute(
      "SELECT context_json FROM run_context_revisions WHERE run_id = ? AND revision = 1",
      [created.run.id],
    );
    const runInputJson = String(runRow.rows[0].input);
    const contextJson = String(contextRow.rows[0].context_json);
    expect(JSON.parse(contextJson)).toMatchObject({
      runInput: {
        revision: await computeRunInputRevision(runInputJson),
      },
    });
    expect(contextJson).not.toContain("never-copy-run-input-secret");

    await fixture.client.execute(
      "UPDATE messages SET r2_key = 'messages/thread_a/message_a.json' WHERE id = 'message_a'",
    );
    await fixture.client.execute(
      "UPDATE threads SET summary = 'mutable attacker summary', key_points = '[\"mutable attacker key point\"]' WHERE id = 'thread_a'",
    );
    await fixture.client.execute({
      sql: `INSERT INTO messages (
        id, thread_id, role, content, sequence, created_at
      ) VALUES (?, ?, 'user', ?, 1, ?)`,
      args: [
        "post_cut_message",
        "thread_a",
        "post-cut attacker message",
        "2026-08-09T00:00:01.000Z",
      ],
    });

    const resolved = await resolveRunModelInput({
      env: exactEnv,
      runId: created.run.id,
    });
    expect(resolved.modelId).toBe("gpt-5.5");
    expect(resolved.transcriptCutSequence).toBe(0);
    expect(resolved.history).toEqual([{ role: "user", content: "hello" }]);
    expect(resolved.runAuthority.contextRevision).toBe(2);
    expect(JSON.stringify(resolved)).not.toContain("attacker");
    expect(JSON.stringify(resolved)).not.toContain(
      "never-copy-run-input-secret",
    );
    expect(offloadReads).toBe(0);
    expect(vectorQueries).toBe(0);

    await fixture.client.execute(
      "UPDATE messages SET content = 'mutable attacker rewrite' WHERE id = 'message_a'",
    );
    const replay = await resolveRunModelInput({
      env: exactEnv,
      runId: created.run.id,
    });
    expect(replay.history).toEqual([{ role: "user", content: "hello" }]);
    expect(replay.runAuthority).toEqual(resolved.runAuthority);
    const projectionRows = await fixture.client.execute(
      "SELECT resource_id, projection_json, projection_digest FROM turn_projection_revisions WHERE run_id = ?",
      [created.run.id],
    );
    expect(projectionRows.rows).toHaveLength(1);
    expect(String(projectionRows.rows[0]?.projection_json)).not.toContain(
      "attacker",
    );
    expect(String(projectionRows.rows[0]?.projection_digest)).toBe(
      `sha256:${
        await computeSHA256(String(projectionRows.rows[0]?.projection_json))
      }`,
    );

    exactEnv.AGENT_TEMPERATURE = "0.75";
    await expect(resolveRunModelInput({
      env: exactEnv,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunModelInputUnavailableError);
    delete exactEnv.AGENT_TEMPERATURE;

    const storedProjectionJson = String(
      projectionRows.rows[0]?.projection_json,
    );
    await fixture.client.execute(
      "UPDATE turn_projection_revisions SET projection_json = '{}' WHERE run_id = ?",
      [created.run.id],
    );
    await expect(resolveRunModelInput({
      env: exactEnv,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
    await fixture.client.execute(
      "UPDATE turn_projection_revisions SET projection_json = ? WHERE run_id = ?",
      [storedProjectionJson, created.run.id],
    );

    await fixture.client.execute(
      "UPDATE runs SET input = '{\"locale\":\"tampered\"}' WHERE id = ?",
      [created.run.id],
    );
    await expect(resolveRunModelInput({
      env: exactEnv,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("TurnProjection creation linearizes retries and fails closed after source loss", async () => {
  const fixture = await createFixture();
  try {
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
      idempotencyKey: "ab".repeat(16),
    });
    if (!created.ok || !created.run) throw new Error("Expected created Run");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );

    const [left, right] = await Promise.all([
      resolveRunModelInput({ env: fixture.env, runId: created.run.id }),
      resolveRunModelInput({ env: fixture.env, runId: created.run.id }),
    ]);
    expect(left.runAuthority).toEqual(right.runAuthority);
    expect(left.runAuthority.contextRevision).toBe(2);
    const evidence = await fixture.client.execute({
      sql: `SELECT
              (SELECT COUNT(*) FROM turn_projection_revisions
               WHERE run_id = ?) AS projection_count,
              (SELECT COUNT(*) FROM run_context_revisions
               WHERE run_id = ? AND revision = 2) AS revision_count,
              (SELECT COUNT(*) FROM run_context_resource_refs
               WHERE run_id = ? AND context_revision = 2
                 AND resource_kind = 'turn_projection') AS reference_count`,
      args: [created.run.id, created.run.id, created.run.id],
    });
    expect(Number(evidence.rows[0]?.projection_count)).toBe(1);
    expect(Number(evidence.rows[0]?.revision_count)).toBe(1);
    expect(Number(evidence.rows[0]?.reference_count)).toBe(1);

    await fixture.client.execute(
      "UPDATE threads SET status = 'deleted' WHERE id = 'thread_a'",
    );
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
    await fixture.client.execute(
      "UPDATE threads SET status = 'active' WHERE id = 'thread_a'",
    );
    await fixture.client.execute(
      "DELETE FROM turn_projection_revisions WHERE run_id = ?",
      [created.run.id],
    );
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("automatic semantic recall pins canonical TurnProjections into model input", async () => {
  const fixture = await createFixture();
  try {
    const semanticSnapshot = {
      schemaVersion: 1,
      projectionKind: "semantic_turn",
      algorithmRevision: SEMANTIC_TURN_PROJECTION_ALGORITHM_REVISION,
      runId: "run_prior",
      workspaceId: "space_a",
      threadId: "thread_a",
      outcome: "completed",
      sourceStartSequence: 0,
      sourceEndSequence: 1,
      sourceTruncated: false,
      messages: [
        { role: "user", content: "A prior hello question" },
        { role: "assistant", content: "A canonical prior answer" },
      ],
    };
    const projectionJson = stringifyCanonicalJson(semanticSnapshot);
    if (!projectionJson) throw new Error("Expected canonical projection");
    const projectionDigest = `sha256:${await computeSHA256(projectionJson)}`;
    const resourceId = `turn_projection_${projectionDigest.slice(7)}`;
    await fixture.client.execute({
      sql: `INSERT INTO turn_projection_revisions (
        id, account_id, run_id, thread_id, resource_id, projection_kind,
        format_version, algorithm_revision, source_start_sequence,
        source_end_sequence, projection_digest, projection_json, created_at
      ) VALUES (?, 'space_a', 'run_prior', 'thread_a', ?, 'semantic_turn',
        1, ?, 0, 1, ?, ?, '2026-08-09T00:00:00.000Z')`,
      args: [
        resourceId,
        resourceId,
        SEMANTIC_TURN_PROJECTION_ALGORITHM_REVISION,
        projectionDigest,
        projectionJson,
      ],
    });
    await fixture.client.execute(
      "UPDATE messages SET sequence = 600 WHERE id = 'message_a'",
    );
    await fixture.client.execute(
      "UPDATE threads SET next_message_sequence = 601 WHERE id = 'thread_a'",
    );

    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
      idempotencyKey: "ac".repeat(16),
    });
    if (!created.ok || !created.run) throw new Error("Expected created Run");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );
    const resolved = await resolveRunModelInput({
      env: fixture.env,
      runId: created.run.id,
    });
    expect(resolved.history[0]).toMatchObject({
      role: "system",
    });
    expect(resolved.history[0]?.content).toContain("A canonical prior answer");
    expect(resolved.history.at(-1)).toEqual({ role: "user", content: "hello" });
    const authority = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    });
    expect(authority.attestation.contextRevision).toBe(2);
    expect(authority.resourceReferences?.filter((reference) =>
      reference.resourceKind === "turn_projection"
    )).toHaveLength(2);

    await fixture.client.execute({
      sql: `INSERT INTO agent_resource_tombstones (
        id, account_id, resource_kind, resource_id, source_digest,
        deleted_at, created_at
      ) VALUES ('semantic_tombstone', 'space_a', 'turn_projection', ?, ?,
        '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z')`,
      args: [resourceId, projectionDigest],
    });
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("Skill runtime pins descriptors before exact on-demand instruction activation", async () => {
  const fixture = await createFixture();
  let cleanupCalls = 0;
  const dependencies: RemoteToolExecutorDependencies = {
    resolveAuthority: (runId, env) =>
      loadRunExecutionAuthority({ db: env.DB, runId }),
    async createExecutor() {
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [{ name: "search" }] as never,
        execute: async () => {
          throw new Error("not used");
        },
        cleanup() {
          cleanupCalls += 1;
        },
      };
    },
  };

  try {
    await fixture.client.execute(`
      INSERT INTO skills (
        id, account_id, name, description, instructions, triggers, metadata,
        enabled, created_at, updated_at
      ) VALUES (
        'skill_custom_a', 'space_a', 'Hello helper', 'Handles greetings',
        'immutable instruction v1', 'hello',
        '{"locale":"en","execution_contract":{"template_ids":["research-brief"]}}', 1,
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      ), (
        'skill_custom_b', 'space_a', 'Hello verifier', 'Verifies greetings',
        'delete-before-activation', 'hello', '{}', 1,
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      ), (
        'skill_custom_c', 'space_a', 'Hello planner', 'Plans greetings',
        'concurrent instruction c', 'hello', '{}', 1,
        '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      )
    `);
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
    });
    if (!created.ok || !created.run) throw new Error("Expected created Run");
    await fixture.client.execute({
      sql: "UPDATE runs SET status = 'running' WHERE id = ?",
      args: [created.run.id],
    });

    const firstResponse = await handleSkillRuntimeContext(
      { runId: created.run.id },
      fixture.env,
      dependencies,
    );
    expect(firstResponse.status).toBe(200);
    const first = await firstResponse.json() as {
      runAuthority: { contextRevision: number };
      descriptorCount: number;
      skills?: unknown;
    };
    expect(first.runAuthority.contextRevision).toBe(3);
    expect(first.descriptorCount).toBeGreaterThanOrEqual(1);
    expect(first.skills).toBeUndefined();

    await fixture.client.execute(`
      UPDATE skills
      SET instructions = 'mutable instruction v2',
          updated_at = '2026-08-09T00:00:01.000Z'
      WHERE id = 'skill_custom_a'
    `);
    const replayResponse = await handleSkillRuntimeContext(
      { runId: created.run.id },
      fixture.env,
      dependencies,
    );
    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as typeof first;
    expect(replay.runAuthority.contextRevision).toBe(3);
    expect(replay.descriptorCount).toBe(first.descriptorCount);
    expect(replay.skills).toBeUndefined();

    const planAuthority = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    });
    const deletedBeforeActivation = await deleteSkill(
      fixture.env.DB,
      "space_a",
      "skill_custom_b",
      "user_a",
    );
    expect(deletedBeforeActivation).not.toBeNull();
    await expect(activatePinnedSkillInstructions({
      db: fixture.env.DB,
      authority: planAuthority,
      activationEventId: "tool_call:deleted_manual",
      manuals: [{ source: "custom", skillId: "skill_custom_b" }],
    })).rejects.toBeInstanceOf(SkillRevisionRevokedError);
    expect((await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).attestation.contextRevision).toBe(3);
    await expect(activatePinnedSkillResource({
      db: fixture.env.DB,
      authority: planAuthority,
      activationEventId: "tool_call:resource_before_manual",
      resource: {
        source: "custom",
        skillId: "skill_custom_a",
        resourceId: "research-brief",
      },
    })).rejects.toBeInstanceOf(SkillRevisionUnavailableError);
    const activationRequests = [
      {
        activationEventId: "tool_call:manual_describe_a",
        manual: { source: "custom" as const, skillId: "skill_custom_a" },
        instructions: "immutable instruction v1",
      },
      {
        activationEventId: "tool_call:manual_describe_c",
        manual: { source: "custom" as const, skillId: "skill_custom_c" },
        instructions: "concurrent instruction c",
      },
    ];
    const competingActivations = await Promise.allSettled(
      activationRequests.map((request) =>
        activatePinnedSkillInstructions({
          db: fixture.env.DB,
          authority: planAuthority,
          activationEventId: request.activationEventId,
          manuals: [request.manual],
        })
      ),
    );
    const winnerIndex = competingActivations.findIndex((result) =>
      result.status === "fulfilled"
    );
    const loserIndex = competingActivations.findIndex((result) =>
      result.status === "rejected"
    );
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    const winner = competingActivations[winnerIndex];
    const loser = competingActivations[loserIndex];
    if (winner?.status !== "fulfilled" || loser?.status !== "rejected") {
      throw new Error("Expected exactly one Skill activation winner");
    }
    const winnerRequest = activationRequests[winnerIndex];
    const loserRequest = activationRequests[loserIndex];
    if (!winnerRequest || !loserRequest) {
      throw new Error("Expected Skill activation request identities");
    }
    expect(winner.value.authority.attestation.contextRevision).toBe(4);
    expect(loser.reason).toBeInstanceOf(RunContextActivationConflictError);
    expect(winner.value.manuals[0]?.skill.instructions).toBe(
      winnerRequest.instructions,
    );
    const activationReplay = await activatePinnedSkillInstructions({
      db: fixture.env.DB,
      authority: planAuthority,
      activationEventId: winnerRequest.activationEventId,
      manuals: [winnerRequest.manual],
    });
    expect(activationReplay.authority.attestation.contextRevision).toBe(4);
    expect(activationReplay.manuals[0]?.skill.instructions).toBe(
      winnerRequest.instructions,
    );
    const loserActivation = await activatePinnedSkillInstructions({
      db: fixture.env.DB,
      authority: winner.value.authority,
      activationEventId: loserRequest.activationEventId,
      manuals: [loserRequest.manual],
    });
    expect(loserActivation.authority.attestation.contextRevision).toBe(5);
    expect(loserActivation.manuals[0]?.skill.instructions).toBe(
      loserRequest.instructions,
    );
    const resourceAuthority = loserActivation.authority;
    const resourceActivation = await activatePinnedSkillResource({
      db: fixture.env.DB,
      authority: resourceAuthority,
      activationEventId: "tool_call:manual_resource_a",
      resource: {
        source: "custom",
        skillId: "skill_custom_a",
        resourceId: "research-brief",
      },
    });
    expect(resourceActivation.authority.attestation.contextRevision).toBe(6);
    expect(resourceActivation.resource.content).toContain("# Research brief");
    const resourceReplay = await activatePinnedSkillResource({
      db: fixture.env.DB,
      authority: resourceAuthority,
      activationEventId: "tool_call:manual_resource_a",
      resource: {
        source: "custom",
        skillId: "skill_custom_a",
        resourceId: "research-brief",
      },
    });
    expect(resourceReplay.authority.attestation.contextRevision).toBe(6);
    expect(resourceReplay.resource.digest).toBe(
      resourceActivation.resource.digest,
    );
    await fixture.client.execute(
      "UPDATE skill_resource_revisions SET content_text = 'tampered'",
    );
    await expect(activatePinnedSkillResource({
      db: fixture.env.DB,
      authority: resourceActivation.authority,
      activationEventId: "tool_call:tampered_resource",
      resource: {
        source: "custom",
        skillId: "skill_custom_a",
        resourceId: "research-brief",
      },
    })).rejects.toBeInstanceOf(SkillRevisionUnavailableError);

    const evidence = await fixture.client.execute({
      sql: `SELECT
              (SELECT current_context_revision FROM runs WHERE id = ?) AS current_revision,
              (SELECT COUNT(*) FROM run_skill_plan_revisions WHERE run_id = ?) AS plan_count,
              (SELECT COUNT(*) FROM run_context_revisions
               WHERE run_id = ? AND revision IN (2, 3, 4, 5, 6)) AS revision_count,
              (SELECT COUNT(*) FROM run_context_resource_refs
               WHERE run_id = ? AND context_revision = 3
                 AND resource_kind = 'skill_revision') AS descriptor_reference_count,
              (SELECT COUNT(*) FROM run_context_resource_refs
               WHERE run_id = ? AND context_revision = 6
                 AND resource_kind = 'skill_revision') AS activated_reference_count`,
      args: [
        created.run.id,
        created.run.id,
        created.run.id,
        created.run.id,
        created.run.id,
      ],
    });
    expect(Number(evidence.rows[0]?.current_revision)).toBe(6);
    expect(Number(evidence.rows[0]?.plan_count)).toBe(1);
    expect(Number(evidence.rows[0]?.revision_count)).toBe(5);
    expect(Number(evidence.rows[0]?.descriptor_reference_count)).toBe(1);
    expect(Number(evidence.rows[0]?.activated_reference_count)).toBe(4);
    expect(cleanupCalls).toBe(2);

    const deleted = await deleteSkill(
      fixture.env.DB,
      "space_a",
      "skill_custom_a",
      "user_a",
    );
    expect(deleted).not.toBeNull();
    const revokedReference = await fixture.client.execute({
      sql: `SELECT COUNT(*) AS count
            FROM run_context_resource_refs r
            JOIN agent_resource_tombstones t
              ON t.account_id = r.workspace_id
             AND t.resource_kind = r.resource_kind
             AND t.resource_id = r.resource_id
            WHERE r.run_id = ? AND r.context_revision = 6`,
      args: [created.run.id],
    });
    expect(Number(revokedReference.rows[0]?.count)).toBe(1);
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

function descriptorTool(
  name: string,
  description = `${name} description`,
): ToolDefinition {
  return {
    name,
    description,
    category: name === "toolbox" ? "space" : "web",
    namespace: name === "toolbox" ? "discovery" : "web",
    family: name === "toolbox" ? "discovery.toolbox" : "web.direct",
    risk_level: name === "toolbox" ? "medium" : "low",
    side_effects: name === "toolbox",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "query" },
      },
    },
  };
}

test("ToolDescriptorRevision pins exact model-visible meaning and rejects drift or tamper", async () => {
  const fixture = await createFixture();
  try {
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
      idempotencyKey: "cd".repeat(16),
    });
    if (!created.ok || !created.run) throw new Error("Expected Run creation");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );
    const base = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    });
    const tool = descriptorTool("toolbox");
    const activated = await activateToolDescriptors({
      db: fixture.env.DB,
      authority: base,
      activationEventId: "tool_catalog:v2",
      tools: [tool],
    });
    expect(activated.authority.attestation.contextRevision).toBe(2);
    expect(activated.descriptors[0]?.snapshot.adapter).toEqual({
      reference: "native:toolbox",
      revision: NATIVE_TOOL_ADAPTER_REVISION,
    });
    expect(activated.descriptors[0]?.snapshot.definition).not.toHaveProperty(
      "adapter_identity",
    );
    await expect(assertPinnedToolDescriptorForExecution({
      db: fixture.env.DB,
      authority: activated.authority,
      tool,
    })).resolves.toMatchObject({
      snapshot: { logicalName: "toolbox" },
    });

    const replay = await activateToolDescriptors({
      db: fixture.env.DB,
      authority: base,
      activationEventId: "tool_catalog:v2",
      tools: [tool],
    });
    expect(replay.authority.attestation).toEqual(
      activated.authority.attestation,
    );

    await expect(activateToolDescriptors({
      db: fixture.env.DB,
      authority: activated.authority,
      activationEventId: "tool_call:drift:descriptor",
      tools: [descriptorTool("toolbox", "changed semantics")],
    })).rejects.toBeInstanceOf(RunContextActivationConflictError);

    await fixture.client.execute(
      "UPDATE tool_descriptor_revisions SET descriptor_json = '{}'",
    );
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("ToolDescriptorRevision fails closed for unpinned tools and missing immutable rows", async () => {
  const fixture = await createFixture();
  try {
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
      idempotencyKey: "cf".repeat(16),
    });
    if (!created.ok || !created.run) throw new Error("Expected Run creation");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );
    const base = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    });
    const tool = descriptorTool("web_fetch");
    await expect(assertPinnedToolDescriptorForExecution({
      db: fixture.env.DB,
      authority: base,
      tool,
    })).rejects.toBeInstanceOf(ToolDescriptorRevisionUnavailableError);

    const activated = await activateToolDescriptors({
      db: fixture.env.DB,
      authority: base,
      activationEventId: "tool_call:web_fetch:descriptor",
      tools: [tool],
    });
    await fixture.client.execute(
      "DELETE FROM tool_descriptor_revisions WHERE resource_id = ?",
      [activated.descriptors[0]!.reference.resourceId],
    );
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("competing ToolDescriptor activations linearize and the loser can retry", async () => {
  const fixture = await createFixture();
  try {
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
      idempotencyKey: "de".repeat(16),
    });
    if (!created.ok || !created.run) throw new Error("Expected Run creation");
    await fixture.client.execute(
      "UPDATE runs SET status = 'running' WHERE id = ?",
      [created.run.id],
    );
    const base = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    });
    const candidates = [
      descriptorTool("web_fetch"),
      descriptorTool("store_search"),
    ];
    const competing = await Promise.allSettled(candidates.map((tool) =>
      activateToolDescriptors({
        db: fixture.env.DB,
        authority: base,
        activationEventId: `tool_call:${tool.name}:descriptor`,
        tools: [tool],
      })
    ));
    expect(competing.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const winnerIndex = competing.findIndex((result) =>
      result.status === "fulfilled"
    );
    const loserIndex = winnerIndex === 0 ? 1 : 0;
    const winner = competing[winnerIndex];
    if (winner?.status !== "fulfilled") throw new Error("Expected winner");
    const retry = await activateToolDescriptors({
      db: fixture.env.DB,
      authority: winner.value.authority,
      activationEventId:
        `tool_call:${candidates[loserIndex]!.name}:descriptor`,
      tools: [candidates[loserIndex]!],
    });
    expect(retry.authority.attestation.contextRevision).toBe(3);
    expect(
      retry.authority.resourceReferences?.filter((reference) =>
        reference.resourceKind === "tool_descriptor_revision"
      ),
    ).toHaveLength(2);
  } finally {
    fixture.client.close();
  }
});

test("Worker owns model-visible tool selection and native release identity", async () => {
  const packageJson = await Bun.file(
    new URL("../../../../../../package.json", import.meta.url),
  ).json() as { version: string };
  expect(NATIVE_TOOL_ADAPTER_REVISION).toBe(`takos@${packageJson.version}`);
  expect(selectModelVisibleTools([
    descriptorTool("unbounded_extension"),
    descriptorTool("web_fetch"),
    descriptorTool("toolbox"),
  ]).map((tool) => tool.name)).toEqual(["toolbox", "web_fetch"]);
  expect(() => selectModelVisibleTools([
    descriptorTool("web_fetch"),
  ])).toThrow(ToolDescriptorRevisionUnavailableError);
});

test("concurrent Skill resource activations linearize without content drift", async () => {
  const fixture = await createFixture();
  const dependencies: RemoteToolExecutorDependencies = {
    resolveAuthority: (runId, env) =>
      loadRunExecutionAuthority({ db: env.DB, runId }),
    async createExecutor() {
      return {
        mcpFailedServers: [],
        getAvailableTools: () => [{ name: "search" }] as never,
        execute: async () => {
          throw new Error("not used");
        },
        cleanup() {},
      };
    },
  };
  try {
    await fixture.client.execute(`
      INSERT INTO skills (
        id, account_id, name, description, instructions, triggers, metadata,
        enabled, created_at, updated_at
      ) VALUES (
        'skill_resources', 'space_a', 'Resource helper', 'Uses two resources',
        'activate only the needed resource', 'hello',
        '{"locale":"en","execution_contract":{"template_ids":["research-brief","writing-draft"]}}',
        1, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
      )
    `);
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { locale: "en" },
    });
    if (!created.ok || !created.run) throw new Error("Expected created Run");
    await fixture.client.execute({
      sql: "UPDATE runs SET status = 'running' WHERE id = ?",
      args: [created.run.id],
    });
    expect((await handleSkillRuntimeContext(
      { runId: created.run.id },
      fixture.env,
      dependencies,
    )).status).toBe(200);
    const planAuthority = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    });
    const manual = await activatePinnedSkillInstructions({
      db: fixture.env.DB,
      authority: planAuthority,
      activationEventId: "tool_call:resource_manual",
      manuals: [{ source: "custom", skillId: "skill_resources" }],
    });
    expect(manual.authority.attestation.contextRevision).toBe(4);
    expect(manual.manuals[0]?.resourceManifest.map((item) => item.id)).toEqual([
      "research-brief",
      "writing-draft",
    ]);
    const requests = ["research-brief", "writing-draft"].map((resourceId) => ({
      activationEventId: `tool_call:resource_${resourceId}`,
      resource: {
        source: "custom" as const,
        skillId: "skill_resources",
        resourceId,
      },
    }));
    const competing = await Promise.allSettled(requests.map((request) =>
      activatePinnedSkillResource({
        db: fixture.env.DB,
        authority: manual.authority,
        ...request,
      })
    ));
    const winnerIndex = competing.findIndex((result) =>
      result.status === "fulfilled"
    );
    const loserIndex = competing.findIndex((result) =>
      result.status === "rejected"
    );
    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    const winner = competing[winnerIndex];
    const loser = competing[loserIndex];
    if (winner?.status !== "fulfilled" || loser?.status !== "rejected") {
      throw new Error("Expected exactly one Skill resource activation winner");
    }
    expect(winner.value.authority.attestation.contextRevision).toBe(5);
    expect(loser.reason).toBeInstanceOf(RunContextActivationConflictError);
    const replay = await activatePinnedSkillResource({
      db: fixture.env.DB,
      authority: manual.authority,
      ...requests[winnerIndex]!,
    });
    expect(replay.authority.attestation.contextRevision).toBe(5);
    expect(replay.resource.content).toBe(winner.value.resource.content);
    const final = await activatePinnedSkillResource({
      db: fixture.env.DB,
      authority: winner.value.authority,
      ...requests[loserIndex]!,
    });
    expect(final.authority.attestation.contextRevision).toBe(6);
    expect(final.resource.id).toBe(requests[loserIndex]?.resource.resourceId);
    const evidence = await fixture.client.execute({
      sql: `SELECT COUNT(*) AS count
            FROM run_context_resource_refs
            WHERE run_id = ? AND context_revision = 6
              AND resource_kind = 'skill_revision'`,
      args: [created.run.id],
    });
    expect(Number(evidence.rows[0]?.count)).toBe(4);

    expect(await deleteSkill(
      fixture.env.DB,
      "space_a",
      "skill_resources",
      "user_a",
    )).not.toBeNull();
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("approved MCP confirmation is atomically claimed by one exact-Thread Run", async () => {
  const fixture = await createFixture();
  try {
    const origin = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      idempotencyKey: "11".repeat(16),
    });
    expect(origin.ok).toBe(true);
    if (!origin.ok || !origin.run) throw new Error("Expected origin Run");
    const originAuthority = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: origin.run.id,
    });
    const pending = await requireMcpToolInvocationConfirmation(
      fixture.env.DB,
      fixture.env,
      {
        accountId: "space_a",
        userId: "user_a",
        serverId: "publication:documents",
        serverName: "Documents",
        toolName: "documents.delete",
        schemaHash: "e".repeat(64),
        arguments: { id: "doc_1" },
        runId: origin.run.id,
        threadId: "thread_a",
        runAuthority: originAuthority,
        toolCallId: "origin_tool_call",
      },
    );
    expect(pending.kind).toBe("pending");
    await decideMcpToolConfirmation(fixture.env.DB, {
      accountId: "space_a",
      userId: "user_a",
      confirmationId: pending.confirmationId,
      decision: "approve",
    });

    const crossThread = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_b",
      model: "gpt-5.5",
      idempotencyKey: "22".repeat(16),
      confirmationGrantId: pending.confirmationId,
    });
    expect(crossThread).toMatchObject({ ok: false, status: 409 });

    const key = "33".repeat(16);
    const continuation = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      idempotencyKey: key,
      confirmationGrantId: pending.confirmationId,
    });
    expect(continuation.ok).toBe(true);
    if (!continuation.ok || !continuation.run) {
      throw new Error("Expected continuation Run");
    }
    const replay = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      idempotencyKey: key,
      confirmationGrantId: pending.confirmationId,
    });
    expect(replay).toMatchObject({ ok: true, reused: true });

    const continuationAuthority = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: continuation.run.id,
    });
    expect(continuationAuthority.confirmationGrantIds).toEqual([
      pending.confirmationId,
    ]);
    const claim = await fixture.client.execute({
      sql: `SELECT run_id, run_context_digest, run_grant_digest,
                   consumed_tool_call_id
            FROM mcp_confirmation_run_grants
            WHERE confirmation_id = ?`,
      args: [pending.confirmationId],
    });
    expect(claim.rows).toEqual([{
      run_id: continuation.run.id,
      run_context_digest: continuationAuthority.attestation.contextDigest,
      run_grant_digest: continuationAuthority.attestation.runGrantDigest,
      consumed_tool_call_id: null,
    }]);

    const competing = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      idempotencyKey: "44".repeat(16),
      confirmationGrantId: pending.confirmationId,
    });
    expect(competing).toEqual({
      ok: false,
      status: 409,
      error: "MCP confirmation grant is not valid for this Run",
    });
  } finally {
    fixture.client.close();
  }
});

test("tool authority rejects legacy, shadow, and tampered Run records", async () => {
  const fixture = await createFixture();
  try {
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: "legacy_without_grant",
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);

    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
    });
    expect(created.ok).toBe(true);
    if (!created.ok || !created.run) throw new Error("Expected created Run");

    await fixture.client.execute(
      "UPDATE run_grants SET enforcement_mode = 'shadow' WHERE run_id = ?",
      [created.run.id],
    );
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);

    await fixture.client.execute(
      "UPDATE run_grants SET enforcement_mode = 'enforced' WHERE run_id = ?",
      [created.run.id],
    );
    await fixture.client.execute(
      "UPDATE run_context_revisions SET context_json = '{}' WHERE run_id = ?",
      [created.run.id],
    );
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});

test("competing Run requests cannot share one operation key", async () => {
  const fixture = await createFixture();
  const key = "de".repeat(16);

  try {
    const results = await Promise.all([
      createThreadRun(fixture.env, {
        userId: "user_a",
        threadId: "thread_a",
        model: "gpt-5.5",
        input: { locale: "en" },
        idempotencyKey: key,
      }),
      createThreadRun(fixture.env, {
        userId: "user_a",
        threadId: "thread_a",
        model: "gpt-5.5",
        input: { locale: "ja" },
        idempotencyKey: key,
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({
      ok: false,
      status: 409,
      error: "Idempotency key already used by another request",
    });
    expect(fixture.queued).toHaveLength(1);
  } finally {
    fixture.client.close();
  }
});

test("Run, RunGrant, and revision 1 roll back as one atomic batch", async () => {
  const fixture = await createFixture();
  const key = "ef".repeat(16);
  const runId = `run_request_${key}`;
  try {
    await fixture.client.execute({
      sql: `INSERT INTO run_context_revisions (
        run_id, revision, parent_revision, activation_event_id, format_version,
        principal_id, workspace_id, thread_id, transcript_cut_sequence,
        agent_profile_revision, model_revision, system_prompt_revision,
        run_grant_digest, record_mode, context_json, digest, created_at
      ) VALUES (?, 1, NULL, NULL, 1, ?, ?, ?, 0, ?, ?, ?, ?, 'shadow', '{}', ?, ?)`,
      args: [
        runId,
        "user_a",
        "space_a",
        "thread_a",
        "sha256:" + "a".repeat(64),
        "sha256:" + "b".repeat(64),
        "sha256:" + "c".repeat(64),
        "sha256:" + "d".repeat(64),
        "sha256:" + "e".repeat(64),
        "2026-08-09T00:00:00.000Z",
      ],
    });

    await expect(createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      idempotencyKey: key,
    })).rejects.toThrow();

    const runs = await fixture.client.execute(
      "SELECT id FROM runs WHERE id = ?",
      [runId],
    );
    const grants = await fixture.client.execute(
      "SELECT run_id FROM run_grants WHERE run_id = ?",
      [runId],
    );
    expect(runs.rows).toHaveLength(0);
    expect(grants.rows).toHaveLength(0);
  } finally {
    fixture.client.close();
  }
});

test("concurrent Run retries still enqueue only the winning row", async () => {
  const fixture = await createFixture();
  const key = "cd".repeat(16);
  const input = {
    userId: "user_a",
    threadId: "thread_a",
    model: "gpt-5.5",
    idempotencyKey: key,
  };

  try {
    const results = await Promise.all([
      createThreadRun(fixture.env, input),
      createThreadRun(fixture.env, input),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.status).sort()).toEqual([200, 201]);
    expect(
      results.map((result) => result.ok ? result.run?.id : null),
    ).toEqual([`run_request_${key}`, `run_request_${key}`]);
    expect(fixture.queued).toHaveLength(1);
  } finally {
    fixture.client.close();
  }
});

test("RunGrant freezes restricted Workspace policy without persisting secrets", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.execute(
      "UPDATE accounts SET security_posture = 'restricted_egress' WHERE id = 'space_a'",
    );
    const result = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { accessToken: "never-copy-this-token" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.run) throw new Error("Expected successful Run");

    const row = await fixture.client.execute(
      "SELECT grant_json FROM run_grants WHERE run_id = ?",
      [result.run.id],
    );
    const grantJson = String(row.rows[0].grant_json);
    const grant = JSON.parse(grantJson) as {
      capabilities: string[];
      policy: { securityPosture: string };
    };
    expect(grant.policy.securityPosture).toBe("restricted_egress");
    expect(grant.capabilities).toContain("storage.read");
    expect(grant.capabilities).not.toContain("egress.http");
    expect(grantJson).not.toContain("never-copy-this-token");
  } finally {
    fixture.client.close();
  }
});

test("child Run creation requires a valid parent revision and attenuates its grant", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.execute(`
      INSERT INTO runs (
        id, thread_id, account_id, requester_account_id, parent_run_id,
        root_thread_id, root_run_id, agent_type, model, status, input, usage,
        created_at
      ) VALUES (
        'parent_run', 'thread_a', 'space_a', 'user_a', NULL,
        'thread_a', 'parent_run', 'default', 'gpt-5.5', 'completed', '{}', '{}',
        '2026-08-09T00:00:00.000Z'
      )
    `);

    expect(
      await createThreadRun(fixture.env, {
        userId: "user_a",
        threadId: "thread_a",
        model: "gpt-5.5",
        parentRunId: "parent_run",
      }),
    ).toEqual({
      ok: false,
      status: 409,
      error: "Parent Run cannot delegate without a valid RunGrant",
    });

    const compiledParent = await compileBaseRunAuthority({
      db: fixture.env.DB,
      env: fixture.env,
      runId: "parent_run",
      threadId: "thread_a",
      workspaceId: "space_a",
      requesterAccountId: "user_a",
      parentRunId: null,
      agentType: "default",
      model: "gpt-5.5",
      runInputJson: "{}",
      createdAt: "2026-08-09T00:00:00.000Z",
    });
    const parentGrant = JSON.parse(compiledParent.grant.grantJson) as Record<
      string,
      unknown
    >;
    parentGrant.capabilities = ["repo.read", "storage.read"];
    parentGrant.budgets = { maxGraphSteps: 3, maxToolRounds: 2 };
    const parentGrantJson = JSON.stringify(parentGrant);
    const parentGrantDigest = `sha256:${await computeSHA256(parentGrantJson)}`;
    const parentContext = JSON.parse(
      compiledParent.context.contextJson,
    ) as Record<string, unknown>;
    parentContext.runGrant = { digest: parentGrantDigest };
    parentContext.budgets = { maxGraphSteps: 3, maxToolRounds: 2 };
    const parentContextJson = JSON.stringify(parentContext);
    const parentContextDigest = `sha256:${await computeSHA256(
      parentContextJson,
    )}`;
    await fixture.client.batch([
      {
        sql: "UPDATE runs SET current_context_revision = 1 WHERE id = 'parent_run'",
        args: [],
      },
      {
        sql: `INSERT INTO run_grants (
          run_id, format_version, principal_id, workspace_id, parent_run_id,
          parent_grant_digest, enforcement_mode, grant_json, digest, created_at
        ) VALUES (?, 1, ?, ?, NULL, NULL, 'enforced', ?, ?, ?)`,
        args: [
          "parent_run",
          "user_a",
          "space_a",
          parentGrantJson,
          parentGrantDigest,
          "2026-08-09T00:00:00.000Z",
        ],
      },
      {
        sql: `INSERT INTO run_context_revisions (
          run_id, revision, parent_revision, activation_event_id,
          format_version, principal_id, workspace_id, thread_id,
          transcript_cut_sequence, agent_profile_revision, model_revision,
          system_prompt_revision, run_grant_digest, record_mode, context_json,
          digest, created_at
        ) VALUES (?, 1, NULL, NULL, 1, ?, ?, ?, 0, ?, ?, ?, ?, 'shadow', ?, ?, ?)`,
        args: [
          "parent_run",
          "user_a",
          "space_a",
          "thread_a",
          compiledParent.context.agentProfileRevision,
          compiledParent.context.modelRevision,
          compiledParent.context.systemPromptRevision,
          parentGrantDigest,
          parentContextJson,
          parentContextDigest,
          "2026-08-09T00:00:00.000Z",
        ],
      },
    ]);

    const child = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      parentRunId: "parent_run",
    });
    expect(child.ok).toBe(true);
    if (!child.ok || !child.run) throw new Error("Expected successful child");
    const row = await fixture.client.execute(
      "SELECT grant_json, parent_grant_digest FROM run_grants WHERE run_id = ?",
      [child.run.id],
    );
    const grant = JSON.parse(String(row.rows[0].grant_json)) as {
      capabilities: string[];
      budgets: { maxGraphSteps: number; maxToolRounds: number };
    };
    expect(grant.capabilities).toEqual(["repo.read", "storage.read"]);
    expect(grant.budgets).toEqual({ maxGraphSteps: 3, maxToolRounds: 2 });
    expect(row.rows[0].parent_grant_digest).toBe(parentGrantDigest);

    await fixture.client.execute(
      "UPDATE run_grants SET grant_json = '{\"capabilities\":[\"egress.http\"]}' WHERE run_id = 'parent_run'",
    );
    expect(
      await createThreadRun(fixture.env, {
        userId: "user_a",
        threadId: "thread_a",
        model: "gpt-5.5",
        parentRunId: "parent_run",
      }),
    ).toEqual({
      ok: false,
      status: 409,
      error: "Parent Run cannot delegate without a valid RunGrant",
    });
  } finally {
    fixture.client.close();
  }
});

test("Run creation rejects invented agent policy and oversized input before persistence", async () => {
  const fixture = await createFixture();
  try {
    const unknownAgent = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      agentType: "privileged-invented-mode",
    });
    expect(unknownAgent).toEqual({
      ok: false,
      status: 400,
      error: "Agent type is not available",
    });

    const oversized = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      input: { payload: "x".repeat(MAX_RUN_INPUT_BYTES) },
    });
    expect(oversized).toEqual({
      ok: false,
      status: 400,
      error: "Run input is too large or invalid",
    });
    expect(fixture.queued).toHaveLength(0);
    const rows = await fixture.client.execute("SELECT id FROM runs");
    expect(rows.rows).toHaveLength(0);
  } finally {
    fixture.client.close();
  }
});

test("Run creation requires an active Thread", async () => {
  const fixture = await createFixture();
  try {
    await fixture.client.execute(
      "UPDATE threads SET status = 'archived' WHERE id = 'thread_a'",
    );
    expect(
      await createThreadRun(fixture.env, {
        userId: "user_a",
        threadId: "thread_a",
        model: "gpt-5.5",
      }),
    ).toEqual({
      ok: false,
      status: 409,
      error: "Archived Thread must be unarchived before starting a Run",
    });
    expect(fixture.queued).toHaveLength(0);
    const rows = await fixture.client.execute("SELECT id FROM runs");
    expect(rows.rows).toHaveLength(0);
  } finally {
    fixture.client.close();
  }
});

test("RunContext pins exact resources, retries one activation, and rejects tombstones", async () => {
  const fixture = await createFixture();
  try {
    const created = await createThreadRun(fixture.env, {
      userId: "user_a",
      threadId: "thread_a",
      model: "gpt-5.5",
      idempotencyKey: "89".repeat(16),
    });
    if (!created.ok || !created.run) throw new Error("Expected Run creation");
    await fixture.client.execute({
      sql: "UPDATE runs SET status = 'running' WHERE id = ?",
      args: [created.run.id],
    });
    const base = await loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    });
    const reference = {
      resourceKind: "explicit_memory" as const,
      resourceId: "memory_exact_a",
      resourceDigest: `sha256:${"f".repeat(64)}`,
    };
    const advanced = await appendRunContextResourceReferences({
      db: fixture.env.DB,
      runId: created.run.id,
      expectedAttestation: base.attestation,
      activationEventId: "tool_call:call_recall_a",
      references: [reference],
    });
    expect(advanced.attestation.contextRevision).toBe(2);
    expect(advanced.baseAttestation).toEqual(base.baseAttestation);

    const replay = await appendRunContextResourceReferences({
      db: fixture.env.DB,
      runId: created.run.id,
      expectedAttestation: base.attestation,
      activationEventId: "tool_call:call_recall_a",
      references: [reference],
    });
    expect(replay.attestation).toEqual(advanced.attestation);
    await expect(appendRunContextResourceReferences({
      db: fixture.env.DB,
      runId: created.run.id,
      expectedAttestation: base.attestation,
      activationEventId: "tool_call:call_recall_wrong_retry",
      references: [reference],
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
    const rows = await fixture.client.execute({
      sql: `SELECT resource_id, resource_digest
            FROM run_context_resource_refs
            WHERE run_id = ? AND context_revision = 2`,
      args: [created.run.id],
    });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.resource_id).toBe(reference.resourceId);
    expect(rows.rows[0]?.resource_digest).toBe(reference.resourceDigest);

    const competing = await Promise.allSettled([
      appendRunContextResourceReferences({
        db: fixture.env.DB,
        runId: created.run.id,
        expectedAttestation: advanced.attestation,
        activationEventId: "tool_call:call_recall_competing_a",
        references: [{
          resourceKind: "explicit_memory",
          resourceId: "memory_competing_a",
          resourceDigest: `sha256:${"a".repeat(64)}`,
        }],
      }),
      appendRunContextResourceReferences({
        db: fixture.env.DB,
        runId: created.run.id,
        expectedAttestation: advanced.attestation,
        activationEventId: "tool_call:call_recall_competing_b",
        references: [{
          resourceKind: "explicit_memory",
          resourceId: "memory_competing_b",
          resourceDigest: `sha256:${"b".repeat(64)}`,
        }],
      }),
    ]);
    expect(competing.map(({ status }) => status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const winningAuthority = competing.find((result) =>
      result.status === "fulfilled"
    );
    if (winningAuthority?.status !== "fulfilled") {
      throw new Error("Expected one competing RunContext activation to win");
    }
    expect(winningAuthority.value.attestation.contextRevision).toBe(3);
    const convergence = await fixture.client.execute({
      sql: `SELECT
              (SELECT current_context_revision FROM runs WHERE id = ?) AS current_revision,
              (SELECT COUNT(*) FROM run_context_revisions
               WHERE run_id = ? AND revision = 3) AS revision_count,
              (SELECT COUNT(*) FROM run_context_resource_refs
               WHERE run_id = ? AND context_revision = 3) AS reference_count`,
      args: [created.run.id, created.run.id, created.run.id],
    });
    expect(Number(convergence.rows[0]?.current_revision)).toBe(3);
    expect(Number(convergence.rows[0]?.revision_count)).toBe(1);
    expect(Number(convergence.rows[0]?.reference_count)).toBe(2);

    const currentAuthority = winningAuthority.value;
    await expect(verifyRunContextAttestation({
      db: fixture.env.DB,
      runId: created.run.id,
      expected: base.attestation,
      currentAuthority,
    })).resolves.toEqual(currentAuthority);
    await expect(verifyRunContextAttestation({
      db: fixture.env.DB,
      runId: created.run.id,
      expected: advanced.attestation,
      currentAuthority,
    })).resolves.toEqual(currentAuthority);
    await expect(verifyRunContextAttestation({
      db: fixture.env.DB,
      runId: created.run.id,
      expected: {
        ...advanced.attestation,
        contextDigest: `sha256:${"e".repeat(64)}`,
      },
      currentAuthority,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
    await fixture.client.execute({
      sql: `UPDATE run_context_revisions
            SET parent_revision = 99
            WHERE run_id = ? AND revision = 2`,
      args: [created.run.id],
    });
    await expect(verifyRunContextAttestation({
      db: fixture.env.DB,
      runId: created.run.id,
      expected: base.attestation,
      currentAuthority,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
    await fixture.client.execute({
      sql: `UPDATE run_context_revisions
            SET parent_revision = 1
            WHERE run_id = ? AND revision = 2`,
      args: [created.run.id],
    });

    await fixture.client.execute({
      sql: `INSERT INTO agent_resource_tombstones (
              id, account_id, resource_kind, resource_id, source_digest,
              deleted_at, created_at
            ) VALUES (?, 'space_a', 'explicit_memory', ?, ?, ?, ?)`,
      args: [
        "tombstone_memory_exact_a",
        reference.resourceId,
        reference.resourceDigest,
        "2026-08-10T00:00:00.000Z",
        "2026-08-10T00:00:00.000Z",
      ],
    });
    await expect(loadRunExecutionAuthority({
      db: fixture.env.DB,
      runId: created.run.id,
    })).rejects.toBeInstanceOf(RunExecutionAuthorityUnavailableError);
  } finally {
    fixture.client.close();
  }
});
