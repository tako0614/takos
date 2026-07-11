use std::collections::HashSet;
use std::env;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use async_trait::async_trait;
use serde_json::{json, Value};
use takos_agent_engine::model::ToolCallRequest;
use takos_agent_engine::tools::executor::{ToolCallResult, ToolExecutionKind, ToolExecutor};
use takos_agent_engine::{EngineError, Result};
use tokio_util::sync::CancellationToken;

use crate::control_rpc::{ControlRpcClient, RpcToolResult, ToolDefinition};

pub const UNCERTAIN_SIDE_EFFECT_FATAL_ERROR: &str =
    "side-effect outcome is uncertain; verify remote state before issuing a new operation; automatic replay is blocked";

/// Operator-managed allowlist of tool names that the agent is permitted to
/// dispatch. Read from `TAKOS_AGENT_TOOL_ALLOWLIST` (comma-separated) at the
/// time each call is evaluated. **The default is empty** — operators MUST opt
/// in, otherwise every remote tool is rejected with the
/// `tool_not_permitted` error. Set the env to `*` to allow every remote tool.
const TOOL_ALLOWLIST_ENV_KEY: &str = "TAKOS_AGENT_TOOL_ALLOWLIST";

#[derive(Clone)]
pub struct CompositeToolExecutor {
    client: ControlRpcClient,
    remote_tools: Arc<Vec<ToolDefinition>>,
    tool_call_sequence: Arc<AtomicU64>,
    cancellation_token: Option<CancellationToken>,
    fatal_error: Arc<Mutex<Option<String>>>,
}

impl CompositeToolExecutor {
    pub fn new(client: ControlRpcClient, remote_tools: Vec<ToolDefinition>) -> Self {
        Self {
            client,
            remote_tools: Arc::new(remote_tools),
            tool_call_sequence: Arc::new(AtomicU64::new(1)),
            cancellation_token: None,
            fatal_error: Arc::new(Mutex::new(None)),
        }
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

    pub fn fatal_error(&self) -> Option<String> {
        self.fatal_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn fatal_error_handle(&self) -> Arc<Mutex<Option<String>>> {
        self.fatal_error.clone()
    }

    fn fail_run_for_uncertain_outcome(&self, error: String) {
        let mut fatal_error = self
            .fatal_error
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if fatal_error.is_none() {
            *fatal_error = Some(error);
        }
    }
}

/// Compute the active allowlist for remote tool dispatch. `None` indicates
/// the operator has not configured the env so every remote tool MUST be
/// rejected. `Some(set)` with a literal `*` entry means "allow every remote
/// tool"; otherwise the set holds the exact allowed names. Memory and timeline
/// tools are remote catalog entries and follow this same policy.
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
    fn execution_kind(&self, call: &ToolCallRequest) -> ToolExecutionKind {
        self.remote_tools
            .iter()
            .find(|tool| tool.name == call.name)
            .filter(|tool| {
                tool.side_effects == Some(false) && tool.risk_level.as_deref() != Some("high")
            })
            .map_or(ToolExecutionKind::SideEffecting, |_| {
                ToolExecutionKind::ReadOnly
            })
    }

    async fn execute(&self, call: ToolCallRequest) -> Result<ToolCallResult> {
        let tool_name = call.name.clone();
        let tool_arguments = call.arguments.clone();
        let tool_call_id = call.id.clone().unwrap_or_else(|| {
            stable_tool_call_id(
                self.tool_call_sequence.fetch_add(1, Ordering::Relaxed),
                &tool_name,
                &tool_arguments,
            )
        });

        // Remote tool dispatch is gated by the operator-managed allowlist.
        // An unset / empty `TAKOS_AGENT_TOOL_ALLOWLIST` means *no* remote
        // tools are callable — operators must explicitly opt in.
        let allowlist = resolve_tool_allowlist();
        if !is_tool_allowed(&tool_name, allowlist.as_ref()) {
            let error = format!("tool_not_permitted: {tool_name}");
            self.client
                .emit_run_event(
                    "tool_result",
                    tool_result_event(&tool_call_id, &tool_name, &error, "", Some(&error), 0),
                )
                .await
                .ok();
            return Err(EngineError::Tool(error));
        }

        self.execute_remote_tool(&tool_call_id, &tool_name, &tool_arguments)
            .await
    }
}

impl CompositeToolExecutor {
    async fn execute_remote_tool(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        tool_arguments: &Value,
    ) -> Result<ToolCallResult> {
        let started_at = Instant::now();
        emit_tool_call_event(&self.client, tool_call_id, tool_name, tool_arguments)
            .await
            .ok();
        emit_thinking_event(&self.client, format!("Running tool {tool_name}"))
            .await
            .ok();

        // Wrap the upstream call in `tokio::select!` against the run's
        // cancellation token so an executor lease loss or a cancelled run
        // aborts the in-flight request future instead of waiting for the HTTP
        // timeout. When no token is wired (test paths) we simply await.
        let execute_future =
            self.client
                .tool_execute(tool_call_id, tool_name, tool_arguments.clone());
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
                                elapsed_millis(started_at),
                            ),
                        )
                        .await
                        .ok();
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
                        tool_result_event(
                            tool_call_id,
                            tool_name,
                            &summary,
                            "",
                            Some(&error),
                            elapsed_millis(started_at),
                        ),
                    )
                    .await
                    .ok();
                emit_thinking_event(&self.client, format!("Tool {tool_name} finished"))
                    .await
                    .ok();
                return Err(EngineError::Tool(error));
            }
        };

        if rpc_result.outcome_uncertain {
            // Persist a fixed, bounded reason. The Worker-owned operation ledger
            // retains diagnostic detail; copying that untrusted remote text into
            // every engine checkpoint would create a second secret-bearing sink.
            let error = UNCERTAIN_SIDE_EFFECT_FATAL_ERROR.to_string();
            self.fail_run_for_uncertain_outcome(error.clone());
            let summary = format!("{tool_name} error={error}");
            self.client
                .emit_run_event(
                    "tool_result",
                    tool_result_event(
                        tool_call_id,
                        tool_name,
                        &summary,
                        &rpc_result.output,
                        Some(&error),
                        elapsed_millis(started_at),
                    ),
                )
                .await
                .ok();
            return Err(EngineError::Cancelled);
        }

        let result = rpc_tool_result_to_engine(tool_call_id, tool_name, rpc_result.clone())?;
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
                    elapsed_millis(started_at),
                ),
            )
            .await
            .ok();
        emit_thinking_event(&self.client, format!("Tool {} finished", result.name))
            .await
            .ok();

        Ok(result)
    }
}

