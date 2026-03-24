/**
 * System Timeouts -- Centralized timeout configuration.
 *
 * All values are in milliseconds unless noted otherwise.
 */

// ---------------------------------------------------------------------------
// Agent runner
// ---------------------------------------------------------------------------

/** Timeout for a single agent iteration (tool call + LLM round-trip). */
export const AGENT_ITERATION_TIMEOUT_MS = 120_000; // 2 min

/** Overall timeout for an entire agent run. */
export const AGENT_TOTAL_TIMEOUT_MS = 900_000; // 15 min

/** Timeout for executing a single tool within the agent loop. */
export const AGENT_TOOL_EXECUTION_TIMEOUT_MS = 300_000; // 5 min

/** Timeout for the LangGraph-based agent execution path. */
export const AGENT_LANGGRAPH_TIMEOUT_MS = 900_000; // 15 min

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/** Interval between cancellation-flag checks during long-running runs. */
export const CANCEL_CHECK_INTERVAL_MS = 2_000;

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

/** Default timeout when waiting for a delegated sub-agent result. */
export const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

/** Absolute maximum wait time for delegation. */
export const MAX_WAIT_TIMEOUT_MS = 240_000;

/** Polling interval while waiting for a delegated result. */
export const WAIT_POLL_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Maximum time to wait for a "pending clear" operation to complete. */
export const MAX_PENDING_CLEAR_WAIT_MS = 5 * 60 * 1_000;

/** Executor container sleeps after this idle period. */
export const SESSION_SLEEP_AFTER_MS = 5 * 60 * 1_000;

/** Runtime host sleeps after this idle period. */
export const RUNTIME_SLEEP_AFTER_MS = 10 * 60 * 1_000;

// ---------------------------------------------------------------------------
// Stale detection
// ---------------------------------------------------------------------------

/** Workers idle longer than this threshold are considered stale. */
export const STALE_WORKER_THRESHOLD_MS = 5 * 60 * 1_000;

/** Batch size when scanning for stale runs. */
export const STALE_RUN_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

/** Interval between WebSocket heartbeat pings. */
export const WS_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1_000;
