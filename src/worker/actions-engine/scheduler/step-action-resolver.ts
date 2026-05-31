import type { ActionResolver, StepResult } from "../workflow-models.ts";

const BUILT_IN_NOOP_ACTIONS = new Set([
  "actions/checkout",
  "actions/setup-node",
]);

export const defaultActionResolver: ActionResolver = (uses: string) => {
  const normalizedUses = uses.trim().toLowerCase();
  const actionName = normalizedUses.split("@")[0];

  if (BUILT_IN_NOOP_ACTIONS.has(actionName)) {
    return Promise.resolve({
      run: (step, context): Promise<StepResult> => {
        const outputs: Record<string, string> = {};

        // actions/checkout の path 出力を参照する workflow を通す
        if (actionName === "actions/checkout") {
          const configuredPath =
            typeof step.with?.path === "string" && step.with.path.length > 0
              ? step.with.path
              : context.github.workspace;
          outputs.path = configuredPath;
        }

        return Promise.resolve({
          id: step.id,
          name: step.name,
          status: "completed",
          conclusion: "success",
          outputs,
        });
      },
    });
  }

  return Promise.resolve({
    run: (): Promise<StepResult> =>
      Promise.reject(
        new Error(
          `Unsupported action: ${uses}. Provide StepRunnerOptions.actionResolver or run through runtime-service managed actions.`,
        ),
      ),
  });
};
