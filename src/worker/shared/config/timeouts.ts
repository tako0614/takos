/**
 * System Timeouts -- Centralized timeout configuration.
 *
 * All values are in milliseconds unless noted otherwise.
 */

// ---------------------------------------------------------------------------
// Agent tool bridge
// ---------------------------------------------------------------------------

/** Timeout for one Worker-owned tool execution requested by the Rust agent. */
export const AGENT_TOOL_EXECUTION_TIMEOUT_MS = 300_000; // 5 min

// NOTE: Per-tier sleepAfter values are hardcoded as string literals on the
// container DO classes (`runtime/container-hosts/executor-host.ts`,
// `runtime-host.ts`). The previous numeric constants here were never imported
// by those classes, so changing them did nothing. Update the DO class
// properties directly when tuning idle windows.
