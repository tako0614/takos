import type { CapabilityNamespace, RiskLevel } from "./capability-types.ts";

type ToolNamespaceMeta = {
  namespace: CapabilityNamespace;
  family: string;
  risk_level: RiskLevel;
  side_effects: boolean;
};

export const TOOL_NAMESPACE_MAP: Record<string, ToolNamespaceMeta> = {
  container_start: {
    namespace: "container",
    family: "container.lifecycle",
    risk_level: "medium",
    side_effects: true,
  },
  container_status: {
    namespace: "container",
    family: "container.lifecycle",
    risk_level: "none",
    side_effects: false,
  },
  container_commit: {
    namespace: "container",
    family: "container.lifecycle",
    risk_level: "medium",
    side_effects: true,
  },
  container_stop: {
    namespace: "container",
    family: "container.lifecycle",
    risk_level: "medium",
    side_effects: true,
  },

  create_repository: {
    namespace: "repo",
    family: "repo.manage",
    risk_level: "medium",
    side_effects: true,
  },
  repo_list: {
    namespace: "repo",
    family: "repo.manage",
    risk_level: "none",
    side_effects: false,
  },
  repo_status: {
    namespace: "repo",
    family: "repo.manage",
    risk_level: "none",
    side_effects: false,
  },
  repo_switch: {
    namespace: "repo",
    family: "repo.manage",
    risk_level: "low",
    side_effects: true,
  },
  repo_fork: {
    namespace: "repo",
    family: "repo.manage",
    risk_level: "medium",
    side_effects: true,
  },
  store_search: {
    namespace: "repo",
    family: "repo.search",
    risk_level: "none",
    side_effects: false,
  },

  file_read: {
    namespace: "file",
    family: "file.ops",
    risk_level: "none",
    side_effects: false,
  },
  file_write: {
    namespace: "file",
    family: "file.ops",
    risk_level: "low",
    side_effects: true,
  },
  file_write_binary: {
    namespace: "file",
    family: "file.ops",
    risk_level: "low",
    side_effects: true,
  },
  file_list: {
    namespace: "file",
    family: "file.ops",
    risk_level: "none",
    side_effects: false,
  },
  file_delete: {
    namespace: "file",
    family: "file.ops",
    risk_level: "low",
    side_effects: true,
  },
  file_mkdir: {
    namespace: "file",
    family: "file.ops",
    risk_level: "none",
    side_effects: true,
  },
  file_rename: {
    namespace: "file",
    family: "file.ops",
    risk_level: "low",
    side_effects: true,
  },
  file_copy: {
    namespace: "file",
    family: "file.ops",
    risk_level: "none",
    side_effects: true,
  },

  space_files_list: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "none",
    side_effects: false,
  },
  space_files_read: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "none",
    side_effects: false,
  },
  space_files_write: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "low",
    side_effects: true,
  },
  space_files_create: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "low",
    side_effects: true,
  },
  space_files_mkdir: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "none",
    side_effects: true,
  },
  space_files_delete: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "low",
    side_effects: true,
  },
  space_files_rename: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "low",
    side_effects: true,
  },
  space_files_move: {
    namespace: "space.files",
    family: "space.files.ops",
    risk_level: "low",
    side_effects: true,
  },

  deploy_frontend: {
    namespace: "deploy",
    family: "deploy.release",
    risk_level: "high",
    side_effects: true,
  },
  service_list: {
    namespace: "deploy",
    family: "deploy.services",
    risk_level: "none",
    side_effects: false,
  },
  service_create: {
    namespace: "deploy",
    family: "deploy.services",
    risk_level: "high",
    side_effects: true,
  },
  service_delete: {
    namespace: "deploy",
    family: "deploy.services",
    risk_level: "high",
    side_effects: true,
  },
  deployment_history: {
    namespace: "deploy",
    family: "deploy.release",
    risk_level: "none",
    side_effects: false,
  },
  deployment_get: {
    namespace: "deploy",
    family: "deploy.release",
    risk_level: "none",
    side_effects: false,
  },
  deployment_rollback: {
    namespace: "deploy",
    family: "deploy.release",
    risk_level: "high",
    side_effects: true,
  },
  service_env_get: {
    namespace: "deploy",
    family: "deploy.service.config",
    risk_level: "none",
    side_effects: false,
  },
  service_env_set: {
    namespace: "deploy",
    family: "deploy.service.config",
    risk_level: "medium",
    side_effects: true,
  },
  service_runtime_get: {
    namespace: "deploy",
    family: "deploy.service.config",
    risk_level: "none",
    side_effects: false,
  },
  service_runtime_set: {
    namespace: "deploy",
    family: "deploy.service.config",
    risk_level: "medium",
    side_effects: true,
  },
  domain_list: {
    namespace: "deploy",
    family: "deploy.domains",
    risk_level: "none",
    side_effects: false,
  },
  domain_add: {
    namespace: "deploy",
    family: "deploy.domains",
    risk_level: "medium",
    side_effects: true,
  },
  domain_verify: {
    namespace: "deploy",
    family: "deploy.domains",
    risk_level: "low",
    side_effects: true,
  },
  domain_remove: {
    namespace: "deploy",
    family: "deploy.domains",
    risk_level: "medium",
    side_effects: true,
  },

  list_resources: {
    namespace: "platform",
    family: "platform.resources",
    risk_level: "none",
    side_effects: false,
  },

  runtime_exec: {
    namespace: "runtime",
    family: "runtime.exec",
    risk_level: "medium",
    side_effects: true,
  },
  runtime_status: {
    namespace: "runtime",
    family: "runtime.exec",
    risk_level: "none",
    side_effects: false,
  },

  key_value_get: {
    namespace: "storage",
    family: "storage.key_value",
    risk_level: "none",
    side_effects: false,
  },
  key_value_put: {
    namespace: "storage",
    family: "storage.key_value",
    risk_level: "low",
    side_effects: true,
  },
  key_value_delete: {
    namespace: "storage",
    family: "storage.key_value",
    risk_level: "low",
    side_effects: true,
  },
  key_value_list: {
    namespace: "storage",
    family: "storage.key_value",
    risk_level: "none",
    side_effects: false,
  },
  sql_query: {
    namespace: "storage",
    family: "storage.sql",
    risk_level: "medium",
    side_effects: true,
  },
  sql_tables: {
    namespace: "storage",
    family: "storage.sql",
    risk_level: "none",
    side_effects: false,
  },
  sql_describe: {
    namespace: "storage",
    family: "storage.sql",
    risk_level: "none",
    side_effects: false,
  },
  object_store_upload: {
    namespace: "storage",
    family: "storage.object_store",
    risk_level: "low",
    side_effects: true,
  },
  object_store_download: {
    namespace: "storage",
    family: "storage.object_store",
    risk_level: "none",
    side_effects: false,
  },
  object_store_list: {
    namespace: "storage",
    family: "storage.object_store",
    risk_level: "none",
    side_effects: false,
  },
  object_store_delete: {
    namespace: "storage",
    family: "storage.object_store",
    risk_level: "low",
    side_effects: true,
  },
  object_store_info: {
    namespace: "storage",
    family: "storage.object_store",
    risk_level: "none",
    side_effects: false,
  },
  create_sql: {
    namespace: "storage",
    family: "storage.create",
    risk_level: "medium",
    side_effects: true,
  },
  create_key_value: {
    namespace: "storage",
    family: "storage.create",
    risk_level: "medium",
    side_effects: true,
  },
  create_object_store: {
    namespace: "storage",
    family: "storage.create",
    risk_level: "medium",
    side_effects: true,
  },

  skill_list: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "none",
    side_effects: false,
  },
  skill_get: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "none",
    side_effects: false,
  },
  skill_create: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "low",
    side_effects: true,
  },
  skill_update: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "low",
    side_effects: true,
  },
  skill_toggle: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "low",
    side_effects: true,
  },
  skill_delete: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "medium",
    side_effects: true,
  },
  skill_context: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "none",
    side_effects: false,
  },
  skill_catalog: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "none",
    side_effects: false,
  },
  skill_describe: {
    namespace: "space.skills",
    family: "space.skills.ops",
    risk_level: "none",
    side_effects: false,
  },

  group_deployment_snapshot_list: {
    namespace: "space.groups.deployments",
    family: "space.groups.deployments.ops",
    risk_level: "none",
    side_effects: false,
  },
  group_deployment_snapshot_get: {
    namespace: "space.groups.deployments",
    family: "space.groups.deployments.ops",
    risk_level: "none",
    side_effects: false,
  },
  group_deployment_snapshot_deploy_from_repo: {
    namespace: "space.groups.deployments",
    family: "space.groups.deployments.ops",
    risk_level: "high",
    side_effects: true,
  },
  group_deployment_snapshot_remove: {
    namespace: "space.groups.deployments",
    family: "space.groups.deployments.ops",
    risk_level: "high",
    side_effects: true,
  },
  group_deployment_snapshot_rollback: {
    namespace: "space.groups.deployments",
    family: "space.groups.deployments.ops",
    risk_level: "high",
    side_effects: true,
  },

  remember: {
    namespace: "memory",
    family: "memory.core",
    risk_level: "none",
    side_effects: true,
  },
  recall: {
    namespace: "memory",
    family: "memory.core",
    risk_level: "none",
    side_effects: false,
  },
  set_reminder: {
    namespace: "memory",
    family: "memory.core",
    risk_level: "none",
    side_effects: true,
  },
  info_unit_search: {
    namespace: "memory",
    family: "memory.search",
    risk_level: "none",
    side_effects: false,
  },
  repo_graph_search: {
    namespace: "memory",
    family: "memory.graph",
    risk_level: "none",
    side_effects: false,
  },
  repo_graph_neighbors: {
    namespace: "memory",
    family: "memory.graph",
    risk_level: "none",
    side_effects: false,
  },
  repo_graph_lineage: {
    namespace: "memory",
    family: "memory.graph",
    risk_level: "none",
    side_effects: false,
  },
  memory_graph_recall: {
    namespace: "memory",
    family: "memory.graph",
    risk_level: "none",
    side_effects: false,
  },

  web_fetch: {
    namespace: "web",
    family: "web.fetch",
    risk_level: "low",
    side_effects: true,
  },

  create_artifact: {
    namespace: "artifact",
    family: "artifact.create",
    risk_level: "none",
    side_effects: true,
  },
  search: {
    namespace: "artifact",
    family: "artifact.search",
    risk_level: "none",
    side_effects: false,
  },

  spawn_agent: {
    namespace: "agent",
    family: "agent.spawn",
    risk_level: "medium",
    side_effects: true,
  },
  wait_agent: {
    namespace: "agent",
    family: "agent.spawn",
    risk_level: "none",
    side_effects: false,
  },

  mcp_add_server: {
    namespace: "mcp",
    family: "mcp.manage",
    risk_level: "medium",
    side_effects: true,
  },
  mcp_list_servers: {
    namespace: "mcp",
    family: "mcp.manage",
    risk_level: "none",
    side_effects: false,
  },
  mcp_update_server: {
    namespace: "mcp",
    family: "mcp.manage",
    risk_level: "medium",
    side_effects: true,
  },
  mcp_remove_server: {
    namespace: "mcp",
    family: "mcp.manage",
    risk_level: "medium",
    side_effects: true,
  },

  toolbox: {
    namespace: "discovery",
    family: "discovery.toolbox",
    risk_level: "medium",
    side_effects: true,
  },
  capability_search: {
    namespace: "discovery",
    family: "discovery.search",
    risk_level: "none",
    side_effects: false,
  },
  capability_families: {
    namespace: "discovery",
    family: "discovery.search",
    risk_level: "none",
    side_effects: false,
  },
  capability_describe: {
    namespace: "discovery",
    family: "discovery.describe",
    risk_level: "none",
    side_effects: false,
  },
  capability_invoke: {
    namespace: "discovery",
    family: "discovery.invoke",
    risk_level: "medium",
    side_effects: true,
  },
};
