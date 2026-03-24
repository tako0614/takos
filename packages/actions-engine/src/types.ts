/**
 * GitHub Actions compatible workflow type definitions
 */

// =============================================================================
// Trigger Configuration Types
// =============================================================================

/**
 * Branch/tag filter configuration
 */
export interface BranchFilter {
  branches?: string[];
  'branches-ignore'?: string[];
  tags?: string[];
  'tags-ignore'?: string[];
  paths?: string[];
  'paths-ignore'?: string[];
}

/**
 * Pull request event trigger configuration
 */
export interface PullRequestTriggerConfig extends BranchFilter {
  types?: PullRequestEventType[];
}

/**
 * Pull request event types
 */
export type PullRequestEventType =
  | 'opened'
  | 'edited'
  | 'closed'
  | 'reopened'
  | 'synchronize'
  | 'converted_to_draft'
  | 'ready_for_review'
  | 'locked'
  | 'unlocked'
  | 'review_requested'
  | 'review_request_removed'
  | 'auto_merge_enabled'
  | 'auto_merge_disabled';

/**
 * Workflow dispatch input definition
 */
export interface WorkflowDispatchInput {
  description?: string;
  required?: boolean;
  default?: string;
  type?: 'string' | 'boolean' | 'choice' | 'environment';
  options?: string[];
}

/**
 * Workflow dispatch trigger configuration
 */
export interface WorkflowDispatchConfig {
  inputs?: Record<string, WorkflowDispatchInput>;
}

/**
 * Schedule trigger configuration (cron)
 */
export interface ScheduleTriggerConfig {
  cron: string;
}

/**
 * Repository dispatch trigger configuration
 */
export interface RepositoryDispatchConfig {
  types?: string[];
}

/**
 * Workflow call input definition
 */
export interface WorkflowCallInput {
  description?: string;
  required?: boolean;
  default?: string | boolean | number;
  type: 'string' | 'boolean' | 'number';
}

/**
 * Workflow call output definition
 */
export interface WorkflowCallOutput {
  description?: string;
  value: string;
}

/**
 * Workflow call secret definition
 */
export interface WorkflowCallSecret {
  description?: string;
  required?: boolean;
}

/**
 * Workflow call trigger configuration
 */
export interface WorkflowCallConfig {
  inputs?: Record<string, WorkflowCallInput>;
  outputs?: Record<string, WorkflowCallOutput>;
  secrets?: Record<string, WorkflowCallSecret>;
}

/**
 * All possible workflow triggers
 */
export interface WorkflowTrigger {
  push?: BranchFilter | null;
  pull_request?: PullRequestTriggerConfig | null;
  pull_request_target?: PullRequestTriggerConfig | null;
  workflow_dispatch?: WorkflowDispatchConfig | null;
  workflow_call?: WorkflowCallConfig | null;
  schedule?: ScheduleTriggerConfig[];
  repository_dispatch?: RepositoryDispatchConfig | null;
  // Issue events
  issues?: { types?: string[] } | null;
  issue_comment?: { types?: string[] } | null;
  // Release events
  release?: { types?: string[] } | null;
  // Other common events
  create?: null;
  delete?: null;
  fork?: null;
  watch?: { types?: string[] } | null;
}

// =============================================================================
// Step Types
// =============================================================================

/**
 * Step definition
 */
export interface Step {
  /** Step identifier */
  id?: string;
  /** Step display name */
  name?: string;
  /** Action to use (e.g., "actions/checkout@v4") */
  uses?: string;
  /** Shell command to run */
  run?: string;
  /** Working directory for run steps */
  'working-directory'?: string;
  /** Shell to use for run steps */
  shell?: 'bash' | 'pwsh' | 'python' | 'sh' | 'cmd' | 'powershell';
  /** Input parameters for actions */
  with?: Record<string, unknown>;
  /** Environment variables for this step */
  env?: Record<string, string>;
  /** Conditional execution */
  if?: string;
  /** Continue on error */
  'continue-on-error'?: boolean;
  /** Timeout in minutes */
  'timeout-minutes'?: number;
}

// =============================================================================
// Job Types
// =============================================================================

/**
 * Strategy matrix configuration
 * Note: Uses a more flexible type to support both arrays and include/exclude
 */
export type MatrixConfig = Record<string, unknown[] | Record<string, unknown>[]>;

/**
 * Job strategy configuration
 */
