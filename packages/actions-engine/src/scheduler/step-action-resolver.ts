import type { ActionResolver, StepResult } from "../workflow-models.ts";

const BUILTIN_NOOP_ACTIONS = new Set([
  "actions/checkout",
  "actions/setup-node",
]);

export const defaultActionResolver: ActionResolver = async (uses: string) => {
  const normalizedUses = uses.trim().toLowerCase();
  const actionName = normalizedUses.split("@")[0];

  if (BUILTIN_NOOP_ACTIONS.has(actionName)) {
    return {
      run: async (step, context): Promise<StepResult> => {
        const outputs: Record<string, string> = {};

        // steps.<id>.outputs.path を参照する workflow 互換性を維持
        if (actionName === "actions/checkout") {
          const configuredPath =
            typeof step.with?.path === "string" && step.with.path.length > 0
              ? step.with.path
              : context.github.workspace;
          outputs.path = configuredPath;
        }

        return {
          id: step.id,
          name: step.name,
          status: "completed",
          conclusion: "success",
          outputs,
        };
      },
    };
  }

  return {
    run: async (): Promise<StepResult> => {
      throw new Error(
        `Unsupported action: ${uses}. Provide StepRunnerOptions.actionResolver for action steps.`,
      );
    },
  };
};
