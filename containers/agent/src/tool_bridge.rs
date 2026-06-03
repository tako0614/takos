use std::collections::HashSet;
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use async_trait::async_trait;
use serde_json::{json, Value};
use takos_agent_engine::model::ToolCallRequest;
use takos_agent_engine::tools::executor::{DefaultToolExecutor, ToolCallResult, ToolExecutor};
use takos_agent_engine::tools::memory_tools::MemoryTools;
use takos_agent_engine::{EngineError, Result};
use tokio_util::sync::CancellationToken;
use tracing::warn;

use crate::control_rpc::{ControlRpcClient, RpcToolResult, SkillCatalogResponse, ToolDefinition};
use crate::skills::{execute_local_skill_tool, LOCAL_SKILL_TOOL_NAMES};

const LOCAL_MEMORY_TOOL_NAMES: [&str; 4] = [
    "semantic_search_memory",
    "graph_search_memory",
    "provenance_lookup",
    "timeline_search",
];

/// Operator-managed allowlist of tool names that the agent is permitted to
/// dispatch. Read from `TAKOS_AGENT_TOOL_ALLOWLIST` (comma-separated) at the
/// time each call is evaluated. **The default is empty** — operators MUST opt
/// in, otherwise every non-local tool call is rejected with the
/// `tool_not_permitted` error. Set the env to `*` to allow every remote tool.
const TOOL_ALLOWLIST_ENV_KEY: &str = "TAKOS_AGENT_TOOL_ALLOWLIST";

#[derive(Debug, Clone, serde::Serialize)]
pub struct ToolExecutionRecord {
    pub tool_call_id: String,
    pub name: String,
    pub arguments: serde_json::Value,
    pub summary: String,
    pub result: Option<String>,
    pub output: String,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct CompositeToolExecutor {
    client: ControlRpcClient,
    remote_tools: Arc<Vec<ToolDefinition>>,
    local_skill_catalog: Arc<SkillCatalogResponse>,
    local_executor: Option<Arc<DefaultToolExecutor>>,
    tool_executions: Arc<Mutex<Vec<ToolExecutionRecord>>>,
    tool_call_sequence: Arc<AtomicU64>,
    cancellation_token: Option<CancellationToken>,
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
            tool_executions: Arc::new(Mutex::new(Vec::new())),
            tool_call_sequence: Arc::new(AtomicU64::new(1)),
            cancellation_token: None,
        }
    }

    pub fn with_local_memory_tools(mut self, memory_tools: MemoryTools) -> Self {
        self.local_executor = Some(Arc::new(DefaultToolExecutor::new(memory_tools)));
        self
    }

    /// Wire the run's cancellation token so in-flight remote tool dispatches
    /// can be aborted when the executor lease is lost or the run is cancelled.
    pub fn with_cancellation_token(mut self, token: CancellationToken) -> Self {
        self.cancellation_token = Some(token);
        self
    }

    pub fn exposed_tools(&self) -> Vec<ToolDefinition> {
        self.remote_tools.as_ref().clone()
    }

    pub fn take_tool_executions(&self) -> Vec<ToolExecutionRecord> {
        let mut guard = lock_tool_executions(&self.tool_executions);
        std::mem::take(&mut *guard)
    }
}

