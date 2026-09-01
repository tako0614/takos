import { deriveClientOperationId } from "../../../shared/utils/client-operation-id.ts";

export interface AgentTaskStartOperationInput {
  taskId: string;
  previousRunId?: string | null;
  content: string;
  agentType: string;
  model?: string | null;
  locale?: "ja" | "en";
}

export async function deriveAgentTaskStartOperationIds(
  input: AgentTaskStartOperationInput,
): Promise<{
  thread: string;
  message: string;
  run: string;
}> {
  const previousRunId = input.previousRunId || "initial";
  const [thread, message, run] = await Promise.all([
    deriveClientOperationId("agent-task-thread:v1", input.taskId),
    deriveClientOperationId(
      "agent-task-message:v1",
      input.taskId,
      previousRunId,
      input.content,
    ),
    deriveClientOperationId(
      "agent-task-run:v1",
      input.taskId,
      previousRunId,
      input.content,
      input.agentType,
      input.model || "workspace-default",
      input.locale || "workspace-default",
    ),
  ]);
  return { thread, message, run };
}
