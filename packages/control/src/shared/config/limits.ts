/**
 * System Limits -- Centralized configuration for all size/count limits.
 *
 * Consolidates hardcoded constants from executor.ts, web.ts,
 * deployment/service.ts, and other modules.
 */

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/** Maximum size of a single tool output (bytes). */
export const MAX_TOOL_OUTPUT_SIZE = 10 * 1024 * 1024; // 10 MB

/** Maximum number of tools executed in parallel within a single step. */
export const MAX_PARALLEL_TOOL_EXECUTIONS = 5;

/** Hard cap on the total number of tool calls allowed in a single run. */
export const MAX_TOTAL_TOOL_CALLS_PER_RUN = 1000;

/** Number of recent tool executions retained in the history window. */
export const MAX_TOOL_EXECUTIONS_HISTORY = 50;

// ---------------------------------------------------------------------------
// Web fetch
// ---------------------------------------------------------------------------

/** Maximum allowed response body size for web-fetch operations (bytes). */
export const MAX_WEB_RESPONSE_SIZE = 25 * 1024 * 1024; // 25 MB

/** Timeout for a single web-fetch request (ms). */
export const WEB_FETCH_TIMEOUT_MS = 300_000; // 5 min

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/** Maximum iterations the agent loop may perform before aborting. */
export const MAX_AGENT_ITERATIONS = 10_000;

/** Default sampling temperature for agent LLM calls. */
export const DEFAULT_AGENT_TEMPERATURE = 0.5;

/** Tolerable consecutive event-emission errors before the run is aborted. */
export const MAX_EVENT_EMISSION_ERRORS = 10;

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/** Maximum active claims in the memory activation graph. */
export const MAX_ACTIVE_CLAIMS = 50;

/** Maximum memories stored per workspace. */
export const MAX_MEMORIES_PER_WORKSPACE = 10_000;

/** Exponential decay rate applied to memory relevance scores. */
export const MEMORY_DECAY_RATE = 0.001;

/** Number of agent turns between automatic memory extraction. */
export const AUTO_EXTRACT_INTERVAL = 10;

// ---------------------------------------------------------------------------
// Thread context
// ---------------------------------------------------------------------------

/** Top-K results retrieved during thread-context similarity search. */
export const THREAD_RETRIEVAL_TOP_K = 8;

/** Minimum cosine-similarity score to include a thread context chunk. */
export const THREAD_RETRIEVAL_MIN_SCORE = 0.35;

/** Maximum character budget for injected thread context. */
export const THREAD_CONTEXT_MAX_CHARS = 12_000;

// ---------------------------------------------------------------------------
// AI / Embeddings
// ---------------------------------------------------------------------------

/** Default embedding model used across all services (Cloudflare Workers AI). */
export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

/** Default vector dimensions for Vectorize indexes. */
export const VECTORIZE_DEFAULT_DIMENSIONS = 1536;

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** Maximum retry attempts for a single deployment step. */
export const MAX_DEPLOYMENT_STEP_RETRIES = 3;

// ---------------------------------------------------------------------------
// Pagination defaults
// ---------------------------------------------------------------------------

/** Default page size when the caller does not specify a limit. */
export const DEFAULT_PAGE_LIMIT = 20;

/** Absolute maximum page size to prevent excessive DB reads. */
export const MAX_PAGE_LIMIT = 100;

/** Default offset (first page). */
export const DEFAULT_PAGE_OFFSET = 0;