export interface JobStrategy {
  matrix?: MatrixConfig;
  'fail-fast'?: boolean;
  'max-parallel'?: number;
}

/**
 * Container configuration
 */
export interface ContainerConfig {
  image: string;
  credentials?: {
    username: string;
    password: string;
  };
  env?: Record<string, string>;
  ports?: (number | string)[];
  volumes?: string[];
  options?: string;
}

/**
 * Job output definition
 */
export type JobOutputs = Record<string, string>;

/**
 * Permissions configuration
 */
export type PermissionLevel = 'read' | 'write' | 'none';
export type Permissions =
  | 'read-all'
  | 'write-all'
  | Record<string, PermissionLevel>;

/**
 * Concurrency configuration
 */
export interface ConcurrencyConfig {
  group: string;
  'cancel-in-progress'?: boolean;
}

/**
 * Job defaults configuration
 */
export interface JobDefaults {
  run?: {
    shell?: string;
    'working-directory'?: string;
  };
}

/**
 * Job definition
 */
export interface Job {
  /** Job display name */
  name?: string;
  /** Runner label or runner group */
  'runs-on': string | string[];
  /** Job dependencies */
  needs?: string | string[];
  /** Conditional execution */
  if?: string;
  /** Environment variables for all steps */
  env?: Record<string, string>;
  /** Job steps */
  steps: Step[];
  /** Job outputs */
  outputs?: JobOutputs;
  /** Build matrix strategy */
  strategy?: JobStrategy;
  /** Container to run job in */
  container?: string | ContainerConfig;
  /** Service containers */
  services?: Record<string, ContainerConfig>;
  /** Timeout in minutes */
  'timeout-minutes'?: number;
  /** Continue workflow on job failure */
  'continue-on-error'?: boolean;
  /** Job permissions */
  permissions?: Permissions;
  /** Concurrency settings */
  concurrency?: string | ConcurrencyConfig;
  /** Default settings for run steps */
  defaults?: JobDefaults;
  /** Environment for deployment */
  environment?: string | { name: string; url?: string };
}

// =============================================================================
// Workflow Types
// =============================================================================

/**
 * Complete workflow definition
 */
export interface Workflow {
  /** Workflow display name */
  name?: string;
  /** Trigger events */
  on: WorkflowTrigger | string | string[];
  /** Global environment variables */
  env?: Record<string, string>;
  /** Job definitions */
  jobs: Record<string, Job>;
  /** Global permissions */
  permissions?: Permissions;
  /** Global concurrency settings */
  concurrency?: string | ConcurrencyConfig;
  /** Default settings for all jobs */
  defaults?: JobDefaults;
}

// =============================================================================
// Execution State Types
// =============================================================================

/**
 * Run status
 */
export type RunStatus = 'queued' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Run conclusion
 */
export type Conclusion = 'success' | 'failure' | 'cancelled' | 'skipped';

/**
 * Step execution result
 */
export interface StepResult {
  /** Step identifier */
  id?: string;
  /** Step name */
  name?: string;
  /** Execution status */
  status: RunStatus;
  /** Final conclusion */
  conclusion?: Conclusion;
  /** Step outputs */
  outputs: Record<string, string>;
  /** Start time */
  startedAt?: Date;
  /** End time */
  completedAt?: Date;
  /** Error message if failed */
  error?: string;
}

/**
 * Job execution result
 */
export interface JobResult {
  /** Job identifier */
  id: string;
  /** Job name */
  name?: string;
  /** Execution status */
  status: RunStatus;
  /** Final conclusion */
  conclusion?: Conclusion;
  /** Step results */
  steps: StepResult[];
  /** Job outputs */
  outputs: Record<string, string>;
  /** Start time */
  startedAt?: Date;
  /** End time */
  completedAt?: Date;
  /** Matrix values if part of matrix build */
  matrix?: Record<string, unknown>;
}

/**
 * Workflow run result
 */
export interface WorkflowResult {
  /** Run ID */
  id: string;
  /** Workflow name */
  name?: string;
  /** Execution status */
  status: RunStatus;
  /** Final conclusion */
  conclusion?: Conclusion;
  /** Job results */
  jobs: Record<string, JobResult>;
  /** Trigger event */
  event: string;
  /** Start time */
  startedAt?: Date;
  /** End time */
  completedAt?: Date;
}

