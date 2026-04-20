use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;
use takos_agent_engine::model::ToolCallRequest;
use takos_agent_engine::tools::executor::{DefaultToolExecutor, ToolCallResult, ToolExecutor};
use takos_agent_engine::tools::memory_tools::MemoryTools;
use takos_agent_engine::{EngineError, Result};

use crate::control_rpc::{ControlRpcClient, RpcToolResult, SkillCatalogResponse, ToolDefinition};
use crate::skills::{execute_local_skill_tool, LOCAL_SKILL_TOOL_NAMES};

const LOCAL_MEMORY_TOOL_NAMES: [&str; 4] = [
    "semantic_search_memory",
    "graph_search_memory",
    "provenance_lookup",
    "timeline_search",
];

#[derive(Clone)]
pub struct CompositeToolExecutor {
    client: ControlRpcClient,
    remote_tools: Arc<Vec<ToolDefinition>>,
    local_skill_catalog: Arc<SkillCatalogResponse>,
    local_executor: Option<Arc<DefaultToolExecutor>>,
}

impl CompositeToolExecutor {
    pub fn new(
        client: ControlRpcClient,
        remote_tools: Vec<ToolDefinition>,
        local_skill_catalog: SkillCatalogResponse,
    ) -> Self {
        Self {
            client,
            remote_tools: Arc::new(remote_tools),
            local_skill_catalog: Arc::new(local_skill_catalog),
            local_executor: None,
        }
    }

    pub fn with_local_memory_tools(mut self, memory_tools: MemoryTools) -> Self {
        self.local_executor = Some(Arc::new(DefaultToolExecutor::new(memory_tools)));
        self
    }

    pub fn exposed_tools(&self) -> Vec<ToolDefinition> {
        self.remote_tools.as_ref().clone()
    }
}

#[async_trait]
impl ToolExecutor for CompositeToolExecutor {
    async fn execute(&self, call: ToolCallRequest) -> Result<ToolCallResult> {
        if LOCAL_MEMORY_TOOL_NAMES.contains(&call.name.as_str()) {
            let executor = self.local_executor.as_ref().ok_or_else(|| {
                EngineError::Tool(format!(
                    "local tool executor is not configured for {}",
                    call.name
                ))
            })?;
            return executor.execute(call).await;
        }

        if LOCAL_SKILL_TOOL_NAMES.contains(&call.name.as_str()) {
            let output = execute_local_skill_tool(
                &call.name,
                &call.arguments,
                self.local_skill_catalog.as_ref(),
            )
            .ok_or_else(|| {
                EngineError::Tool(format!("unsupported local skill tool {}", call.name))
            })?;
            let summary = format!("{} output={}", call.name, truncate_summary(&output));
            self.client
                .emit_run_event(
                    "tool_result",
                    json!({
                        "name": call.name,
                        "summary": summary,
                    }),
                )
                .await
                .ok();
            return Ok(ToolCallResult {
                name: call.name,
                content: json!({ "output": output }),
                summary,
            });
        }

        self.client
            .emit_run_event(
                "tool_call",
                json!({
                    "name": call.name,
                    "arguments": call.arguments,
                }),
            )
            .await
            .ok();

        let rpc_result = self
            .client
            .tool_execute(&call.name, call.arguments.clone())
            .await
            .map_err(|err| EngineError::Tool(err.to_string()))?;

        let result = rpc_tool_result_to_engine(&call.name, rpc_result);
        self.client
            .emit_run_event(
                "tool_result",
                json!({
                    "name": result.name,
                    "summary": result.summary,
                }),
            )
            .await
            .ok();

        Ok(result)
    }
}

fn rpc_tool_result_to_engine(name: &str, rpc: RpcToolResult) -> ToolCallResult {
    let content = if let Some(error) = rpc.error.clone() {
        json!({
            "output": rpc.output,
            "error": error,
        })
    } else {
        json!({
            "output": rpc.output,
        })
    };

    let summary = if let Some(error) = rpc.error {
        format!("{name} error={error}")
    } else {
        format!("{name} output={}", truncate_summary(&rpc.output))
    };

    ToolCallResult {
        name: name.to_string(),
        content,
        summary,
    }
}

#[allow(dead_code)]
pub fn local_memory_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "semantic_search_memory".to_string(),
            description: "Search raw and abstract memory using semantic similarity.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Search query text." },
                    "target": {
                        "type": "string",
                        "description": "Which memory layer to search.",
                        "enum": ["raw", "abstract", "both"]
                    },
                    "top_k": { "type": "number", "description": "Maximum number of hits." },
                    "threshold": { "type": "number", "description": "Minimum cosine similarity threshold." }
                },
                "required": ["query"]
            }),
        },
        ToolDefinition {
            name: "graph_search_memory".to_string(),
            description: "Traverse abstract-memory relations from a starting abstract node."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "start_node_id": { "type": "string", "description": "Abstract node ID to start traversal from." },
                    "max_depth": { "type": "number", "description": "Traversal depth." },
                    "relation_types": {
                        "type": "array",
                        "description": "Optional relation-type filter.",
                        "items": { "type": "string", "description": "Relation type." }
                    }
                },
                "required": ["start_node_id"]
            }),
        },
        ToolDefinition {
            name: "provenance_lookup".to_string(),
            description: "Resolve the raw-node provenance for one abstract memory node."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "abstract_node_id": { "type": "string", "description": "Abstract node ID." }
                },
                "required": ["abstract_node_id"]
            }),
        },
        ToolDefinition {
            name: "timeline_search".to_string(),
            description: "Read raw memory in timestamp order, optionally scoped to one session."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "session_id": { "type": "string", "description": "Optional session UUID." },
                    "limit": { "type": "number", "description": "Maximum number of raw nodes to return." }
                }
            }),
        },
    ]
}

fn truncate_summary(output: &str) -> String {
    const LIMIT: usize = 280;
    let trimmed = output.trim();
    if trimmed.chars().count() <= LIMIT {
        trimmed.to_string()
    } else {
        let head = trimmed
            .chars()
            .take(LIMIT.saturating_sub(3))
            .collect::<String>();
        format!("{head}...")
    }
}

#[cfg(test)]
mod tests {
    use super::{truncate_summary, CompositeToolExecutor};
    use crate::control_rpc::{
        ControlRpcClient, SkillCatalogResponse, StartPayload, ToolDefinition,
    };
    use serde_json::json;

    fn test_client() -> ControlRpcClient {
        ControlRpcClient::new(&StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: None,
            model: Some("local-smoke".to_string()),
            lease_version: None,
            control_rpc_base_url: "http://127.0.0.1:8790".to_string(),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build for test")
    }

    #[test]
    fn truncate_summary_preserves_utf8_boundaries() {
        let source = "ソフトウェア資産を repo と app として取得・作成・変更・公開する。".repeat(20);
        let truncated = truncate_summary(&source);
        assert!(truncated.ends_with("..."));
        assert!(truncated.chars().count() <= 280);
    }

    #[test]
    fn exposed_tools_mirror_remote_catalog_without_injecting_local_tools() {
        let executor = CompositeToolExecutor::new(
            test_client(),
            vec![
                ToolDefinition {
                    name: "skill_list".to_string(),
                    description: "duplicate remote skill list".to_string(),
                    parameters: json!({ "type": "object" }),
                },
                ToolDefinition {
                    name: "repo_list".to_string(),
                    description: "remote repo tool".to_string(),
                    parameters: json!({ "type": "object" }),
                },
            ],
            SkillCatalogResponse::default(),
        );

        let tools = executor.exposed_tools();
        let names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["skill_list", "repo_list"]);
    }
}
