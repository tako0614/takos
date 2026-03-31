import type { CapabilityNamespace, RiskLevel } from './capability-types.ts';

type ToolNamespaceMeta = {
  namespace: CapabilityNamespace;
  family: string;
  risk_level: RiskLevel;
  side_effects: boolean;
};

export const TOOL_NAMESPACE_MAP: Record<string, ToolNamespaceMeta> = {
  container_start:    { namespace: 'container', family: 'container.lifecycle', risk_level: 'medium', side_effects: true },
  container_status:   { namespace: 'container', family: 'container.lifecycle', risk_level: 'none',   side_effects: false },
  container_commit:   { namespace: 'container', family: 'container.lifecycle', risk_level: 'medium', side_effects: true },
  container_stop:     { namespace: 'container', family: 'container.lifecycle', risk_level: 'medium', side_effects: true },

  create_repository:  { namespace: 'repo',      family: 'repo.manage',        risk_level: 'medium', side_effects: true },
  repo_list:          { namespace: 'repo',      family: 'repo.manage',        risk_level: 'none',   side_effects: false },
  repo_status:        { namespace: 'repo',      family: 'repo.manage',        risk_level: 'none',   side_effects: false },
  repo_switch:        { namespace: 'repo',      family: 'repo.manage',        risk_level: 'low',    side_effects: true },
  repo_fork:          { namespace: 'repo',      family: 'repo.manage',        risk_level: 'medium', side_effects: true },
  store_search:       { namespace: 'repo',      family: 'repo.search',        risk_level: 'none',   side_effects: false },

  file_read:          { namespace: 'file',      family: 'file.ops',           risk_level: 'none',   side_effects: false },
  file_write:         { namespace: 'file',      family: 'file.ops',           risk_level: 'low',    side_effects: true },
  file_write_binary:  { namespace: 'file',      family: 'file.ops',           risk_level: 'low',    side_effects: true },
  file_list:          { namespace: 'file',      family: 'file.ops',           risk_level: 'none',   side_effects: false },
  file_delete:        { namespace: 'file',      family: 'file.ops',           risk_level: 'low',    side_effects: true },
  file_mkdir:         { namespace: 'file',      family: 'file.ops',           risk_level: 'none',   side_effects: true },
  file_rename:        { namespace: 'file',      family: 'file.ops',           risk_level: 'low',    side_effects: true },
  file_copy:          { namespace: 'file',      family: 'file.ops',           risk_level: 'none',   side_effects: true },

  workspace_files_list:   { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'none', side_effects: false },
  workspace_files_read:   { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'none', side_effects: false },
  workspace_files_write:  { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'low',  side_effects: true },
  workspace_files_create: { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'low',  side_effects: true },
  workspace_files_mkdir:  { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'none', side_effects: true },
  workspace_files_delete: { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'low',  side_effects: true },
  workspace_files_rename: { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'low',  side_effects: true },
  workspace_files_move:   { namespace: 'workspace.files', family: 'workspace.files.ops', risk_level: 'low',  side_effects: true },

  deploy_frontend:     { namespace: 'deploy', family: 'deploy.release',  risk_level: 'high',   side_effects: true },
  service_list:         { namespace: 'deploy', family: 'deploy.services',  risk_level: 'none',   side_effects: false },
  service_create:       { namespace: 'deploy', family: 'deploy.services',  risk_level: 'high',   side_effects: true },
  service_delete:       { namespace: 'deploy', family: 'deploy.services',  risk_level: 'high',   side_effects: true },
  deployment_history:  { namespace: 'deploy', family: 'deploy.release',  risk_level: 'none',   side_effects: false },
  deployment_get:      { namespace: 'deploy', family: 'deploy.release',  risk_level: 'none',   side_effects: false },
  deployment_rollback: { namespace: 'deploy', family: 'deploy.release',  risk_level: 'high',   side_effects: true },
  service_env_get:      { namespace: 'deploy', family: 'deploy.service.config',   risk_level: 'none',   side_effects: false },
  service_env_set:      { namespace: 'deploy', family: 'deploy.service.config',   risk_level: 'medium', side_effects: true },
  service_bindings_get: { namespace: 'deploy', family: 'deploy.service.config',   risk_level: 'none',   side_effects: false },
  service_bindings_set: { namespace: 'deploy', family: 'deploy.service.config',   risk_level: 'medium', side_effects: true },
  service_runtime_get:  { namespace: 'deploy', family: 'deploy.service.config',   risk_level: 'none',   side_effects: false },
  service_runtime_set:  { namespace: 'deploy', family: 'deploy.service.config',   risk_level: 'medium', side_effects: true },
  domain_list:         { namespace: 'deploy', family: 'deploy.domains',  risk_level: 'none',   side_effects: false },
  domain_add:          { namespace: 'deploy', family: 'deploy.domains',  risk_level: 'medium', side_effects: true },
  domain_verify:       { namespace: 'deploy', family: 'deploy.domains',  risk_level: 'low',    side_effects: true },
  domain_remove:       { namespace: 'deploy', family: 'deploy.domains',  risk_level: 'medium', side_effects: true },

  list_resources:      { namespace: 'platform', family: 'platform.resources', risk_level: 'none', side_effects: false },

  runtime_exec:        { namespace: 'runtime', family: 'runtime.exec', risk_level: 'medium', side_effects: true },
  runtime_status:      { namespace: 'runtime', family: 'runtime.exec', risk_level: 'none',   side_effects: false },

  kv_get:              { namespace: 'storage', family: 'storage.kv',     risk_level: 'none',   side_effects: false },
  kv_put:              { namespace: 'storage', family: 'storage.kv',     risk_level: 'low',    side_effects: true },
  kv_delete:           { namespace: 'storage', family: 'storage.kv',     risk_level: 'low',    side_effects: true },
  kv_list:             { namespace: 'storage', family: 'storage.kv',     risk_level: 'none',   side_effects: false },
  d1_query:            { namespace: 'storage', family: 'storage.d1',     risk_level: 'medium', side_effects: true },
  d1_tables:           { namespace: 'storage', family: 'storage.d1',     risk_level: 'none',   side_effects: false },
  d1_describe:         { namespace: 'storage', family: 'storage.d1',     risk_level: 'none',   side_effects: false },
  r2_upload:           { namespace: 'storage', family: 'storage.r2',     risk_level: 'low',    side_effects: true },
  r2_download:         { namespace: 'storage', family: 'storage.r2',     risk_level: 'none',   side_effects: false },
  r2_list:             { namespace: 'storage', family: 'storage.r2',     risk_level: 'none',   side_effects: false },
  r2_delete:           { namespace: 'storage', family: 'storage.r2',     risk_level: 'low',    side_effects: true },
  r2_info:             { namespace: 'storage', family: 'storage.r2',     risk_level: 'none',   side_effects: false },
  create_d1:           { namespace: 'storage', family: 'storage.create', risk_level: 'medium', side_effects: true },
  create_kv:           { namespace: 'storage', family: 'storage.create', risk_level: 'medium', side_effects: true },
  create_r2:           { namespace: 'storage', family: 'storage.create', risk_level: 'medium', side_effects: true },

  workspace_env_list:   { namespace: 'workspace.env', family: 'workspace.env.ops', risk_level: 'none',   side_effects: false },
  workspace_env_set:    { namespace: 'workspace.env', family: 'workspace.env.ops', risk_level: 'medium', side_effects: true },
  workspace_env_delete: { namespace: 'workspace.env', family: 'workspace.env.ops', risk_level: 'medium', side_effects: true },

  skill_list:          { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'none',   side_effects: false },
  skill_get:           { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'none',   side_effects: false },
  skill_create:        { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'low',    side_effects: true },
  skill_update:        { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'low',    side_effects: true },
  skill_toggle:        { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'low',    side_effects: true },
  skill_delete:        { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'medium', side_effects: true },
  skill_context:       { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'none',   side_effects: false },
  skill_catalog:       { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'none',   side_effects: false },
  skill_describe:      { namespace: 'workspace.skills', family: 'workspace.skills.ops', risk_level: 'none',   side_effects: false },

  app_deployment_list:             { namespace: 'workspace.apps', family: 'workspace.apps.ops', risk_level: 'none', side_effects: false },
  app_deployment_get:              { namespace: 'workspace.apps', family: 'workspace.apps.ops', risk_level: 'none', side_effects: false },
  app_deployment_deploy_from_repo: { namespace: 'workspace.apps', family: 'workspace.apps.ops', risk_level: 'high', side_effects: true },
  app_deployment_remove:           { namespace: 'workspace.apps', family: 'workspace.apps.ops', risk_level: 'high', side_effects: true },
  app_deployment_rollback:         { namespace: 'workspace.apps', family: 'workspace.apps.ops', risk_level: 'high', side_effects: true },

  remember:            { namespace: 'memory', family: 'memory.core',   risk_level: 'none', side_effects: true },
  recall:              { namespace: 'memory', family: 'memory.core',   risk_level: 'none', side_effects: false },
  set_reminder:        { namespace: 'memory', family: 'memory.core',   risk_level: 'none', side_effects: true },
  info_unit_search:    { namespace: 'memory', family: 'memory.search', risk_level: 'none', side_effects: false },
  repo_graph_search:   { namespace: 'memory', family: 'memory.graph',  risk_level: 'none', side_effects: false },
  repo_graph_neighbors: { namespace: 'memory', family: 'memory.graph', risk_level: 'none', side_effects: false },
  repo_graph_lineage:  { namespace: 'memory', family: 'memory.graph',  risk_level: 'none', side_effects: false },
  memory_graph_recall: { namespace: 'memory', family: 'memory.graph',  risk_level: 'none', side_effects: false },

  web_fetch:           { namespace: 'web', family: 'web.fetch', risk_level: 'low', side_effects: true },

  create_artifact:     { namespace: 'artifact', family: 'artifact.create', risk_level: 'none', side_effects: true },
  search:              { namespace: 'artifact', family: 'artifact.search', risk_level: 'none', side_effects: false },

  spawn_agent:         { namespace: 'agent', family: 'agent.spawn', risk_level: 'medium', side_effects: true },
  wait_agent:          { namespace: 'agent', family: 'agent.spawn', risk_level: 'none',   side_effects: false },

  mcp_add_server:      { namespace: 'mcp', family: 'mcp.manage', risk_level: 'medium', side_effects: true },
  mcp_list_servers:    { namespace: 'mcp', family: 'mcp.manage', risk_level: 'none',   side_effects: false },
  mcp_update_server:   { namespace: 'mcp', family: 'mcp.manage', risk_level: 'medium', side_effects: true },
  mcp_remove_server:   { namespace: 'mcp', family: 'mcp.manage', risk_level: 'medium', side_effects: true },

  capability_search:   { namespace: 'discovery', family: 'discovery.search', risk_level: 'none',   side_effects: false },
  capability_families: { namespace: 'discovery', family: 'discovery.search', risk_level: 'none',   side_effects: false },
  capability_invoke:   { namespace: 'discovery', family: 'discovery.invoke', risk_level: 'medium', side_effects: true },

  browser_open:        { namespace: 'browser', family: 'browser.nav',      risk_level: 'low',  side_effects: true },
  browser_goto:        { namespace: 'browser', family: 'browser.nav',      risk_level: 'low',  side_effects: true },
  browser_action:      { namespace: 'browser', family: 'browser.interact', risk_level: 'low',  side_effects: true },
  browser_screenshot:  { namespace: 'browser', family: 'browser.inspect',  risk_level: 'none', side_effects: false },
  browser_extract:     { namespace: 'browser', family: 'browser.inspect',  risk_level: 'none', side_effects: false },
  browser_html:        { namespace: 'browser', family: 'browser.inspect',  risk_level: 'none', side_effects: false },
  browser_close:       { namespace: 'browser', family: 'browser.nav',      risk_level: 'none', side_effects: true },
};