/// Compute the active allowlist for remote tool dispatch. `None` indicates
/// the operator has not configured the env so every remote tool MUST be
/// rejected. `Some(set)` with a literal `*` entry means "allow every remote
/// tool"; otherwise the set holds the exact allowed names. Local memory and
/// local skill tools are always permitted (they execute in-process under the
/// agent's own authority).
fn resolve_tool_allowlist() -> Option<HashSet<String>> {
    let raw = env::var(TOOL_ALLOWLIST_ENV_KEY).ok()?;
    let entries: HashSet<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect();
    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

fn is_tool_allowed(tool_name: &str, allowlist: Option<&HashSet<String>>) -> bool {
    match allowlist {
        // Default is empty — no remote tool can run unless the operator opts
        // in by setting TAKOS_AGENT_TOOL_ALLOWLIST.
        None => false,
        Some(set) => set.contains("*") || set.contains(tool_name),
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

        let tool_name = call.name.clone();
        let tool_arguments = call.arguments.clone();
        let tool_call_id = stable_tool_call_id(
            self.tool_call_sequence.fetch_add(1, Ordering::Relaxed),
            &tool_name,
            &tool_arguments,
        );

        if LOCAL_SKILL_TOOL_NAMES.contains(&tool_name.as_str()) {
            return self
                .execute_local_skill(&tool_call_id, &tool_name, &tool_arguments)
                .await;
        }

        // Remote tool dispatch is gated by the operator-managed allowlist.
        // An unset / empty `TAKOS_AGENT_TOOL_ALLOWLIST` means *no* remote
        // tools are callable — operators must explicitly opt in.
        let allowlist = resolve_tool_allowlist();
        if !is_tool_allowed(&tool_name, allowlist.as_ref()) {
            let error = format!("tool_not_permitted: {tool_name}");
            self.client
                .emit_run_event(
                    "tool_result",
                    tool_result_event(&tool_call_id, &tool_name, &error, "", Some(&error)),
                )
                .await
                .ok();
            self.record_tool_execution(ToolExecutionRecord {
                tool_call_id: tool_call_id.clone(),
                name: tool_name.clone(),
                arguments: tool_arguments.clone(),
                summary: error.clone(),
                result: None,
                output: String::new(),
                error: Some(error.clone()),
            });
            return Err(EngineError::Tool(error));
        }

        self.execute_remote_tool(&tool_call_id, &tool_name, &tool_arguments)
            .await
    }
}

impl CompositeToolExecutor {
    async fn execute_local_skill(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        tool_arguments: &Value,
    ) -> Result<ToolCallResult> {
        emit_tool_call_event(&self.client, tool_call_id, tool_name, tool_arguments)
            .await
            .ok();
        emit_thinking_event(&self.client, format!("Running tool {tool_name}"))
            .await
            .ok();
        let output =
            execute_local_skill_tool(tool_name, tool_arguments, self.local_skill_catalog.as_ref())
                .ok_or_else(|| {
                    EngineError::Tool(format!("unsupported local skill tool {tool_name}"))
                })?;
        let summary = format!("{} output={}", tool_name, truncate_summary(&output));
        self.client
            .emit_run_event(
                "tool_result",
                tool_result_event(tool_call_id, tool_name, &summary, &output, None),
            )
            .await
            .ok();
        self.record_tool_execution(ToolExecutionRecord {
            tool_call_id: tool_call_id.to_string(),
            name: tool_name.to_string(),
            arguments: tool_arguments.clone(),
            summary: summary.clone(),
            result: Some(output.clone()),
            output: output.clone(),
            error: None,
        });
        emit_thinking_event(&self.client, format!("Tool {tool_name} finished"))
            .await
            .ok();
        Ok(ToolCallResult {
            name: tool_name.to_string(),
            content: json!({ "output": output }),
            summary,
        })
    }

    async fn execute_remote_tool(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        tool_arguments: &Value,
    ) -> Result<ToolCallResult> {
        self.client
            .emit_run_event(
                "tool_call",
                tool_call_event(tool_call_id, tool_name, tool_arguments),
            )
            .await
            .ok();
        emit_thinking_event(&self.client, format!("Running tool {tool_name}"))
            .await
            .ok();

        // Wrap the upstream call in `tokio::select!` against the run's
        // cancellation token so an executor lease loss or a cancelled run
        // aborts the in-flight request future instead of waiting for the HTTP
        // timeout. When no token is wired (test paths) we simply await.
        let execute_future = self.client.tool_execute(tool_name, tool_arguments.clone());
        let rpc_outcome = if let Some(token) = self.cancellation_token.clone() {
            tokio::select! {
                biased;
                () = token.cancelled() => {
                    let error = "operation cancelled".to_string();
                    let summary = format!("{tool_name} error={error}");
                    self.client
                        .emit_run_event(
                            "tool_result",
                            tool_result_event(
                                tool_call_id,
                                tool_name,
                                &summary,
                                "",
                                Some(&error),
                            ),
                        )
                        .await
                        .ok();
                    self.record_tool_execution(ToolExecutionRecord {
                        tool_call_id: tool_call_id.to_string(),
                        name: tool_name.to_string(),
                        arguments: tool_arguments.clone(),
                        summary,
                        result: None,
                        output: String::new(),
                        error: Some(error.clone()),
                    });
                    return Err(EngineError::Tool(error));
                }
                outcome = execute_future => outcome,
            }
        } else {
            execute_future.await
        };

        let rpc_result = match rpc_outcome {
            Ok(result) => result,
            Err(err) => {
                let error = err.to_string();
                let summary = format!("{tool_name} error={error}");
                self.client
                    .emit_run_event(
                        "tool_result",
                        tool_result_event(tool_call_id, tool_name, &summary, "", Some(&error)),
                    )
                    .await
                    .ok();
                emit_thinking_event(&self.client, format!("Tool {tool_name} finished"))
                    .await
                    .ok();
                return Err(EngineError::Tool(error));
            }
        };

        let result = rpc_tool_result_to_engine(tool_name, rpc_result.clone());
        let (output, error) = rpc_tool_result_output_and_error(&rpc_result);
        self.client
            .emit_run_event(
                "tool_result",
                tool_result_event(
                    tool_call_id,
                    &result.name,
                    &result.summary,
                    &output,
                    error.as_deref(),
                ),
            )
            .await
            .ok();
        self.record_tool_execution(ToolExecutionRecord {
            tool_call_id: tool_call_id.to_string(),
            name: result.name.clone(),
            arguments: tool_arguments.clone(),
            summary: result.summary.clone(),
            result: if error.is_none() {
                Some(output.clone())
            } else {
                None
            },
            output: output.clone(),
            error,
        });
        emit_thinking_event(&self.client, format!("Tool {} finished", result.name))
            .await
            .ok();

        Ok(result)
    }
}

impl CompositeToolExecutor {
    fn record_tool_execution(&self, record: ToolExecutionRecord) {
        let mut guard = lock_tool_executions(&self.tool_executions);
        guard.push(record);
    }
}

fn lock_tool_executions(
    tool_executions: &Mutex<Vec<ToolExecutionRecord>>,
) -> MutexGuard<'_, Vec<ToolExecutionRecord>> {
    tool_executions.lock().unwrap_or_else(|poisoned| {
        warn!("tool execution buffer lock poisoned; recovering current buffer");
        poisoned.into_inner()
    })
}

