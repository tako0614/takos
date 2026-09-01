import type { ToolContext } from "./tool-definitions.ts";
import type { Env } from "../../shared/types/index.ts";
import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../shared/types/bindings.ts";
import { createToolResolver, type ToolResolverOptions } from "./resolver.ts";
import { resolveAllowedCapabilities } from "../services/platform/capabilities.ts";
import { ToolExecutor } from "./executor.ts";
import { buildPerRunCapabilityRegistry } from "./executor-utils.ts";
import { buildPinnedSkillDescriptor } from "./descriptor-builder.ts";
import type { CapabilityDescriptor } from "./capability-types.ts";
import type { ToolDefinition } from "./tool-definitions.ts";
import { evaluateSkillAvailability } from "../services/agent/skill-resolution.ts";
import {
  activatePinnedSkillInstructions,
  activatePinnedSkillResource,
  type ActivatedSkillManual,
  type ActivatedSkillResource,
  loadPinnedSkillPlan,
  type SkillManualIdentity,
  type SkillResourceIdentity,
} from "../services/agent/skill-revisions.ts";
import { listMcpServers } from "../services/platform/mcp.ts";
import { listSkillTemplates } from "../services/agent/skill-templates.ts";
import type { RunExecutionAuthority } from "../services/runs/run-authority.ts";
import type { StandardCapabilityId } from "../services/platform/capabilities.ts";
import {
  activateToolDescriptors,
  type ActivatedToolDescriptor,
} from "./tool-descriptor-revisions.ts";
import { loadRunExecutionAuthority } from "../services/runs/run-authority.ts";

export interface ToolExecutorSetupOptions extends ToolResolverOptions {
  /** Immutable upper bound accepted with the Run. */
  runAuthority?: RunExecutionAuthority;
}

export function selectEffectiveRunCapabilities(
  liveAllowed: ReadonlySet<StandardCapabilityId>,
  frozenCapabilities?: readonly StandardCapabilityId[],
): Set<StandardCapabilityId> {
  return frozenCapabilities
    ? new Set(frozenCapabilities.filter((capability) =>
      liveAllowed.has(capability)
    ))
    : new Set(liveAllowed);
}

export function collectSideEffectToolNames(
  tools: readonly Pick<ToolDefinition, "name" | "side_effects">[],
): string[] {
  return tools
    .filter((tool) => tool.side_effects === true)
    .map((tool) => tool.name);
}

