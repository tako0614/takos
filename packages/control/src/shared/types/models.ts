export type PrincipalKind = 'user' | 'space_agent' | 'service' | 'system' | 'tenant_worker';

export interface Principal {
  id: string;
  type: PrincipalKind;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  principal_id?: string;
  email: string;
  name: string;
  username: string;
  principal_kind?: PrincipalKind;
  bio: string | null;
  picture: string | null;
  trust_tier: string;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

export interface OIDCState {
  state: string;
  nonce: string;
  code_verifier: string;
  return_to: string;
  expires_at: number;
  cli_callback?: string;
}

export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type SpaceKind = 'user' | 'team' | 'system';
export type SecurityPosture = 'standard' | 'restricted_egress';

export interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
  slug: string | null;
  description?: string | null;
  principal_id?: string;
  owner_user_id?: string;
  owner_principal_id: string;
  automation_principal_id?: string | null;
  head_snapshot_id?: string | null;
  ai_model?: string | null;
  ai_provider?: string | null;
  security_posture?: SecurityPosture;
  created_at: string;
  updated_at: string;
}

export interface SpaceMembership {
  id: string;
  space_id: string;
  principal_id: string;
  role: SpaceRole;
  created_at: string;
}

export type FileOrigin = 'user' | 'ai' | 'system';
export type FileKind = 'source' | 'config' | 'doc' | 'asset' | 'artifact' | 'temp';
export type FileVisibility = 'private' | 'workspace' | 'public';

export interface SpaceFile {
  id: string;
  space_id: string;
  path: string;
  sha256: string | null;
  mime_type: string | null;
  size: number;
  origin: FileOrigin;
  kind: FileKind;
  visibility?: FileVisibility;
  indexed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type ThreadStatus = 'active' | 'archived' | 'deleted';

export interface Thread {
  id: string;
  space_id: string;
  title: string | null;
  locale?: 'ja' | 'en' | null;
  status: ThreadStatus;
  summary?: string | null;
  key_points?: string;
  retrieval_index?: number;
  context_window?: number;
  created_at: string;
  updated_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string;
  sequence: number;
  created_at: string;
}

export interface ToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  error?: string;
  duration_ms?: number;
}