fn rpc_tool_result_to_engine(name: &str, rpc: RpcToolResult) -> ToolCallResult {
    let output = rpc.output.clone();
    let error = rpc.error;
    let content = if let Some(error) = error.clone() {
        json!({
            "output": output,
            "error": error,
        })
    } else {
        json!({
            "output": output,
        })
    };

    let summary = if let Some(error) = error {
        format!("{name} error={error}")
    } else {
        format!("{name} output={}", truncate_summary(&output))
    };

    ToolCallResult {
        name: name.to_string(),
        content,
        summary,
    }
}

fn rpc_tool_result_output_and_error(rpc: &RpcToolResult) -> (String, Option<String>) {
    (rpc.output.clone(), rpc.error.clone())
}

fn stable_tool_call_id(sequence: u64, name: &str, arguments: &serde_json::Value) -> String {
    let payload = json!({
        "sequence": sequence,
        "name": name,
        "arguments": arguments,
    });
    format!("rust-tool-{}", crate::hash::fnv1a_hex(&payload.to_string()))
}

fn tool_call_event(
    tool_call_id: &str,
    name: &str,
    arguments: &serde_json::Value,
) -> serde_json::Value {
    json!({
        "id": tool_call_id,
        "tool_call_id": tool_call_id,
        "name": name,
        "arguments": arguments,
    })
}

fn tool_result_event(
    tool_call_id: &str,
    name: &str,
    summary: &str,
    output: &str,
    error: Option<&str>,
) -> serde_json::Value {
    json!({
        "id": tool_call_id,
        "tool_call_id": tool_call_id,
        "name": name,
        "summary": summary,
        "result": if error.is_none() { json!(output) } else { serde_json::Value::Null },
        "output": output,
        "error": error,
    })
}

async fn emit_thinking_event(
    client: &ControlRpcClient,
    message: String,
) -> std::result::Result<(), ()> {
    client
        .emit_run_event(
            "thinking",
            json!({
                "message": message,
            }),
        )
        .await
        .map_err(|_| ())
}

