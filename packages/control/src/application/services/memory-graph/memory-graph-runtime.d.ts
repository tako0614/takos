import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types';
import type { AgentContext } from '../agent/agent-models';
import type { ActivationResult, Claim, Evidence, ToolObserver } from './graph-models';
export interface AgentMemoryBackend {
    bootstrap(): Promise<ActivationResult>;
    finalize(input: {
        claims: Claim[];
        evidence: Evidence[];
    }): Promise<void>;
}
export declare class AgentMemoryRuntime {
    private db;
    private context;
    private env;
    private overlay;
    private cachedActivation;
    private lastOverlayClaimCount;
    private lastOverlayEvidenceCount;
    private overlayActivationCache;
    private backend?;
    constructor(db: D1Database, context: AgentContext, env: Env, backend?: AgentMemoryBackend);
    bootstrap(): Promise<ActivationResult>;
    beforeModel(): ActivationResult;
    createToolObserver(): ToolObserver;
    finalize(): Promise<void>;
    private flushOverlay;
    private enqueuePathBuildJob;
}
//# sourceMappingURL=memory-graph-runtime.d.ts.map