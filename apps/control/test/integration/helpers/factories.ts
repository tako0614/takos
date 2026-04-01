/**
 * Test Factories for takos-control
 *
 * Factory functions to create mock objects for testing.
 * All factories return valid objects with sensible defaults that can be overridden.
 */

import type {
  App,
  AppType,
  Memory,
  MemoryType,
  Message,
  MessageRole,
  PullRequest,
  PullRequestStatus,
  Repository,
  RepositoryVisibility,
  Resource,
  ResourceStatus,
  ResourceType,
  Run,
  RunStatus,
  Service,
  ServiceStatus,
  ServiceType,
  Session as _Session,
  Space,
  SpaceMembership,
  SpaceRole,
  Thread,
  ThreadStatus,
  User,
} from "@/types";

// ============================================================================
// Counter for generating unique IDs
// ============================================================================

let idCounter = 0;

function generateId(prefix: string = ""): string {
  return `${prefix}${++idCounter}-${Date.now()}-${
    Math.random().toString(36).substring(7)
  }`;
}

// Reset counter between test runs
export function resetIdCounter(): void {
  idCounter = 0;
}

// ============================================================================
// User Factories
// ============================================================================

export interface UserFactoryOptions {
  id?: string;
  principal_id?: string;
  email?: string;
  name?: string;
  username?: string;
  bio?: string | null;
  picture?: string | null;
  trust_tier?: string;
  setup_completed?: boolean;
  created_at?: string;
  updated_at?: string;
}

