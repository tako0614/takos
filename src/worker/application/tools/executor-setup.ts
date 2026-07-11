import type { ToolContext } from "./tool-definitions.ts";
import type { Env } from "../../shared/types/index.ts";
import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../shared/types/bindings.ts";
import { createToolResolver, type ToolResolverOptions } from "./resolver.ts";
import { resolveAllowedCapabilities } from "../services/platform/capabilities.ts";
import { logWarn } from "../../shared/utils/logger.ts";
import { ToolExecutor } from "./executor.ts";
import { buildPerRunCapabilityRegistry } from "./executor-utils.ts";
import {
  buildCustomSkillDescriptor,
  buildSkillDescriptor,
} from "./descriptor-builder.ts";
import type { CapabilityDescriptor } from "./capability-types.ts";
import type { ToolDefinition } from "./tool-definitions.ts";
import {
  listLocalizedManagedSkills,
  resolveSkillLocale,
} from "../services/agent/managed-skills.ts";
import { listEnabledCustomSkillContext } from "../services/source/skills.ts";
import { getSpaceLocale } from "../services/identity/locale.ts";

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
  options?: ToolResolverOptions,
  toolExecutionTimeoutMs?: number,
  runAbortSignal?: AbortSignal,
): Promise<ToolExecutor> {
  const { ctx, allowed } = await resolveAllowedCapabilities({
    db,
    spaceId,
    userId,
  });

  const resolver = await createToolResolver(db, spaceId, env, {
    ...options,
    mcpExposureContext: {
      role: ctx.role,
      capabilities: Array.from(allowed),
    },
  });

  const context: ToolContext = {
    spaceId,
    threadId,
    runId,
    userId,
    role: ctx.role,
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
  };
  internalContext.capabilityRegistry = buildPerRunCapabilityRegistry(
    executor,
    await loadManualCapabilityDescriptors(db, spaceId),
  );
  internalContext._toolExecutor = executor;

  return executor;
}

async function loadManualCapabilityDescriptors(
  db: SqlDatabaseBinding,
  spaceId: string,
): Promise<CapabilityDescriptor[]> {
  try {
    const locale = resolveSkillLocale({
      preferredLocale: await getSpaceLocale(db, spaceId),
    });
    const managedManuals =
      listLocalizedManagedSkills(locale).map(buildSkillDescriptor);
    const customManuals = (
      await listEnabledCustomSkillContext(db, spaceId)
    ).map((skill) =>
      buildCustomSkillDescriptor({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        triggers: skill.triggers,
        category: skill.category,
        activation_tags: skill.activation_tags,
        execution_contract: skill.execution_contract,
      }),
    );
    return [...managedManuals, ...customManuals];
  } catch (error) {
    logWarn("Failed to load manual descriptors for toolbox", {
      module: "tools/executor",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
