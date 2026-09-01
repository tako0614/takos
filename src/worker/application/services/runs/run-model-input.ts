import type { AgentMessage } from "../agent/agent-models.ts";
import { getAgentConfig } from "../agent/runner-config.ts";
import type { Env } from "../../../shared/types/index.ts";
import { readRunInputCapsuleContext } from "../../../shared/utils/run-input.ts";
import {
  computeAgentProfileRevision,
  computeSystemPromptRevision,
} from "./run-context-identities.ts";
import {
  loadRunExecutionAuthority,
  type RunAuthorityAttestation,
  type RunExecutionBudgets,
} from "./run-authority.ts";
import {
  resolvePinnedRunModelInputProjection,
  TurnProjectionUnavailableError,
} from "../agent/memory-projection.ts";

export class RunModelInputUnavailableError extends Error {
  readonly code = "run_model_input_unavailable" as const;

  constructor(message = "Run model input no longer matches its context") {
    super(message);
    this.name = "RunModelInputUnavailableError";
  }
}

export type ResolvedRunModelInput = {
  runAuthority: RunAuthorityAttestation;
  bootstrap: {
    status: "running";
    spaceId: string;
    capsuleId?: string;
    runtimeNamespace?: string;
    threadId: string;
    userId: string;
    agentType: string;
  };
  modelId: string;
  config: {
    agentType: string;
    systemPrompt: string;
    maxGraphSteps: number;
    maxToolRounds: number;
    temperature: number | null;
  };
  history: AgentMessage[];
  transcriptCutSequence: number;
};

function validBudgets(budgets: RunExecutionBudgets): boolean {
  return Number.isSafeInteger(budgets.maxGraphSteps) &&
    budgets.maxGraphSteps >= 1 && budgets.maxGraphSteps <= 128 &&
    Number.isSafeInteger(budgets.maxToolRounds) &&
    budgets.maxToolRounds >= 1 && budgets.maxToolRounds <= 16;
}

/**
 * Resolve all immutable model-input identity owned by one RunContext revision.
 *
 * Mutable summaries, vector hits, post-cut messages, provider credentials,
 * tools, and Skill content are deliberately outside this interface. Tools and
 * Skills have their own live-narrowing interfaces until their immutable
 * descriptor/revision cutovers are complete.
 */
export async function resolveRunModelInput(params: {
  env: Env;
  runId: string;
}): Promise<ResolvedRunModelInput> {
  let authority = await loadRunExecutionAuthority({
    db: params.env.DB,
    runId: params.runId,
  });
  const identity = authority.modelInput;
  if (!identity || !validBudgets(authority.budgets)) {
    throw new RunModelInputUnavailableError(
      "RunContext does not contain exact model-input identity",
    );
  }

  const config = getAgentConfig(identity.agentType, params.env);
  if (!config.systemPrompt.trim()) {
    throw new RunModelInputUnavailableError("System prompt is unavailable");
  }
  const systemPromptRevision = await computeSystemPromptRevision(
    config.systemPrompt,
  );
  const agentProfileRevision = await computeAgentProfileRevision({
    agentType: config.type,
    systemPromptRevision,
    temperature: config.temperature,
    budgets: authority.budgets,
  });
  if (
    systemPromptRevision !== identity.systemPromptRevision ||
    agentProfileRevision !== identity.agentProfileRevision
  ) {
    throw new RunModelInputUnavailableError(
      "RunContext prompt or profile revision is no longer available",
    );
  }

  let projection;
  try {
    projection = await resolvePinnedRunModelInputProjection({
      env: params.env,
      authority,
    });
  } catch (error) {
    if (error instanceof TurnProjectionUnavailableError) {
      throw new RunModelInputUnavailableError(error.message);
    }
    throw error;
  }
  authority = projection.authority;

  return {
    runAuthority: authority.attestation,
    bootstrap: {
      status: "running",
      spaceId: authority.workspaceId,
      ...readRunInputCapsuleContext(identity.runInputJson),
      threadId: authority.threadId,
      userId: authority.principalId,
      agentType: config.type,
    },
    modelId: identity.modelId,
    config: {
      agentType: config.type,
      systemPrompt: config.systemPrompt,
      maxGraphSteps: authority.budgets.maxGraphSteps,
      maxToolRounds: authority.budgets.maxToolRounds,
      temperature: config.temperature ?? null,
    },
    history: projection.history,
    transcriptCutSequence: projection.transcriptCutSequence,
  };
}