export type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Run {
  id: string;
  thread_id: string;
  space_id: string;
  session_id: string | null;
  parent_run_id: string | null;
  child_thread_id: string | null;
  root_thread_id: string;
  root_run_id: string | null;
  agent_type: string;
  status: RunStatus;
  input: string;
  output: string | null;
  error: string | null;
  usage: string;
  worker_id: string | null;
  worker_heartbeat: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export type AgentTaskStatus = 'planned' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export type AgentTaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Core DB-mapped properties for an agent task. */
export interface AgentTaskBase {
  id: string;
  space_id: string;
  created_by: string | null;
  thread_id: string | null;
  last_run_id: string | null;
  title: string;
  description: string | null;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
  agent_type: string;
  model: string | null;
  plan: string | null;
  due_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Enriched agent task returned from list/detail API endpoints. */
export interface AgentTask extends AgentTaskBase {
  thread_title: string | null;
  latest_run: AgentTaskRunSummary | null;
  resume_target: AgentTaskResumeTarget | null;
}

export type ArtifactType = 'code' | 'config' | 'doc' | 'patch' | 'report' | 'other';

export interface Artifact {
  id: string;
  run_id: string;
  space_id: string;
  type: ArtifactType;
  title: string | null;
  content: string | null;
  file_id: string | null;
  metadata: string;
  created_at: string;
}

export interface AgentTaskRunSummary {
  run_id: string;
  status: RunStatus;
  agent_type: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  error: string | null;
  artifact_count: number;
}

export interface AgentTaskResumeTarget {
  thread_id: string;
  run_id: string | null;
  reason: 'active' | 'failed' | 'latest' | 'thread';
}

export interface ThreadHistoryArtifactSummary {
  id: string;
  run_id: string;
  type: ArtifactType;
  title: string | null;
  file_id: string | null;
  created_at: string;
}

export interface ThreadHistoryEvent {
  id: number;
  run_id: string;
  type: string;
  data: string;
  created_at: string;
}

export interface ThreadHistoryChildRunSummary {
  run_id: string;
  thread_id: string;
  child_thread_id: string | null;
  status: RunStatus;
  agent_type: string;
  created_at: string;
  completed_at: string | null;
}

export interface ThreadHistoryRunNode {
  run: Run;
  artifact_count: number;
  latest_event_at: string;
  artifacts: ThreadHistoryArtifactSummary[];
  events: ThreadHistoryEvent[];
  child_thread_id: string | null;
  child_run_count: number;
  child_runs: ThreadHistoryChildRunSummary[];
}

export interface ThreadHistoryFocus {
  latest_run_id: string | null;
  latest_active_run_id: string | null;
  latest_failed_run_id: string | null;
  latest_completed_run_id: string | null;
  resume_run_id: string | null;
}

export interface ThreadHistoryTaskContext {
  id: string;
  title: string;
  status: AgentTaskStatus;
  priority: AgentTaskPriority;
}

export type MemoryType = 'episode' | 'semantic' | 'procedural';

export interface Memory {
  id: string;
  space_id: string;
  user_id: string | null;
  thread_id: string | null;

  type: MemoryType;
  category: string | null;
  content: string;
  summary: string | null;

  importance: number;

  tags: string | null;

  occurred_at: string | null;
  expires_at: string | null;
  last_accessed_at: string | null;
  access_count: number;

  created_at: string;
  updated_at: string;
}

export type ReminderTriggerType = 'time' | 'condition' | 'context';
export type ReminderStatus = 'pending' | 'triggered' | 'completed' | 'dismissed';
export type ReminderPriority = 'low' | 'normal' | 'high' | 'critical';

export interface Reminder {
  id: string;
  space_id: string;
  user_id: string | null;

  content: string;
  context: string | null;

  trigger_type: ReminderTriggerType;
  trigger_value: string | null;

  status: ReminderStatus;
  triggered_at: string | null;

  priority: ReminderPriority;

  created_at: string;
  updated_at: string;
}

export type ServiceType = 'app' | 'service';
export type ServiceStatus = 'pending' | 'building' | 'deployed' | 'failed' | 'stopped';

export interface Service {
  id: string;
  space_id: string;
  service_type: ServiceType;
  name_type: string | null;
  status: ServiceStatus;
  config: string | null;
  hostname: string | null;
  service_name: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceBinding {
  id: string;
  service_id: string;
  resource_id: string;
  binding_name: string;
  binding_type: BindingType;
  config: string;
  created_at: string;
}

export type ResourceType =
  | 'd1'
  | 'r2'
  | 'worker'
  | 'kv'
  | 'vectorize'
  | 'queue'
  | 'analyticsEngine'
  | 'analytics_engine'
  | 'workflow'
  | 'durable_object'
  | 'assets';
export type ResourceStatus = 'provisioning' | 'active' | 'failed' | 'deleting' | 'deleted';
export type ResourcePermission = 'read' | 'write' | 'admin';

export interface Resource {
  id: string;
  owner_id: string;
  space_id: string | null;
  name: string;
  type: ResourceType;
  status: ResourceStatus;
  cf_id: string | null;
  cf_name: string | null;
  config: string;
  metadata: string;
  size_bytes?: number;
  item_count?: number;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceAccess {
  id: string;
  resource_id: string;
  space_id: string;
  permission: ResourcePermission;
  granted_by: string | null;
  created_at: string;
}

export type BindingType =
  | 'd1'
  | 'r2'
  | 'kv'
  | 'vectorize'
  | 'queue'
  | 'analyticsEngine'
  | 'analytics_engine'
  | 'workflow'
  | 'service';

export type AppType = 'platform' | 'builtin' | 'custom';

export interface App {
  id: string;
  space_id: string;
  worker_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  app_type: AppType;
  takos_client_key: string | null;
  created_at: string;
  updated_at: string;
}

export type RepositoryVisibility = 'public' | 'private';

export interface Repository {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  visibility: RepositoryVisibility;
  default_branch: string;
  forked_from_id: string | null;
  stars: number;
  forks: number;
  git_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type PullRequestStatus = 'open' | 'merged' | 'closed';
export type AuthorType = 'user' | 'agent';
export type PullRequestCommentAuthorType = 'user' | 'ai';

export interface PullRequest {
  id: string;
  repo_id: string;
  number: number;
  title: string;
  description: string | null;
  head_branch: string;
  base_branch: string;
  status: PullRequestStatus;
  author_type: AuthorType;
  author_id: string | null;
  run_id: string | null;
  merged_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ReviewStatus = 'approved' | 'changes_requested' | 'commented';
export type ReviewerType = 'user' | 'ai';

export interface PullRequestReview {
  id: string;
  pr_id: string;
  reviewer_type: ReviewerType;
  reviewer_id: string | null;
  status: ReviewStatus;
  body: string | null;
  analysis: string | null;
  created_at: string;
}

export interface PullRequestComment {
  id: string;
  pr_id: string;
  author_type: PullRequestCommentAuthorType;
  author_id: string | null;
  content: string;
  file_path: string | null;
  line_number: number | null;
  created_at: string;
}

export type SpaceStorageFileType = 'file' | 'folder';

export interface SpaceStorageFile {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  type: SpaceStorageFileType;
  size: number;
  mime_type: string | null;
  r2_key: string | null;
  sha256: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}
