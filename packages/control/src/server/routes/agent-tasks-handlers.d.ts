import type { Env, AgentTask, AgentTaskBase, AgentTaskPriority, AgentTaskStatus } from '../../shared/types';
import type { SelectOf } from '../../shared/types/drizzle-utils';
import { agentTasks } from '../../infra/db/schema';
export declare const VALID_STATUSES: readonly ["planned", "in_progress", "blocked", "completed", "cancelled"];
export declare const VALID_PRIORITIES: readonly ["low", "medium", "high", "urgent"];
export declare const DEFAULT_STATUS: AgentTaskStatus;
export declare const DEFAULT_PRIORITY: AgentTaskPriority;
export type AgentTaskRow = SelectOf<typeof agentTasks>;
/** Convert DB camelCase result to snake_case API shape (base fields only) */
export declare function toApiTask(row: AgentTaskRow): AgentTaskBase;
export declare function fetchTask(d1: Env['DB'], taskId: string): Promise<AgentTaskBase | null>;
export declare function enrichTasks(env: Env, tasks: AgentTaskBase[]): Promise<AgentTask[]>;
export declare function enrichTask(env: Env, task: AgentTaskBase): Promise<AgentTask>;
//# sourceMappingURL=agent-tasks-handlers.d.ts.map