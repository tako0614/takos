import type { ToolDefinition, ToolHandler } from '../tool-definitions';
export declare const BUILTIN_TOOLS: ToolDefinition[];
export declare const BUILTIN_HANDLERS: Record<string, ToolHandler>;
export declare const TOOL_CATEGORIES: {
    readonly container: readonly ["container_start", "container_status", "container_commit", "container_stop", "create_repository", "repo_list", "repo_status", "repo_switch"];
    readonly file: readonly ["file_read", "file_write", "file_write_binary", "file_list", "file_delete", "file_mkdir", "file_rename", "file_copy", "workspace_files_list", "workspace_files_read", "workspace_files_write", "workspace_files_create", "workspace_files_mkdir", "workspace_files_delete", "workspace_files_rename", "workspace_files_move"];
    readonly deploy: readonly ["deploy_frontend", "service_list", "service_create", "service_delete", "deployment_history", "deployment_get", "deployment_rollback", "service_env_get", "service_env_set", "service_bindings_get", "service_bindings_set", "service_runtime_get", "service_runtime_set", "domain_list", "domain_add", "domain_verify", "domain_remove"];
    readonly runtime: readonly ["runtime_exec", "runtime_status"];
    readonly storage: readonly ["kv_get", "kv_put", "kv_delete", "kv_list", "d1_query", "d1_tables", "d1_describe", "r2_upload", "r2_download", "r2_list", "r2_delete", "r2_info", "create_d1", "create_kv", "create_r2", "list_resources"];
    readonly workspace: readonly ["workspace_env_list", "workspace_env_set", "workspace_env_delete", "skill_list", "skill_get", "skill_create", "skill_update", "skill_toggle", "skill_delete", "skill_context", "skill_catalog", "skill_describe", "app_deployment_list", "app_deployment_get", "app_deployment_deploy_from_repo", "app_deployment_remove", "app_deployment_rollback", "store_search", "repo_fork"];
    readonly memory: readonly ["remember", "recall", "set_reminder", "info_unit_search", "repo_graph_search", "repo_graph_neighbors", "repo_graph_lineage"];
    readonly web: readonly ["web_fetch"];
    readonly artifact: readonly ["create_artifact", "search"];
    readonly agent: readonly ["spawn_agent", "wait_agent"];
    readonly mcp: readonly ["mcp_add_server", "mcp_list_servers", "mcp_update_server", "mcp_remove_server"];
    readonly browser: readonly ["browser_open", "browser_goto", "browser_action", "browser_screenshot", "browser_extract", "browser_html", "browser_close"];
};
export declare function getBuiltinTool(name: string): ToolDefinition | undefined;
export declare function getBuiltinHandler(name: string): ToolHandler | undefined;
export declare function isBuiltinTool(name: string): boolean;
export declare function getToolsByCategory(category: keyof typeof TOOL_CATEGORIES): ToolDefinition[];
//# sourceMappingURL=registry.d.ts.map