export async function createToolExecutor(
  env: Env,
  db: SqlDatabaseBinding,
  storage: ObjectStoreBinding | undefined,
  spaceId: string,
  threadId: string,
  runId: string,
  userId: string,
  options?: ToolExecutorSetupOptions,
  toolExecutionTimeoutMs?: number,
  runAbortSignal?: AbortSignal,
): Promise<ToolExecutor> {
  const { allowed: liveAllowed } = await resolveAllowedCapabilities({
    db,
    spaceId,
    userId,
  });
  if (
    options?.runAuthority &&
    (options.runAuthority.runId !== runId ||
      options.runAuthority.workspaceId !== spaceId ||
      options.runAuthority.threadId !== threadId)
  ) {
    throw new Error("Run authority does not match the tool execution context");
  }
  const frozenCapabilities = options?.runAuthority?.capabilities;
  const allowed = selectEffectiveRunCapabilities(
    liveAllowed,
    frozenCapabilities,
  );

  const { runAuthority: _runAuthority, ...resolverOptions } = options ?? {};

  const resolver = await createToolResolver(db, spaceId, env, {
    ...resolverOptions,
    mcpExposureContext: {
      capabilities: Array.from(allowed),
    },
  });

  const context: ToolContext = {
    spaceId,
    threadId,
    runId,
    userId,
    ...(options?.runAuthority ? { runAuthority: options.runAuthority } : {}),
    capabilities: Array.from(allowed),
    env,
    db,
    storage,
    abortSignal: runAbortSignal,
  };

  const executor = new ToolExecutor(
    resolver,
    context,
    undefined,
    toolExecutionTimeoutMs,
  );
  // Activate the in-run idempotency guard for side-effecting tools: register the
  // set of tool names whose definition declares `side_effects: true`. Combined
  // with `this.db` (set from context in the ToolExecutor constructor), this makes
  // duplicate side-effect calls within a run return the prior result / reject an
  // in-progress duplicate instead of re-provisioning/re-deploying.
  executor.setSideEffectTools(
    collectSideEffectToolNames(resolver.getAvailableTools()),
  );
  const internalContext = context as ToolContext & {
    _toolExecutor?: Pick<ToolExecutor, "execute">;
    _activateSkillManuals?: (
      manuals: readonly SkillManualIdentity[],
      toolCallId: string,
    ) => Promise<ActivatedSkillManual[]>;
    _activateSkillResource?: (
      resource: SkillResourceIdentity,
      toolCallId: string,
    ) => Promise<ActivatedSkillResource>;
    _activateToolDescriptors?: (
      toolNames: readonly string[],
      toolCallId: string,
    ) => Promise<ActivatedToolDescriptor[]>;
  };
  internalContext.capabilityRegistry = buildPerRunCapabilityRegistry(
    executor,
    await loadManualCapabilityDescriptors(
      db,
      options?.runAuthority,
      executor.getAvailableTools().map((tool) => tool.name),
    ),
  );
  internalContext._toolExecutor = executor;
  const runAuthority = options?.runAuthority;
  if (runAuthority) {
    internalContext._activateSkillManuals = async (manuals, toolCallId) =>
      (await activatePinnedSkillInstructions({
        db,
        authority: await loadRunExecutionAuthority({ db, runId }),
        activationEventId: `tool_call:${toolCallId}`,
        manuals,
      })).manuals;
    internalContext._activateSkillResource = async (resource, toolCallId) =>
      (await activatePinnedSkillResource({
        db,
        authority: await loadRunExecutionAuthority({ db, runId }),
        activationEventId: `tool_call:${toolCallId}`,
        resource,
      })).resource;
    internalContext._activateToolDescriptors = async (toolNames, toolCallId) => {
      const byName = new Map(
        executor.getAvailableTools().map((tool) => [tool.name, tool]),
      );
      const tools = toolNames.map((name) => byName.get(name));
      if (tools.some((tool) => tool === undefined)) {
        throw new Error("Tool descriptor activation target is unavailable");
      }
      return (await activateToolDescriptors({
        db,
        authority: await loadRunExecutionAuthority({ db, runId }),
        activationEventId: `tool_call:${toolCallId}:descriptor`,
        tools: tools.filter((tool): tool is ToolDefinition => tool !== undefined),
      })).descriptors;
    };
  }

  return executor;
}

async function loadManualCapabilityDescriptors(
  db: SqlDatabaseBinding,
  runAuthority: RunExecutionAuthority | undefined,
  availableToolNames: string[],
): Promise<CapabilityDescriptor[]> {
  if (!runAuthority) return [];
  const plan = await loadPinnedSkillPlan({ db, authority: runAuthority });
  if (!plan) return [];
  const availableMcpServerNames = (await listMcpServers(
    db,
    runAuthority.workspaceId,
  )).filter((server) => server.enabled).map((server) => server.name);
  const availableTemplateIds = listSkillTemplates().map((template) =>
    template.id
  );
  return plan.skillRevisions.map(({ skill, resources }) => {
    const availability = evaluateSkillAvailability(skill, {
      availableToolNames,
      availableMcpServerNames,
      availableTemplateIds,
    });
    return buildPinnedSkillDescriptor(
      {
        ...skill,
        availability: availability.availability,
        availability_reasons: availability.availability_reasons,
      },
      resources.map((resource) => resource.manifest),
    );
  });
}