async fn emit_tool_call_event(
    client: &ControlRpcClient,
    tool_call_id: &str,
    name: &str,
    arguments: &serde_json::Value,
) -> std::result::Result<(), ()> {
    client
        .emit_run_event("tool_call", tool_call_event(tool_call_id, name, arguments))
        .await
        .map_err(|_| ())
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
    use super::{
        is_tool_allowed, rpc_tool_result_output_and_error, rpc_tool_result_to_engine,
        stable_tool_call_id, tool_result_event, truncate_summary, CompositeToolExecutor,
        ToolExecutionRecord,
    };
    use crate::control_rpc::{
        ControlRpcClient, SkillCatalogResponse, StartPayload, ToolDefinition,
    };
    use serde_json::json;
    use std::panic::{self, AssertUnwindSafe};

    fn test_client() -> ControlRpcClient {
        ControlRpcClient::new(&StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: None,
            model: Some("local-smoke".to_string()),
            lease_version: None,
            executor_tier: None,
            executor_container_id: None,
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

    #[test]
    fn stable_tool_call_id_depends_on_call_details() {
        let id1 = stable_tool_call_id(1, "repo_list", &json!({ "path": "/tmp" }));
        let id2 = stable_tool_call_id(1, "repo_list", &json!({ "path": "/tmp" }));
        let id3 = stable_tool_call_id(2, "repo_list", &json!({ "path": "/tmp" }));
        let id4 = stable_tool_call_id(1, "repo_list", &json!({ "path": "/var" }));

        assert_eq!(id1, id2);
        assert_ne!(id1, id3);
        assert_ne!(id1, id4);
    }

    #[test]
    fn tool_result_event_includes_result_output_error_and_summary() {
        let payload = tool_result_event(
            "rust-tool-1",
            "repo_list",
            "repo_list output=ok",
            "ok",
            Some("boom"),
        );

        assert_eq!(payload["id"], "rust-tool-1");
        assert_eq!(payload["tool_call_id"], "rust-tool-1");
        assert_eq!(payload["name"], "repo_list");
        assert_eq!(payload["summary"], "repo_list output=ok");
        assert_eq!(payload["output"], "ok");
        assert_eq!(payload["error"], "boom");
        assert!(payload["result"].is_null());
    }

    #[test]
    fn rpc_tool_result_to_engine_preserves_output_and_error() {
        let result = rpc_tool_result_to_engine(
            "repo_list",
            crate::control_rpc::RpcToolResult {
                output: "ok".to_string(),
                error: Some("boom".to_string()),
            },
        );

        assert_eq!(result.name, "repo_list");
        assert_eq!(result.summary, "repo_list error=boom");
        assert_eq!(result.content["output"], "ok");
        assert_eq!(result.content["error"], "boom");
    }

    #[test]
    fn rpc_tool_result_output_and_error_extracts_both_fields() {
        let rpc = crate::control_rpc::RpcToolResult {
            output: "ok".to_string(),
            error: Some("boom".to_string()),
        };
        let (output, error) = rpc_tool_result_output_and_error(&rpc);

        assert_eq!(output, "ok");
        assert_eq!(error.as_deref(), Some("boom"));
    }

    #[test]
    fn tool_execution_buffer_recovers_from_poisoned_lock() {
        let executor = CompositeToolExecutor::new(
            test_client(),
            vec![ToolDefinition {
                name: "repo_list".to_string(),
                description: "remote repo tool".to_string(),
                parameters: json!({ "type": "object" }),
            }],
            SkillCatalogResponse::default(),
        );

        let tool_executions = executor.tool_executions.clone();
        let panic_result = panic::catch_unwind(AssertUnwindSafe(move || {
            let _guard = tool_executions
                .lock()
                .expect("tool execution buffer lock should acquire for poison test");
            panic!("poison tool execution buffer");
        }));
        assert!(panic_result.is_err());

        executor.record_tool_execution(ToolExecutionRecord {
            tool_call_id: "rust-tool-1".to_string(),
            name: "repo_list".to_string(),
            arguments: json!({ "path": "/tmp" }),
            summary: "repo_list output=ok".to_string(),
            result: Some("ok".to_string()),
            output: "ok".to_string(),
            error: None,
        });

        let records = executor.take_tool_executions();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].tool_call_id, "rust-tool-1");
        assert_eq!(records[0].name, "repo_list");
        assert_eq!(records[0].result.as_deref(), Some("ok"));

        assert!(executor.take_tool_executions().is_empty());
    }

    #[test]
    fn tool_allowlist_defaults_to_denying_every_remote_tool() {
        assert!(!is_tool_allowed("repo_list", None));
        assert!(!is_tool_allowed("file_read", None));
    }

    #[test]
    fn tool_allowlist_honours_explicit_names_and_wildcard() {
        let mut set = std::collections::HashSet::new();
        set.insert("repo_list".to_string());
        assert!(is_tool_allowed("repo_list", Some(&set)));
        assert!(!is_tool_allowed("runtime_exec", Some(&set)));

        let mut wildcard = std::collections::HashSet::new();
        wildcard.insert("*".to_string());
        assert!(is_tool_allowed("any_tool_name", Some(&wildcard)));
    }
}