fn rpc_tool_result_to_engine(
    tool_call_id: &str,
    name: &str,
    rpc: RpcToolResult,
) -> Result<ToolCallResult> {
    if rpc.outcome_uncertain {
        return Err(EngineError::Tool(rpc.error.clone().unwrap_or_else(|| {
            format!("{name} has an unknown remote side-effect outcome")
        })));
    }
    if rpc.tool_call_id.as_deref() != Some(tool_call_id) {
        return Err(EngineError::Tool(format!(
            "tool result correlation mismatch for {name}"
        )));
    }
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

    Ok(ToolCallResult {
        tool_call_id: Some(tool_call_id.to_string()),
        name: name.to_string(),
        content,
        summary,
    })
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

const EVENT_PREVIEW_BYTES: usize = 4 * 1024;

fn truncate_event_text(value: &str) -> String {
    if value.len() <= EVENT_PREVIEW_BYTES {
        return value.to_string();
    }
    let mut end = EVENT_PREVIEW_BYTES.saturating_sub(3);
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...", &value[..end])
}

fn bounded_event_json(value: &Value) -> Value {
    let serialized = value.to_string();
    if serialized.len() <= EVENT_PREVIEW_BYTES {
        return value.clone();
    }
    json!({
        "_truncated": true,
        "preview": truncate_event_text(&serialized),
    })
}

fn elapsed_millis(started_at: Instant) -> u64 {
    u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX)
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
        "arguments": bounded_event_json(arguments),
    })
}

