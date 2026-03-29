/**
 * System Limits -- Centralized configuration for all size/count limits.
 *
 * Consolidates hardcoded constants from executor.ts, web.ts,
 * deployment/service.ts, and other modules.
 */
/** Maximum size of a single tool output (bytes). */
export declare const MAX_TOOL_OUTPUT_SIZE: number;
/** Maximum number of tools executed in parallel within a single step. */
export declare const MAX_PARALLEL_TOOL_EXECUTIONS = 5;
/** Hard cap on the total number of tool calls allowed in a single run. */
export declare const MAX_TOTAL_TOOL_CALLS_PER_RUN = 1000;
/** Number of recent tool executions retained in the history window. */
export declare const MAX_TOOL_EXECUTIONS_HISTORY = 50;
/** Maximum allowed response body size for web-fetch operations (bytes). */
export declare const MAX_WEB_RESPONSE_SIZE: number;
/** Timeout for a single web-fetch request (ms). */
export declare const WEB_FETCH_TIMEOUT_MS = 300000;
/** Maximum iterations the agent loop may perform before aborting. */
export declare const MAX_AGENT_ITERATIONS = 10000;
/** Default sampling temperature for agent LLM calls. */
export declare const DEFAULT_AGENT_TEMPERATURE = 0.5;
/** Tolerable consecutive event-emission errors before the run is aborted. */
export declare const MAX_EVENT_EMISSION_ERRORS = 10;
/** Maximum active claims in the memory activation graph. */
export declare const MAX_ACTIVE_CLAIMS = 50;
/** Maximum memories stored per workspace. */
export declare const MAX_MEMORIES_PER_WORKSPACE = 10000;
/** Exponential decay rate applied to memory relevance scores. */
export declare const MEMORY_DECAY_RATE = 0.001;
/** Number of agent turns between automatic memory extraction. */
export declare const AUTO_EXTRACT_INTERVAL = 10;
/** Top-K results retrieved during thread-context similarity search. */
export declare const THREAD_RETRIEVAL_TOP_K = 8;
/** Minimum cosine-similarity score to include a thread context chunk. */
export declare const THREAD_RETRIEVAL_MIN_SCORE = 0.35;
/** Maximum character budget for injected thread context. */
export declare const THREAD_CONTEXT_MAX_CHARS = 12000;
/** Default embedding model used across all services (Cloudflare Workers AI). */
export declare const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
/** Default vector dimensions for Vectorize indexes. */
export declare const VECTORIZE_DEFAULT_DIMENSIONS = 1536;
/** Maximum retry attempts for a single deployment step. */
export declare const MAX_DEPLOYMENT_STEP_RETRIES = 3;
/** Maximum worker bundle size for deployments (Cloudflare Workers paid plan limit). */
export declare const MAX_BUNDLE_SIZE_BYTES: number;
/** Maximum total bytes scanned per repository search request. */
export declare const GIT_SEARCH_MAX_TOTAL_BYTES: number;
/** Maximum single file size for repository search. */
export declare const GIT_SEARCH_MAX_FILE_BYTES: number;
/** Maximum single file size for diff and blame operations. */
export declare const GIT_DIFF_MAX_FILE_BYTES: number;
/** Maximum line count for diff and blame operations. */
export declare const GIT_DIFF_MAX_LINES = 2000;
/** Maximum number of files in a single diff payload. */
export declare const GIT_DIFF_MAX_FILES = 200;
/** Maximum commits walked during blame. */
export declare const GIT_BLAME_MAX_COMMITS = 200;
/** Maximum commits replayed during a rebase merge. */
export declare const GIT_REBASE_MAX_COMMITS = 200;
/** Maximum request body size for Git smart HTTP endpoints. */
export declare const MAX_GIT_REQUEST_BODY_BYTES: number;
/** Lease duration for the per-repo push lock (ms). */
export declare const GIT_PUSH_LOCK_LEASE_MS: number;
/** Maximum object candidates considered during repo cleanup. */
export declare const MAX_REPO_OBJECT_CLEANUP_CANDIDATES = 25000;
/** Default chunk size when reading action logs without an explicit limit. */
export declare const DEFAULT_LOG_CHUNK_BYTES: number;
/** Maximum chunk size for a single action log read. */
export declare const MAX_LOG_CHUNK_BYTES: number;
/** Maximum character length for a release asset filename. */
export declare const MAX_RELEASE_ASSET_FILENAME_LENGTH = 180;
/** Maximum run events returned in a single observation response. */
export declare const MAX_EVENTS_PER_RESPONSE = 2000;
/** Maximum items in a bulk storage operation. */
export declare const MAX_BULK_OPERATION_ITEMS = 200;
/** Default page size when the caller does not specify a limit. */
export declare const DEFAULT_PAGE_LIMIT = 20;
/** Absolute maximum page size to prevent excessive DB reads. */
export declare const MAX_PAGE_LIMIT = 100;
/** Default offset (first page). */
export declare const DEFAULT_PAGE_OFFSET = 0;
//# sourceMappingURL=limits.d.ts.map