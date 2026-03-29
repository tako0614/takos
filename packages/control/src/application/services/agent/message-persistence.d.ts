import type { Env } from '../../../shared/types';
import type { AgentMessage } from './agent-models';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
export interface MessagePersistenceDeps {
    db: SqlDatabaseBinding;
    env: Env;
    threadId: string;
}
export declare function persistMessage(deps: MessagePersistenceDeps, message: AgentMessage, metadata?: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=message-persistence.d.ts.map