fn tool_result_event(
    tool_call_id: &str,
    name: &str,
    summary: &str,
    output: &str,
    error: Option<&str>,
    duration_ms: u64,
) -> serde_json::Value {
    json!({
        "id": tool_call_id,
        "tool_call_id": tool_call_id,
        "name": name,
        "summary": summary,
        "result": if error.is_none() { json!(truncate_event_text(output)) } else { serde_json::Value::Null },
        "error": error.map(truncate_event_text),
        "duration_ms": duration_ms,
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
        EVENT_PREVIEW_BYTES,
    };
    use crate::control_rpc::{ControlRpcClient, StartPayload, ToolDefinition};
    use serde_json::json;
    use takos_agent_engine::model::ToolCallRequest;
    use takos_agent_engine::tools::executor::{ToolExecutionKind, ToolExecutor};

    fn test_client() -> ControlRpcClient {
        ControlRpcClient::new(&StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: None,
            model: Some("local-smoke".to_string()),
            lease_version: None,
            executor_tier: None,
            executor_container_id: None,
            checkpoint_protocol_version: None,
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
                    risk_level: Some("low".to_string()),
                    side_effects: Some(false),
                },
                ToolDefinition {
                    name: "example_read".to_string(),
                    description: "remote repo tool".to_string(),
                    parameters: json!({ "type": "object" }),
                    risk_level: Some("low".to_string()),
                    side_effects: Some(false),
                },
            ],
        );

        let tools = executor.exposed_tools();
        let names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["skill_list", "example_read"]);
    }

    #[test]
    fn remote_execution_policy_fails_closed_and_allows_explicit_read_only() {
        let executor = CompositeToolExecutor::new(
            test_client(),
            vec![
                ToolDefinition {
                    name: "safe_read".to_string(),
                    description: "read".to_string(),
                    parameters: json!({ "type": "object" }),
                    risk_level: Some("low".to_string()),
                    side_effects: Some(false),
                },
                ToolDefinition {
                    name: "timeline_search".to_string(),
                    description: "Worker-owned timeline read".to_string(),
                    parameters: json!({ "type": "object" }),
                    risk_level: Some("low".to_string()),
                    side_effects: Some(false),
                },
                ToolDefinition {
                    name: "destructive_read_hint".to_string(),
                    description: "not actually safe".to_string(),
                    parameters: json!({ "type": "object" }),
                    risk_level: Some("high".to_string()),
                    side_effects: Some(false),
                },
            ],
        );
        let call = |name: &str| ToolCallRequest {
            id: None,
            name: name.to_string(),
            arguments: json!({}),
        };

        assert_eq!(
            executor.execution_kind(&call("safe_read")),
            ToolExecutionKind::ReadOnly,
        );
        assert_eq!(
            executor.execution_kind(&call("timeline_search")),
            ToolExecutionKind::ReadOnly,
        );
        assert_eq!(
            executor.execution_kind(&call("destructive_read_hint")),
            ToolExecutionKind::SideEffecting,
        );
        assert_eq!(
            executor.execution_kind(&call("missing_metadata")),
            ToolExecutionKind::SideEffecting,
        );
        assert_eq!(
            executor.execution_kind(&call("semantic_search_memory")),
            ToolExecutionKind::SideEffecting,
            "memory names receive no hidden local read-only authority",
        );
    }

    #[test]
    fn uncertain_remote_outcome_preserves_the_lease_for_terminal_commit() {
        let token = tokio_util::sync::CancellationToken::new();
        let executor = CompositeToolExecutor::new(test_client(), Vec::new())
            .with_cancellation_token(token.clone());

        executor.fail_run_for_uncertain_outcome("remote outcome unknown".to_string());

        assert!(!token.is_cancelled());
        assert_eq!(
            executor.fatal_error().as_deref(),
            Some("remote outcome unknown")
        );
    }

    #[tokio::test]
    async fn uncertain_worker_result_aborts_engine_but_keeps_heartbeat_authority() {
        use axum::extract::Request;
        use axum::routing::post;
        use axum::{Json, Router};

        async fn handler(request: Request) -> Json<serde_json::Value> {
            if request.uri().path().ends_with("tool-execute") {
                return Json(json!({
                    "tool_call_id": "call-uncertain",
                    "output": "",
                    "error": "Automatic replay is blocked until remote state is verified",
                    "outcome_uncertain": true,
                }));
            }
            Json(json!({ "success": true }))
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, Router::new().fallback(post(handler)))
                .await
                .expect("test server");
        });
        let client = ControlRpcClient::new(&StartPayload {
            run_id: "run-uncertain".to_string(),
            worker_id: "worker-uncertain".to_string(),
            service_id: Some("service-uncertain".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(1),
            executor_tier: Some(1),
            executor_container_id: Some("container-uncertain".to_string()),
            checkpoint_protocol_version: None,
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client");
        let token = tokio_util::sync::CancellationToken::new();
        let executor =
            CompositeToolExecutor::new(client, Vec::new()).with_cancellation_token(token.clone());

        let error = executor
            .execute_remote_tool("call-uncertain", "publish", &json!({}))
            .await
            .expect_err("unknown side effect must stop the engine");
        server.abort();

        assert!(matches!(error, takos_agent_engine::EngineError::Cancelled));
        assert!(!token.is_cancelled());
        let fatal = executor.fatal_error().expect("fatal reason");
        assert!(fatal.contains("side-effect outcome is uncertain"));
        assert!(fatal.contains("verify remote state"));
    }

    #[test]
    fn stable_tool_call_id_depends_on_call_details() {
        let id1 = stable_tool_call_id(1, "example_read", &json!({ "path": "/tmp" }));
        let id2 = stable_tool_call_id(1, "example_read", &json!({ "path": "/tmp" }));
        let id3 = stable_tool_call_id(2, "example_read", &json!({ "path": "/tmp" }));
        let id4 = stable_tool_call_id(1, "example_read", &json!({ "path": "/var" }));

        assert_eq!(id1, id2);
        assert_ne!(id1, id3);
        assert_ne!(id1, id4);
    }

    #[test]
    fn tool_result_event_keeps_one_bounded_observability_preview() {
        let payload = tool_result_event(
            "rust-tool-1",
            "example_read",
            "example_read output=ok",
            "ok",
            Some("boom"),
            17,
        );

        assert_eq!(payload["id"], "rust-tool-1");
        assert_eq!(payload["tool_call_id"], "rust-tool-1");
        assert_eq!(payload["name"], "example_read");
        assert_eq!(payload["summary"], "example_read output=ok");
        assert!(payload.get("output").is_none());
        assert_eq!(payload["error"], "boom");
        assert!(payload["result"].is_null());
        assert_eq!(payload["duration_ms"], 17);

        let large = "界".repeat(3_000);
        let success = tool_result_event(
            "rust-tool-2",
            "example_read",
            "large result",
            &large,
            None,
            42,
        );
        let preview = success["result"].as_str().expect("result preview");
        assert!(preview.len() <= EVENT_PREVIEW_BYTES);
        assert!(preview.ends_with("..."));
    }

    #[test]
    fn rpc_tool_result_to_engine_preserves_output_and_error() {
        let result = rpc_tool_result_to_engine(
            "call-example-1",
            "example_read",
            crate::control_rpc::RpcToolResult {
                tool_call_id: Some("call-example-1".to_string()),
                output: "ok".to_string(),
                error: Some("boom".to_string()),
                outcome_uncertain: false,
            },
        )
        .expect("matching tool result correlation");

        assert_eq!(result.name, "example_read");
        assert_eq!(result.summary, "example_read error=boom");
        assert_eq!(result.content["output"], "ok");
        assert_eq!(result.content["error"], "boom");
    }

    #[test]
    fn rpc_tool_result_output_and_error_extracts_both_fields() {
        let rpc = crate::control_rpc::RpcToolResult {
            tool_call_id: Some("call-example-1".to_string()),
            output: "ok".to_string(),
            error: Some("boom".to_string()),
            outcome_uncertain: false,
        };
        let (output, error) = rpc_tool_result_output_and_error(&rpc);

        assert_eq!(output, "ok");
        assert_eq!(error.as_deref(), Some("boom"));
    }

    #[test]
    fn rpc_tool_result_rejects_mismatched_correlation() {
        let error = rpc_tool_result_to_engine(
            "call-expected",
            "example_read",
            crate::control_rpc::RpcToolResult {
                tool_call_id: Some("call-other".to_string()),
                output: "ok".to_string(),
                error: None,
                outcome_uncertain: false,
            },
        )
        .expect_err("the Worker must echo the requested tool call id");

        assert!(error.to_string().contains("correlation mismatch"));
    }

    #[test]
    fn rpc_tool_result_never_converts_an_uncertain_side_effect_to_model_input() {
        let error = rpc_tool_result_to_engine(
            "call-uncertain",
            "remote_write",
            crate::control_rpc::RpcToolResult {
                tool_call_id: Some("call-uncertain".to_string()),
                output: String::new(),
                error: Some("remote outcome unknown".to_string()),
                outcome_uncertain: true,
            },
        )
        .expect_err("an uncertain side effect must fail the Run");

        assert!(error.to_string().contains("remote outcome unknown"));
    }

    #[test]
    fn tool_allowlist_defaults_to_denying_every_remote_tool() {
        assert!(!is_tool_allowed("web_fetch", None));
        assert!(!is_tool_allowed("create_artifact", None));
        assert!(!is_tool_allowed("semantic_search_memory", None));
        assert!(!is_tool_allowed("timeline_search", None));
    }

    #[test]
    fn tool_allowlist_honours_explicit_names_and_wildcard() {
        let mut set = std::collections::HashSet::new();
        set.insert("web_fetch".to_string());
        assert!(is_tool_allowed("web_fetch", Some(&set)));
        assert!(!is_tool_allowed("create_artifact", Some(&set)));

        let mut wildcard = std::collections::HashSet::new();
        wildcard.insert("*".to_string());
        assert!(is_tool_allowed("any_tool_name", Some(&wildcard)));
    }
}