// =============================================================================
// Context Types (for expression evaluation)
// =============================================================================

/**
 * GitHub context
 */
export interface GitHubContext {
  /** Event name that triggered the workflow */
  event_name: string;
  /** Event payload */
  event: Record<string, unknown>;
  /** Git ref (branch or tag) */
  ref: string;
  /** Git ref name (branch or tag name) */
  ref_name: string;
  /** Git SHA */
  sha: string;
  /** Repository owner and name */
  repository: string;
  /** Repository owner */
  repository_owner: string;
  /** Actor (user who triggered) */
  actor: string;
  /** Workflow name */
  workflow: string;
  /** Job name */
  job: string;
  /** Run ID */
  run_id: string;
  /** Run number */
  run_number: number;
  /** Run attempt */
  run_attempt: number;
  /** Server URL */
  server_url: string;
  /** API URL */
  api_url: string;
  /** GraphQL URL */
  graphql_url: string;
  /** Workspace path */
  workspace: string;
  /** Action name */
  action: string;
  /** Action path */
  action_path: string;
  /** Token */
  token: string;
  /** Head ref (for PRs) */
  head_ref?: string;
  /** Base ref (for PRs) */
  base_ref?: string;
}

/**
 * Runner context
 */
export interface RunnerContext {
  /** Runner name */
  name: string;
  /** Runner OS */
  os: 'Linux' | 'Windows' | 'macOS';
  /** Runner architecture */
  arch: 'X86' | 'X64' | 'ARM' | 'ARM64';
  /** Temp directory */
  temp: string;
  /** Tool cache directory */
  tool_cache: string;
  /** Debug mode */
  debug: string;
}

/**
 * Job context
 */
export interface JobContext {
  /** Job status */
  status: 'success' | 'failure' | 'cancelled';
  /** Container information */
  container?: {
    id: string;
    network: string;
  };
  /** Service containers */
  services?: Record<
    string,
    {
      id: string;
      network: string;
      ports: Record<string, string>;
    }
  >;
}

/**
 * Steps context (outputs from previous steps)
 */
export type StepsContext = Record<
  string,
  {
    outputs: Record<string, string>;
    outcome: 'success' | 'failure' | 'cancelled' | 'skipped';
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped';
  }
>;

/**
 * Needs context (outputs from dependent jobs)
 */
export type NeedsContext = Record<
  string,
  {
    outputs: Record<string, string>;
    result: 'success' | 'failure' | 'cancelled' | 'skipped';
  }
>;

/**
 * Strategy context
 */
export interface StrategyContext {
  'fail-fast': boolean;
  'job-index': number;
  'job-total': number;
  'max-parallel': number;
}

/**
 * Matrix context
 */
export type MatrixContext = Record<string, unknown>;

/**
 * Inputs context (workflow_dispatch inputs)
 */
export type InputsContext = Record<string, string | boolean | number>;

/**
 * Complete execution context
 */
export interface ExecutionContext {
  github: GitHubContext;
  env: Record<string, string>;
  vars: Record<string, string>;
  secrets: Record<string, string>;
  runner: RunnerContext;
  job: JobContext;
  steps: StepsContext;
  needs: NeedsContext;
  strategy?: StrategyContext;
  matrix?: MatrixContext;
  inputs?: InputsContext;
}

// =============================================================================
// Parser/Scheduler Types
// =============================================================================

/**
 * Parsed workflow with metadata
 */
export interface ParsedWorkflow {
  /** Parsed workflow */
  workflow: Workflow;
  /** Parse errors/warnings */
  diagnostics: WorkflowDiagnostic[];
}

/**
 * Diagnostic severity
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Workflow diagnostic (error/warning)
 */
export interface WorkflowDiagnostic {
  /** Severity level */
  severity: DiagnosticSeverity;
  /** Error/warning message */
  message: string;
  /** Location in YAML */
  path?: string;
  /** Line number */
  line?: number;
  /** Column number */
  column?: number;
}

/**
 * Job execution order
 */
export interface ExecutionPlan {
  /** Jobs grouped by execution phase (parallel jobs in same phase) */
  phases: string[][];
}

/**
 * Step executor function type
 */
export type StepExecutor = (
  step: Step,
  context: ExecutionContext
) => Promise<StepResult>;

/**
 * Action resolver function type
 */
export type ActionResolver = (
  uses: string
) => Promise<{ run: StepExecutor } | null>;