export function createUser(options: UserFactoryOptions = {}): User {
  const id = options.id || generateId("user-");
  const principalId = options.principal_id || generateId("principal-");
  const now = new Date().toISOString();

  return {
    id,
    principal_id: principalId,
    email: options.email || `${id}@test.example.com`,
    name: options.name || `Test User ${id}`,
    username: options.username !== undefined
      ? options.username
      : `testuser${idCounter}`,
    bio: options.bio !== undefined ? options.bio : null,
    picture: options.picture !== undefined ? options.picture : null,
    trust_tier: options.trust_tier || "normal",
    setup_completed: options.setup_completed !== undefined
      ? options.setup_completed
      : true,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

// ============================================================================
// Workspace Factories
// ============================================================================

export interface WorkspaceFactoryOptions {
  id?: string;
  kind?: Space["kind"];
  name?: string;
  slug?: string | null;
  principal_id?: string;
  owner_user_id?: string;
  is_personal?: number;
  owner_principal_id?: string;
  automation_principal_id?: string | null;
  head_snapshot_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function createWorkspace(options: WorkspaceFactoryOptions = {}): Space {
  const id = options.id || generateId("ws-");
  const now = new Date().toISOString();
  const kind = options.kind || "team";
  const principalId = options.principal_id || generateId("principal-");
  const ownerUserId = options.owner_user_id || generateId("user-");
  return {
    id,
    kind,
    name: options.name || `Test Workspace ${id}`,
    slug: options.slug !== undefined ? options.slug : null,
    principal_id: principalId,
    owner_user_id: ownerUserId,
    owner_principal_id: options.owner_principal_id || principalId,
    automation_principal_id: options.automation_principal_id !== undefined
      ? options.automation_principal_id
      : null,
    head_snapshot_id: options.head_snapshot_id !== undefined
      ? options.head_snapshot_id
      : null,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

export interface SpaceMemberFactoryOptions {
  id?: string;
  space_id?: string;
  principal_id?: string;
  role?: SpaceRole;
  created_at?: string;
}

export function createSpaceMember(
  options: SpaceMemberFactoryOptions = {},
): SpaceMembership {
  const id = options.id || generateId("wsm-");
  const now = new Date().toISOString();

  return {
    id,
    space_id: options.space_id || generateId("ws-"),
    principal_id: options.principal_id || generateId("principal-"),
    role: options.role || "editor",
    created_at: options.created_at || now,
  };
}

// ============================================================================
// Thread and Message Factories
// ============================================================================

export interface ThreadFactoryOptions {
  id?: string;
  space_id?: string;
  title?: string | null;
  status?: ThreadStatus;
  summary?: string | null;
  key_points?: string;
  retrieval_index?: number;
  context_window?: number;
  created_at?: string;
  updated_at?: string;
}

export function createThread(options: ThreadFactoryOptions = {}): Thread {
  const id = options.id || generateId("thread-");
  const now = new Date().toISOString();

  return {
    id,
    space_id: options.space_id || generateId("ws-"),
    title: options.title !== undefined ? options.title : `Test Thread ${id}`,
    status: options.status || "active",
    summary: options.summary !== undefined ? options.summary : null,
    key_points: options.key_points || "[]",
    retrieval_index: options.retrieval_index ?? -1,
    context_window: options.context_window ?? 50,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

export interface MessageFactoryOptions {
  id?: string;
  thread_id?: string;
  role?: MessageRole;
  content?: string;
  tool_calls?: string | null;
  tool_call_id?: string | null;
  metadata?: string;
  sequence?: number;
  created_at?: string;
}

export function createMessage(options: MessageFactoryOptions = {}): Message {
  const id = options.id || generateId("msg-");
  const now = new Date().toISOString();

  return {
    id,
    thread_id: options.thread_id || generateId("thread-"),
    role: options.role || "user",
    content: options.content || "Test message content",
    tool_calls: options.tool_calls !== undefined ? options.tool_calls : null,
    tool_call_id: options.tool_call_id !== undefined
      ? options.tool_call_id
      : null,
    metadata: options.metadata || "{}",
    sequence: options.sequence || 0,
    created_at: options.created_at || now,
  };
}

// ============================================================================
// Run Factory
// ============================================================================

export interface RunFactoryOptions {
  id?: string;
  thread_id?: string;
  space_id?: string;
  session_id?: string | null;
  parent_run_id?: string | null;
  child_thread_id?: string | null;
  root_thread_id?: string;
  root_run_id?: string | null;
  agent_type?: string;
  status?: RunStatus;
  input?: string;
  output?: string | null;
  error?: string | null;
  usage?: string;
  worker_id?: string | null;
  worker_heartbeat?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
}

export function createRun(options: RunFactoryOptions = {}): Run {
  const id = options.id || generateId("run-");
  const now = new Date().toISOString();
  const threadId = options.thread_id || generateId("thread-");

  return {
    id,
    thread_id: threadId,
    space_id: options.space_id || generateId("ws-"),
    session_id: options.session_id !== undefined ? options.session_id : null,
    parent_run_id: options.parent_run_id !== undefined
      ? options.parent_run_id
      : null,
    child_thread_id: options.child_thread_id !== undefined
      ? options.child_thread_id
      : null,
    root_thread_id: options.root_thread_id || threadId,
    root_run_id: options.root_run_id !== undefined ? options.root_run_id : id,
    agent_type: options.agent_type || "default",
    status: options.status || "queued",
    input: options.input || "{}",
    output: options.output !== undefined ? options.output : null,
    error: options.error !== undefined ? options.error : null,
    usage: options.usage || "{}",
    worker_id: options.worker_id !== undefined ? options.worker_id : null,
    worker_heartbeat: options.worker_heartbeat !== undefined
      ? options.worker_heartbeat
      : null,
    started_at: options.started_at !== undefined ? options.started_at : null,
    completed_at: options.completed_at !== undefined
      ? options.completed_at
      : null,
    created_at: options.created_at || now,
  };
}

// ============================================================================
// Memory Factory
// ============================================================================

export interface MemoryFactoryOptions {
  id?: string;
  space_id?: string;
  user_id?: string | null;
  thread_id?: string | null;
  type?: MemoryType;
  category?: string | null;
  content?: string;
  summary?: string | null;
  importance?: number;
  tags?: string | null;
  occurred_at?: string | null;
  expires_at?: string | null;
  last_accessed_at?: string | null;
  access_count?: number;
  created_at?: string;
  updated_at?: string;
}

export function createMemory(options: MemoryFactoryOptions = {}): Memory {
  const id = options.id || generateId("mem-");
  const now = new Date().toISOString();

  return {
    id,
    space_id: options.space_id || generateId("ws-"),
    user_id: options.user_id !== undefined ? options.user_id : null,
    thread_id: options.thread_id !== undefined ? options.thread_id : null,
    type: options.type || "episode",
    category: options.category !== undefined ? options.category : null,
    content: options.content || "Test memory content",
    summary: options.summary !== undefined ? options.summary : null,
    importance: options.importance !== undefined ? options.importance : 0.5,
    tags: options.tags !== undefined ? options.tags : null,
    occurred_at: options.occurred_at !== undefined ? options.occurred_at : null,
    expires_at: options.expires_at !== undefined ? options.expires_at : null,
    last_accessed_at: options.last_accessed_at !== undefined
      ? options.last_accessed_at
      : null,
    access_count: options.access_count !== undefined ? options.access_count : 0,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

// ============================================================================
// Repository Factory
// ============================================================================

export interface RepositoryFactoryOptions {
  id?: string;
  space_id?: string;
  name?: string;
  description?: string | null;
  visibility?: RepositoryVisibility;
  default_branch?: string;
  forked_from_id?: string | null;
  stars?: number;
  forks?: number;
  git_enabled?: boolean;
  created_at?: string;
  updated_at?: string;
}

export function createRepository(
  options: RepositoryFactoryOptions = {},
): Repository {
  const id = options.id || generateId("repo-");
  const now = new Date().toISOString();

  return {
    id,
    space_id: options.space_id || generateId("ws-"),
    name: options.name || `test-repo-${idCounter}`,
    description: options.description !== undefined ? options.description : null,
    visibility: options.visibility || "private",
    default_branch: options.default_branch || "main",
    forked_from_id: options.forked_from_id !== undefined
      ? options.forked_from_id
      : null,
    stars: options.stars || 0,
    forks: options.forks || 0,
    git_enabled: options.git_enabled !== undefined ? options.git_enabled : true,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

// ============================================================================
// Pull Request Factory
// ============================================================================

export interface PullRequestFactoryOptions {
  id?: string;
  repo_id?: string;
  number?: number;
  title?: string;
  description?: string | null;
  head_branch?: string;
  base_branch?: string;
  status?: PullRequestStatus;
  author_type?: "user" | "agent";
  author_id?: string | null;
  run_id?: string | null;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function createPullRequest(
  options: PullRequestFactoryOptions = {},
): PullRequest {
  const id = options.id || generateId("pr-");
  const now = new Date().toISOString();

  return {
    id,
    repo_id: options.repo_id || generateId("repo-"),
    number: options.number || idCounter,
    title: options.title || `Test PR ${idCounter}`,
    description: options.description !== undefined ? options.description : null,
    head_branch: options.head_branch || `feature/test-${idCounter}`,
    base_branch: options.base_branch || "main",
    status: options.status || "open",
    author_type: options.author_type || "user",
    author_id: options.author_id !== undefined ? options.author_id : null,
    run_id: options.run_id !== undefined ? options.run_id : null,
    merged_at: options.merged_at !== undefined ? options.merged_at : null,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

// ============================================================================
// Worker Factory
// ============================================================================

export interface WorkerFactoryOptions {
  id?: string;
  space_id?: string;
  service_type?: ServiceType;
  status?: ServiceStatus;
  config?: string | null;
  hostname?: string | null;
  service_name?: string | null;
  slug?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function createWorker(options: WorkerFactoryOptions = {}): Service {
  const id = options.id || generateId("worker-");
  const now = new Date().toISOString();

  return {
    id,
    space_id: options.space_id || generateId("ws-"),
    service_type: options.service_type || "app",
    name_type: null,
    status: options.status || "pending",
    config: options.config !== undefined ? options.config : null,
    hostname: options.hostname !== undefined ? options.hostname : null,
    service_name: options.service_name !== undefined
      ? options.service_name
      : null,
    slug: options.slug !== undefined ? options.slug : null,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

// ============================================================================
// Resource Factory
// ============================================================================

export interface ResourceFactoryOptions {
  id?: string;
  owner_id?: string;
  space_id?: string | null;
  name?: string;
  type?: ResourceType;
  status?: ResourceStatus;
  cf_id?: string | null;
  cf_name?: string | null;
  config?: string;
  metadata?: string;
  size_bytes?: number;
  item_count?: number;
  last_used_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function createResource(options: ResourceFactoryOptions = {}): Resource {
  const id = options.id || generateId("res-");
  const now = new Date().toISOString();

  return {
    id,
    owner_id: options.owner_id || generateId("user-"),
    space_id: options.space_id !== undefined ? options.space_id : null,
    name: options.name || `test-resource-${idCounter}`,
    type: options.type || "d1",
    status: options.status || "active",
    provider_resource_id: options.cf_id !== undefined ? options.cf_id : null,
    provider_resource_name: options.cf_name !== undefined
      ? options.cf_name
      : null,
    config: options.config || "{}",
    metadata: options.metadata || "{}",
    size_bytes: options.size_bytes || 0,
    item_count: options.item_count || 0,
    last_used_at: options.last_used_at !== undefined
      ? options.last_used_at
      : null,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

// ============================================================================
// App Factory
// ============================================================================

export interface AppFactoryOptions {
  id?: string;
  space_id?: string;
  worker_id?: string | null;
  name?: string;
  description?: string | null;
  icon?: string | null;
  app_type?: AppType;
  takos_client_key?: string | null;
  created_at?: string;
  updated_at?: string;
}

export function createApp(options: AppFactoryOptions = {}): App {
  const id = options.id || generateId("app-");
  const now = new Date().toISOString();

  return {
    id,
    space_id: options.space_id || generateId("ws-"),
    worker_id: options.worker_id !== undefined ? options.worker_id : null,
    name: options.name || `Test App ${idCounter}`,
    description: options.description !== undefined ? options.description : null,
    icon: options.icon !== undefined ? options.icon : null,
    app_type: options.app_type || "custom",
    takos_client_key: options.takos_client_key !== undefined
      ? options.takos_client_key
      : null,
    created_at: options.created_at || now,
    updated_at: options.updated_at || now,
  };
}

// ============================================================================
// Composite Factories (creates related objects together)
// ============================================================================

export interface UserWithWorkspaceResult {
  user: User;
  workspace: Space;
  member: SpaceMembership;
}

/**
 * Create a user with their personal workspace
 */
export function createUserWithWorkspace(
  userOptions: UserFactoryOptions = {},
  workspaceOptions: WorkspaceFactoryOptions = {},
): UserWithWorkspaceResult {
  const user = createUser(userOptions);
  const workspace = createWorkspace({
    ...workspaceOptions,
    owner_user_id: workspaceOptions.owner_user_id || user.id,
    owner_principal_id: workspaceOptions.owner_principal_id ||
      user.principal_id,
    kind: workspaceOptions.kind || "user",
    name: workspaceOptions.name || `${user.name}'s Workspace`,
  });
  const member = createSpaceMember({
    space_id: workspace.id,
    principal_id: user.principal_id,
    role: "owner",
  });

  return { user, workspace, member };
}

export interface ThreadWithMessagesResult {
  thread: Thread;
  messages: Message[];
}

/**
 * Create a thread with initial messages
 */
export function createThreadWithMessages(
  threadOptions: ThreadFactoryOptions = {},
  messageContents: Array<{ role: MessageRole; content: string }> = [],
): ThreadWithMessagesResult {
  const thread = createThread(threadOptions);
  const messages = messageContents.map((msg, index) =>
    createMessage({
      thread_id: thread.id,
      role: msg.role,
      content: msg.content,
      sequence: index,
    })
  );

  return { thread, messages };
}
