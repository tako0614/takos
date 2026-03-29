/**
 * System Timeouts -- Centralized timeout configuration.
 *
 * All values are in milliseconds unless noted otherwise.
 */
/** Timeout for a single agent iteration (tool call + LLM round-trip). */
export declare const AGENT_ITERATION_TIMEOUT_MS = 120000;
/** Overall timeout for an entire agent run. */
export declare const AGENT_TOTAL_TIMEOUT_MS = 900000;
/** Timeout for executing a single tool within the agent loop. */
export declare const AGENT_TOOL_EXECUTION_TIMEOUT_MS = 300000;
/** Timeout for the LangGraph-based agent execution path. */
export declare const AGENT_LANGGRAPH_TIMEOUT_MS = 900000;
/** Interval between cancellation-flag checks during long-running runs. */
export declare const CANCEL_CHECK_INTERVAL_MS = 2000;
/** Default timeout when waiting for a delegated sub-agent result. */
export declare const DEFAULT_WAIT_TIMEOUT_MS = 30000;
/** Absolute maximum wait time for delegation. */
export declare const MAX_WAIT_TIMEOUT_MS = 240000;
/** Polling interval while waiting for a delegated result. */
export declare const WAIT_POLL_INTERVAL_MS = 1000;
/** Maximum time to wait for a "pending clear" operation to complete. */
export declare const MAX_PENDING_CLEAR_WAIT_MS: number;
/** Executor container sleeps after this idle period. */
export declare const SESSION_SLEEP_AFTER_MS: number;
/** Runtime host sleeps after this idle period. */
export declare const RUNTIME_SLEEP_AFTER_MS: number;
/** Workers idle longer than this threshold are considered stale. */
export declare const STALE_WORKER_THRESHOLD_MS: number;
/** Batch size when scanning for stale runs. */
export declare const STALE_RUN_BATCH_SIZE = 50;
/** Interval between WebSocket heartbeat pings. */
export declare const WS_HEARTBEAT_INTERVAL_MS: number;
//# sourceMappingURL=timeouts.d.ts.map