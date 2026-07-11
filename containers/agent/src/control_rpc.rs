use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{env, io};

use async_trait::async_trait;
use reqwest::StatusCode;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use takos_agent_engine::domain::LoopState;
use takos_agent_engine::ids::{LoopId, SessionId};
use takos_agent_engine::storage::LoopStateRepository;
use takos_agent_engine::{EngineError, Result as EngineResult};

use crate::engine_support::{UsageSnapshot, UsageTracker};
use crate::AppResult;

/// Connect + read timeout for control-plane RPC calls. Picked to be short
/// enough that a stalled control plane can't keep an agent run wedged forever
/// while still giving room for normal Cloudflare round-trips.
const CONTROL_RPC_HTTP_TIMEOUT: Duration = Duration::from_secs(30);
/// Tool execution includes long-running computer/MCP/sub-agent waits. The
/// Worker contract allows five minutes, so only this endpoint receives the
/// longer transport budget; heartbeats and status RPCs remain fail-fast.
const CONTROL_RPC_TOOL_TIMEOUT: Duration = Duration::from_secs(305);
/// Atomic terminal writes can include the full bounded transcript and may
/// cross a cold Worker/R2 path. Give finalization a larger per-attempt budget
/// than ordinary control RPCs without allowing it to wait forever.
const CONTROL_RPC_FINALIZATION_TIMEOUT: Duration = Duration::from_secs(120);
const CONTROL_RPC_CHECKPOINT_TIMEOUT: Duration = Duration::from_secs(120);
const FINALIZATION_MAX_ATTEMPTS: usize = 3;
const FINALIZATION_RETRY_BASE_DELAY: Duration = Duration::from_millis(100);

const CONTROL_RPC_BASE_URL_ENV_KEY: &str = "TAKOS_AGENT_CONTROL_RPC_BASE_URL";
const CONTROL_RPC_TOKEN_ENV_KEY: &str = "TAKOS_AGENT_CONTROL_RPC_TOKEN";
const AGENT_CONTROL_RPC_PATH_PREFIX: &str = "/api/internal/v1/agent-control";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPayload {
    pub run_id: String,
    pub worker_id: String,
    pub service_id: Option<String>,
    pub model: Option<String>,
    pub lease_version: Option<u32>,
    pub executor_tier: Option<u8>,
    pub executor_container_id: Option<String>,
    #[serde(default)]
    pub checkpoint_protocol_version: Option<u8>,
    pub control_rpc_base_url: String,
    pub control_rpc_token: String,
}

impl StartPayload {
    pub fn resolved_service_id(&self) -> &str {
        self.service_id
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or(&self.worker_id)
    }

    pub fn resolved_model(&self) -> &str {
        self.model
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or("local-smoke")
    }

    pub fn supports_durable_checkpoints(&self) -> bool {
        self.checkpoint_protocol_version
            .is_some_and(|version| version >= 1)
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RunBootstrap {
    pub status: Option<String>,
    #[serde(alias = "spaceId")]
    pub space_id: String,
    #[serde(default, alias = "installationId")]
    pub installation_id: Option<String>,
    #[serde(default, alias = "runtimeNamespace")]
    pub runtime_namespace: Option<String>,
    #[serde(alias = "threadId")]
    pub thread_id: String,
    #[serde(alias = "userId")]
    pub user_id: String,
    #[serde(alias = "agentType")]
    pub agent_type: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub tool_calls: Vec<Value>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ConversationHistoryResponse {
    pub history: Vec<HistoryMessage>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillExecutionContract {
    #[serde(default)]
    pub preferred_tools: Vec<String>,
    #[serde(default)]
    pub durable_output_hints: Vec<String>,
    #[serde(default)]
    pub output_modes: Vec<String>,
    #[serde(default)]
    pub required_mcp_servers: Vec<String>,
    #[serde(default)]
    pub template_ids: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ActivatedSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
    pub category: Option<String>,
    pub locale: Option<String>,
    pub version: Option<String>,
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default)]
    pub activation_tags: Vec<String>,
    pub instructions: String,
    #[serde(default)]
    pub execution_contract: SkillExecutionContract,
    #[serde(default)]
    pub availability: String,
    #[serde(default)]
    pub availability_reasons: Vec<String>,
    pub priority: Option<i32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillResolutionContext {
    #[serde(default)]
    pub conversation: Vec<String>,
    #[serde(default, alias = "thread_title")]
    pub thread_title: Option<String>,
    #[serde(default, alias = "thread_summary")]
    pub thread_summary: Option<String>,
    #[serde(default, alias = "thread_key_points")]
    pub thread_key_points: Vec<String>,
    #[serde(default, alias = "run_input")]
    pub run_input: Value,
    #[serde(default, alias = "agent_type")]
    pub agent_type: Option<String>,
    #[serde(default, alias = "space_locale")]
    pub space_locale: Option<String>,
    #[serde(default, alias = "preferred_locale")]
    pub preferred_locale: Option<String>,
    #[serde(default, alias = "accept_language")]
    pub accept_language: Option<String>,
    #[serde(default, alias = "max_selected")]
    pub max_selected: Option<usize>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct SkillCatalogResponse {
    pub locale: String,
    pub skills: Vec<ActivatedSkill>,
    pub resolution_context: SkillResolutionContext,
    pub managed_source: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct SkillRuntimeContextResponse {
    pub locale: Option<String>,
    pub skills: Vec<ActivatedSkill>,
    pub managed_skills: Vec<ActivatedSkill>,
    pub custom_skills: Vec<ActivatedSkill>,
    pub resolution_context: SkillResolutionContext,
    pub available_mcp_server_names: Vec<String>,
    pub available_template_ids: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default)]
pub struct RunConfigResponse {
    pub system_prompt: String,
    pub max_graph_steps: Option<u32>,
    pub max_tool_rounds: Option<u32>,
    pub temperature: Option<f32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ApiKeysResponse {
    /// The runtime model adapter uses one OpenAI-compatible transport. Native
    /// vendor credentials are resolved by the configured gateway/endpoint,
    /// not deserialized into unused container fields.
    pub openai: Option<String>,
    #[serde(default, alias = "openaiEndpoint")]
    pub openai_endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
    #[serde(default)]
    pub risk_level: Option<String>,
    #[serde(default)]
    pub side_effects: Option<bool>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ToolCatalogResponse {
    #[serde(default)]
    pub tools: Vec<ToolDefinition>,
    #[serde(default, alias = "mcpFailedServers")]
    pub mcp_failed_servers: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct RpcToolResult {
    #[serde(default)]
    pub tool_call_id: Option<String>,
    pub output: String,
    pub error: Option<String>,
    #[serde(default)]
    pub outcome_uncertain: bool,
}

#[derive(Debug, Deserialize)]
struct EngineCheckpointLoadResponse {
    checkpoint: Option<LoopState>,
    usage: UsageSnapshot,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UsagePayload {
    #[serde(rename = "inputTokens")]
    pub input_tokens: usize,
    #[serde(rename = "outputTokens")]
    pub output_tokens: usize,
    #[serde(rename = "cachedInputTokens")]
    pub cached_input_tokens: usize,
}

#[derive(Clone)]
pub struct ControlRpcClient {
    http: reqwest::Client,
    base_url: String,
    token: String,
    run_id: String,
    service_id: String,
    lease_version: Option<u32>,
    executor_tier: Option<u8>,
    executor_container_id: Option<String>,
    sequence: Arc<AtomicU64>,
}

impl ControlRpcClient {
    pub fn new(payload: &StartPayload) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent("takos-agent/0.1.0")
            .connect_timeout(Duration::from_secs(10))
            .build()?;
        let (base_url, token) = resolve_control_rpc_config(
            payload,
            nonempty_env(CONTROL_RPC_BASE_URL_ENV_KEY),
            nonempty_env(CONTROL_RPC_TOKEN_ENV_KEY),
        )?;
        Ok(Self {
            http,
            base_url,
            token,
            run_id: payload.run_id.clone(),
            service_id: payload.resolved_service_id().to_string(),
            lease_version: payload.lease_version,
            executor_tier: payload.executor_tier,
            executor_container_id: payload.executor_container_id.clone(),
            sequence: Arc::new(AtomicU64::new(1)),
        })
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst)
    }

    pub async fn run_bootstrap(&self) -> AppResult<RunBootstrap> {
        self.post_control_json(
            "run-bootstrap",
            json!({
                "runId": self.run_id,
            }),
        )
        .await
    }

    pub async fn run_config(&self, agent_type: Option<&str>) -> AppResult<RunConfigResponse> {
        let payload: Value = self
            .post_control_json(
                "run-config",
                json!({
                    "runId": self.run_id,
                    "agentType": agent_type.unwrap_or("default"),
                }),
            )
            .await?;
        Ok(parse_run_config_response(&payload))
    }

    pub async fn conversation_history(
        &self,
        thread_id: &str,
        space_id: &str,
        ai_model: &str,
    ) -> AppResult<ConversationHistoryResponse> {
        self.post_control_json(
            "conversation-history",
            json!({
                "runId": self.run_id,
                "threadId": thread_id,
                "spaceId": space_id,
                "aiModel": ai_model,
            }),
        )
        .await
    }

    pub async fn skill_runtime_context(
        &self,
        thread_id: &str,
        space_id: &str,
        agent_type: &str,
        history: &[HistoryMessage],
        available_tool_names: &[String],
    ) -> AppResult<SkillRuntimeContextResponse> {
        let payload: Value = self
            .post_control_json(
                "skill-runtime-context",
                json!({
                    "runId": self.run_id,
                    "threadId": thread_id,
                    "spaceId": space_id,
                    "agentType": agent_type,
                    "history": history,
                    "availableToolNames": available_tool_names,
                }),
            )
            .await?;

        let skills = activated_skill_array_field(&payload, &["skills"]);
        let managed_skills =
            activated_skill_array_field(&payload, &["managedSkills", "managed_skills"]);
        let custom_skills =
            activated_skill_array_field(&payload, &["customSkills", "custom_skills"]);

        let resolution_context = payload
            .get("resolutionContext")
            .cloned()
            .or_else(|| payload.get("resolution_context").cloned())
            .and_then(|value| serde_json::from_value::<SkillResolutionContext>(value).ok())
            .unwrap_or_default();

        Ok(SkillRuntimeContextResponse {
            locale: string_field(&payload, &["locale"]),
            skills,
            managed_skills,
            custom_skills,
            resolution_context,
            available_mcp_server_names: string_array_field(
                &payload,
                &["availableMcpServerNames", "available_mcp_server_names"],
            ),
            available_template_ids: string_array_field(
                &payload,
                &["availableTemplateIds", "available_template_ids"],
            ),
        })
    }

    pub async fn tool_catalog(&self) -> AppResult<ToolCatalogResponse> {
        self.post_control_json(
            "tool-catalog",
            json!({
                "runId": self.run_id,
            }),
        )
        .await
    }

    pub async fn tool_execute(
        &self,
        tool_call_id: &str,
        name: &str,
        arguments: Value,
    ) -> AppResult<RpcToolResult> {
        self.post_control_json(
            "tool-execute",
            json!({
                "runId": self.run_id,
                "leaseVersion": self.lease_version,
                "toolCall": {
                    "id": tool_call_id,
                    "name": name,
                    "arguments": arguments,
                }
            }),
        )
        .await
    }

    pub async fn save_engine_checkpoint(
        &self,
        checkpoint: &LoopState,
        usage: &UsageSnapshot,
    ) -> AppResult<()> {
        let body = json!({
            "runId": self.run_id,
            "leaseVersion": self.lease_version,
            "checkpoint": checkpoint,
            "usage": usage,
        });
        let _: Value = self
            .post_checkpoint_with_retry("engine-checkpoint-save", body)
            .await?;
        Ok(())
    }

    pub async fn load_engine_checkpoint(&self) -> AppResult<(Option<LoopState>, UsageSnapshot)> {
        let response: EngineCheckpointLoadResponse = self
            .post_checkpoint_with_retry(
                "engine-checkpoint-load",
                json!({
                    "runId": self.run_id,
                    "leaseVersion": self.lease_version,
                }),
            )
            .await?;
        Ok((response.checkpoint, response.usage))
    }

    async fn post_checkpoint_with_retry<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        body: Value,
    ) -> AppResult<T> {
        let mut attempt = 1;
        loop {
            let result = self.post_control_json(endpoint, body.clone()).await;
            match result {
                Err(ref error)
                    if attempt < FINALIZATION_MAX_ATTEMPTS
                        && is_retryable_control_rpc_error(error.as_ref()) =>
                {
                    tokio::time::sleep(finalization_retry_delay(attempt)).await;
                    attempt += 1;
                }
                result => return result,
            }
        }
    }

    pub async fn tool_cleanup(&self) -> AppResult<()> {
        let _: Value = self
            .post_control_json(
                "tool-cleanup",
                json!({
                    "runId": self.run_id,
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn heartbeat(&self) -> AppResult<()> {
        let _: Value = self
            .post_control_json(
                "heartbeat",
                json!({
                    "runId": self.run_id,
                    "workerId": self.service_id,
                    "serviceId": self.service_id,
                    "leaseVersion": self.lease_version,
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn api_keys(&self) -> AppResult<ApiKeysResponse> {
        self.post_control_json(
            "api-keys",
            json!({
                "runId": self.run_id,
            }),
        )
        .await
    }

    pub async fn complete_run(
        &self,
        status: &str,
        usage: UsagePayload,
        output: Option<&str>,
        error_message: Option<&str>,
        messages: Vec<Value>,
    ) -> AppResult<()> {
        let payload = json!({
            "runId": self.run_id,
            "serviceId": self.service_id,
            "leaseVersion": self.lease_version,
            "status": status,
            "usage": usage,
            "output": output,
            "error": error_message,
            "messages": messages,
        });
        // `complete-run` is atomic and idempotent for this run/lease/payload.
        // A timeout after the Worker committed is indistinguishable from a
        // pre-commit transport failure, so retry the exact same payload only;
        // never downgrade an ambiguous commit to split writes.
        let mut attempt = 1;
        let completion = loop {
            let completion = self
                .post_control_json::<Value>("complete-run", payload.clone())
                .await;
            match completion {
                Err(ref error)
                    if attempt < FINALIZATION_MAX_ATTEMPTS
                        && is_retryable_control_rpc_error(error.as_ref()) =>
                {
                    tokio::time::sleep(finalization_retry_delay(attempt)).await;
                    attempt += 1;
                }
                result => break result,
            }
        };
        completion.map(|_| ())
    }

    pub async fn emit_run_event(&self, event_type: &str, data: Value) -> AppResult<()> {
        let _: Value = self
            .post_control_json(
                "run-event",
                json!({
                    "runId": self.run_id,
                    "type": event_type,
                    "data": data,
                    "sequence": self.next_sequence(),
                    "leaseVersion": self.lease_version,
                }),
            )
            .await?;
        Ok(())
    }

    async fn post_control_json<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        body: Value,
    ) -> AppResult<T> {
        let path = format!(
            "{}/{}",
            AGENT_CONTROL_RPC_PATH_PREFIX,
            endpoint.trim_start_matches('/')
        );
        let timeout = match endpoint.trim_start_matches('/') {
            "tool-execute" => CONTROL_RPC_TOOL_TIMEOUT,
            "complete-run" => CONTROL_RPC_FINALIZATION_TIMEOUT,
            "engine-checkpoint-save" => CONTROL_RPC_CHECKPOINT_TIMEOUT,
            _ => CONTROL_RPC_HTTP_TIMEOUT,
        };
        self.post_json(&path, body, timeout).await
    }

    async fn post_json<T: DeserializeOwned>(
        &self,
        path: &str,
        body: Value,
        timeout: Duration,
    ) -> AppResult<T> {
        let url = format!("{}{}", self.base_url, path);
        // Serialize once per attempt; callers that retry pass the same Value,
        // preserving the same atomic completion rather than manufacturing a
        // second terminal outcome.
        let body_bytes = serde_json::to_vec(&body).map_err(|err| {
            io::Error::other(format!("failed to encode {path} request body: {err}"))
        })?;
        let mut request = self
            .http
            .post(url)
            .timeout(timeout)
            .bearer_auth(&self.token)
            .header("Content-Type", "application/json")
            .header("X-Takos-Run-Id", &self.run_id);
        if let Some(executor_tier) = self.executor_tier {
            request = request.header("X-Takos-Executor-Tier", executor_tier.to_string());
        }
        if let Some(executor_container_id) = &self.executor_container_id {
            request = request.header("X-Takos-Executor-Container-Id", executor_container_id);
        }
        let response = request.body(body_bytes).send().await.map_err(|err| {
            Box::new(ControlRpcError {
                kind: ControlRpcErrorKind::Network,
                status: err.status(),
                message: format!("{path} request failed: {err}"),
            }) as Box<dyn std::error::Error + Send + Sync>
        })?;
        match Self::decode_response::<T>(path, response).await {
            Ok(value) => Ok(value),
            Err(err) => Err(Box::new(err) as Box<dyn std::error::Error + Send + Sync>),
        }
    }

    async fn decode_response<T: DeserializeOwned>(
        path: &str,
        response: reqwest::Response,
    ) -> Result<T, ControlRpcError> {
        let status = response.status();
        let text = response.text().await.map_err(|err| ControlRpcError {
            kind: if status.is_success() {
                ControlRpcErrorKind::ResponseAmbiguous
            } else {
                ControlRpcErrorKind::Network
            },
            status: Some(status),
            message: format!("{path} response read failed: {err}"),
        })?;
        if !status.is_success() {
            let kind = ControlRpcErrorKind::from_response(status, &text);
            let detail = if text.is_empty() {
                status.to_string()
            } else {
                format!("{status} {text}")
            };
            return Err(ControlRpcError {
                kind,
                status: Some(status),
                message: format!("{path} failed: {detail}"),
            });
        }
        serde_json::from_str(&text).map_err(|err| ControlRpcError {
            // A successful status with a truncated/malformed response is
            // commit-ambiguous. `complete-run` may safely replay the identical
            // atomic payload; ordinary RPC callers still surface the error.
            kind: ControlRpcErrorKind::ResponseAmbiguous,
            status: Some(status),
            message: format!("failed to decode {path} response: {err}; body={text}"),
        })
    }
}

#[derive(Clone)]
pub struct ControlRpcLoopStateRepository {
    client: ControlRpcClient,
    usage_tracker: Arc<UsageTracker>,
}

impl ControlRpcLoopStateRepository {
    pub const fn new(client: ControlRpcClient, usage_tracker: Arc<UsageTracker>) -> Self {
        Self {
            client,
            usage_tracker,
        }
    }

    pub async fn load_current(&self) -> AppResult<Option<LoopState>> {
        let (checkpoint, usage) = self.client.load_engine_checkpoint().await?;
        self.usage_tracker.restore(usage);
        Ok(checkpoint)
    }
}

#[async_trait]
impl LoopStateRepository for ControlRpcLoopStateRepository {
    async fn save_checkpoint(&self, state: LoopState) -> EngineResult<()> {
        let usage = self.usage_tracker.snapshot();
        self.client
            .save_engine_checkpoint(&state, &usage)
            .await
            .map_err(|error| {
                EngineError::Storage(format!("control-plane checkpoint save failed: {error}"))
            })
    }

    async fn load_checkpoint(
        &self,
        session_id: &SessionId,
        loop_id: &LoopId,
    ) -> EngineResult<Option<LoopState>> {
        let checkpoint = self.load_current().await.map_err(|error| {
            EngineError::Storage(format!("control-plane checkpoint load failed: {error}"))
        })?;
        match checkpoint {
            Some(checkpoint)
                if checkpoint.session_id != *session_id || checkpoint.loop_id != *loop_id =>
            {
                Err(EngineError::Storage(
                    "control-plane checkpoint identity does not match the requested loop"
                        .to_string(),
                ))
            }
            value => Ok(value),
        }
    }

    async fn clear_checkpoint(
        &self,
        _session_id: &SessionId,
        _loop_id: &LoopId,
    ) -> EngineResult<()> {
        // Keep the final pre-node checkpoint until complete-run atomically
        // commits the transcript and terminal Run ledger. Clearing here would
        // reopen a crash window between engine completion and that commit.
        Ok(())
    }
}

/// Classification used by callers to react to specific control-plane failures
/// (lease loss vs. transient network vs. unknown). Replaces the previous
/// substring match on the formatted error message so a stray "Lease lost" in
/// an unrelated server response cannot cancel a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlRpcErrorKind {
    /// HTTP 409 + a structured "Lease lost" signal from the executor.
    LeaseLost,
    /// HTTP 409 from the control plane that is not a lease-lost case.
    Conflict,
    /// HTTP 404 from the control plane.
    NotFound,
    /// Transport / I/O failure before a structured status was obtained.
    Network,
    /// The server may have committed, but its successful response could not be
    /// decoded. Safe only for replaying an idempotent atomic request.
    ResponseAmbiguous,
    /// Any other failure.
    Other,
}

impl ControlRpcErrorKind {
    /// Map an HTTP status + response body into a structured error kind. The
    /// body is parsed as JSON when possible and checked for the
    /// `error == "lease_lost"` shape that takos emits; we fall back to a
    /// case-sensitive substring check for the wire-format compatibility window.
    pub fn from_response(status: StatusCode, body: &str) -> Self {
        if status == StatusCode::CONFLICT {
            if let Ok(value) = serde_json::from_str::<Value>(body) {
                let error_code = value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_ascii_lowercase);
                if matches!(
                    error_code.as_deref(),
                    Some("lease_lost") | Some("lease-lost")
                ) {
                    return Self::LeaseLost;
                }
            }
            // Compatibility with control planes that have not yet adopted the
            // structured `error` field but still emit the canonical reason.
            if body.contains("Lease lost") || body.contains("lease_lost") {
                return Self::LeaseLost;
            }
            return Self::Conflict;
        }
        if status == StatusCode::NOT_FOUND {
            return Self::NotFound;
        }
        Self::Other
    }
}

#[derive(Debug, Clone)]
pub struct ControlRpcError {
    pub kind: ControlRpcErrorKind,
    pub status: Option<StatusCode>,
    pub message: String,
}

impl fmt::Display for ControlRpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if let Some(status) = self.status {
            write!(formatter, "{} (status {status})", self.message)
        } else {
            formatter.write_str(&self.message)
        }
    }
}

impl std::error::Error for ControlRpcError {}

impl ControlRpcError {
    /// Convenience predicate for callers that only care about lease-loss.
    pub fn is_lease_lost(&self) -> bool {
        matches!(self.kind, ControlRpcErrorKind::LeaseLost)
    }

    /// A physically revoked proxy token returns 401/403, while a deleted run
    /// may return 404. These are equivalent to the structured 409 lease-lost
    /// signal for a run-scoped agent: it no longer has authority to continue or
    /// attempt terminal writes with this credential.
    pub fn is_run_authority_lost(&self) -> bool {
        self.is_lease_lost()
            || matches!(
                self.status,
                Some(StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND)
            )
    }
}

fn is_retryable_control_rpc_error(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(source) = current {
        if let Some(typed) = source.downcast_ref::<ControlRpcError>() {
            return match typed.kind {
                ControlRpcErrorKind::Network => typed.status.is_none_or(|status| {
                    status.is_server_error()
                        || status == StatusCode::REQUEST_TIMEOUT
                        || status == StatusCode::TOO_MANY_REQUESTS
                }),
                ControlRpcErrorKind::ResponseAmbiguous => true,
                ControlRpcErrorKind::Other => typed.status.is_some_and(|status| {
                    status.is_server_error()
                        || status == StatusCode::REQUEST_TIMEOUT
                        || status == StatusCode::TOO_MANY_REQUESTS
                }),
                ControlRpcErrorKind::LeaseLost
                | ControlRpcErrorKind::Conflict
                | ControlRpcErrorKind::NotFound => false,
            };
        }
        current = source.source();
    }
    false
}

fn finalization_retry_delay(failed_attempt: usize) -> Duration {
    let exponent = u32::try_from(failed_attempt.saturating_sub(1)).unwrap_or(u32::MAX);
    let multiplier = 2_u32.saturating_pow(exponent.min(8));
    let base = FINALIZATION_RETRY_BASE_DELAY.saturating_mul(multiplier);
    let jitter_bound_ms = u64::try_from(base.as_millis() / 2)
        .unwrap_or(u64::MAX)
        .max(1);
    let entropy = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| u64::from(duration.subsec_nanos()));
    base.saturating_add(Duration::from_millis(entropy % jitter_bound_ms))
}

fn parse_run_config_response(payload: &Value) -> RunConfigResponse {
    RunConfigResponse {
        system_prompt: string_field(payload, &["systemPrompt"]).unwrap_or_default(),
        max_graph_steps: u32_field(payload, &["maxGraphSteps"]),
        max_tool_rounds: u32_field(payload, &["maxToolRounds"]),
        temperature: f32_field(payload, &["temperature"]),
    }
}

fn resolve_control_rpc_config(
    payload: &StartPayload,
    env_base_url: Option<String>,
    env_token: Option<String>,
) -> AppResult<(String, String)> {
    // A pooled container can survive Worker configuration changes. The start
    // payload is minted for this run by the current control plane, while env
    // values may belong to an older pool generation. Prefer the per-run
    // values and retain env only as a compatibility fallback for direct
    // callers that omit them.
    let mut base_url = nonempty_value(&payload.control_rpc_base_url)
        .or(env_base_url)
        .unwrap_or_default()
        .trim()
        .to_string();
    while base_url.ends_with('/') {
        base_url.pop();
    }
    if base_url.is_empty() {
        return Err(io::Error::other("agent control RPC base URL must not be empty").into());
    }
    let token = nonempty_value(&payload.control_rpc_token)
        .or(env_token)
        .unwrap_or_default()
        .trim()
        .to_string();
    if token.is_empty() {
        return Err(io::Error::other("agent control RPC token must not be empty").into());
    }
    Ok((base_url, token))
}

fn nonempty_value(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn nonempty_env(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.trim().is_empty())
}

/// Decides whether a heartbeat / control-plane RPC error reflects the
/// scheduler having taken the lease away. Prefers the structured
/// [`ControlRpcError`] classification; falls back to a tightened substring
/// check (status 409 conjunction with "Lease lost") for legacy error sources
/// so unrelated 409 paths or stray log lines cannot misclassify transient
/// failures.
pub fn is_lease_lost(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(source) = current {
        if let Some(typed) = source.downcast_ref::<ControlRpcError>() {
            return typed.is_lease_lost();
        }
        current = source.source();
    }
    let message = error.to_string();
    if !message.contains("Lease lost") {
        return false;
    }
    let conflict_code = StatusCode::CONFLICT.as_u16().to_string();
    let conflict_token = format!(" {conflict_code} ");
    let conflict_phrase = StatusCode::CONFLICT
        .canonical_reason()
        .map(|reason| format!("{conflict_code} {reason}"))
        .unwrap_or_else(|| format!("{conflict_code} Conflict"));
    message.contains(&conflict_token)
        || message.contains(&conflict_phrase)
        || message.contains(&format!("status:{conflict_code}"))
}

/// Returns true when the run-scoped control credential is no longer
/// authoritative. This includes the canonical lease-lost response and HTTP
/// authentication/authorization failures produced by immediate token
/// revocation after cancellation, replacement, or terminal completion.
pub fn is_run_authority_lost(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(source) = current {
        if let Some(typed) = source.downcast_ref::<ControlRpcError>() {
            return typed.is_run_authority_lost();
        }
        current = source.source();
    }
    // Retain compatibility for legacy wrapped errors that predate the typed
    // ControlRpcError path. Exact 401/403/404 parsing is intentionally omitted
    // here to avoid cancelling on an unrelated nested error string.
    is_lease_lost(error)
}

fn string_field(payload: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        payload
            .get(*key)
            .and_then(Value::as_str)
            .map(ToString::to_string)
    })
}

fn u32_field(payload: &Value, keys: &[&str]) -> Option<u32> {
    keys.iter().find_map(|key| {
        payload
            .get(*key)
            .and_then(Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
    })
}

fn f32_field(payload: &Value, keys: &[&str]) -> Option<f32> {
    keys.iter().find_map(|key| {
        payload.get(*key).and_then(Value::as_f64).map(|value| {
            // Config knobs (temperature, top_p, etc.) — f32 precision is sufficient.
            #[allow(clippy::cast_possible_truncation)]
            let narrowed = value as f32;
            narrowed
        })
    })
}

fn string_array_field(payload: &Value, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .find_map(|key| {
            payload.get(*key).and_then(Value::as_array).map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_str)
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        })
        .unwrap_or_default()
}

fn activated_skill_array_field(payload: &Value, keys: &[&str]) -> Vec<ActivatedSkill> {
    keys.iter()
        .find_map(|key| {
            payload.get(*key).and_then(Value::as_array).map(|values| {
                values
                    .iter()
                    .filter_map(|value| {
                        serde_json::from_value::<ActivatedSkill>(value.clone()).ok()
                    })
                    .collect::<Vec<_>>()
            })
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        is_lease_lost, is_run_authority_lost, parse_run_config_response,
        resolve_control_rpc_config, ControlRpcClient, ControlRpcError, ControlRpcErrorKind,
        RunBootstrap, StartPayload,
    };
    use reqwest::StatusCode;
    use serde_json::json;
    use std::env;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex;
    use std::thread;

    static CONTROL_RPC_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn checkpoint_capability_is_rolling_compatible() {
        let without_capability: StartPayload = serde_json::from_value(json!({
            "runId": "run-without-capability",
            "workerId": "worker-without-capability",
            "serviceId": "service-without-capability",
            "model": "local-smoke",
            "leaseVersion": 1,
            "controlRpcBaseUrl": "http://127.0.0.1:1",
            "controlRpcToken": "token",
        }))
        .expect("start payload without checkpoint capability");
        assert!(!without_capability.supports_durable_checkpoints());

        let current: StartPayload = serde_json::from_value(json!({
            "runId": "run-current",
            "workerId": "worker-current",
            "serviceId": "service-current",
            "model": "local-smoke",
            "leaseVersion": 2,
            "checkpointProtocolVersion": 1,
            "controlRpcBaseUrl": "http://127.0.0.1:1",
            "controlRpcToken": "token",
        }))
        .expect("current start payload");
        assert!(current.supports_durable_checkpoints());

        assert!(
            serde_json::from_value::<super::EngineCheckpointLoadResponse>(json!({
                "checkpoint": null
            }))
            .is_err()
        );
    }

    #[test]
    fn control_rpc_error_kind_classifies_structured_lease_lost_payload() {
        assert_eq!(
            ControlRpcErrorKind::from_response(
                StatusCode::CONFLICT,
                r#"{"error":"lease_lost","detail":"replaced"}"#,
            ),
            ControlRpcErrorKind::LeaseLost,
        );
        assert_eq!(
            ControlRpcErrorKind::from_response(StatusCode::CONFLICT, r#"{"error":"in_progress"}"#,),
            ControlRpcErrorKind::Conflict,
        );
        assert_eq!(
            ControlRpcErrorKind::from_response(StatusCode::CONFLICT, "Lease lost"),
            ControlRpcErrorKind::LeaseLost,
        );
        assert_eq!(
            ControlRpcErrorKind::from_response(StatusCode::NOT_FOUND, ""),
            ControlRpcErrorKind::NotFound,
        );
        assert_eq!(
            ControlRpcErrorKind::from_response(StatusCode::INTERNAL_SERVER_ERROR, "boom",),
            ControlRpcErrorKind::Other,
        );
    }

    #[test]
    fn is_lease_lost_prefers_structured_error_over_substring() {
        let typed_error: Box<dyn std::error::Error + Send + Sync> = Box::new(ControlRpcError {
            kind: ControlRpcErrorKind::LeaseLost,
            status: Some(StatusCode::CONFLICT),
            // Deliberately omit the "Lease lost" substring so we know the
            // downcast — not the legacy string match — drove the result.
            message: "control-plane reported takeover".to_string(),
        });
        assert!(is_lease_lost(typed_error.as_ref()));

        let not_lease: Box<dyn std::error::Error + Send + Sync> = Box::new(ControlRpcError {
            kind: ControlRpcErrorKind::Conflict,
            status: Some(StatusCode::CONFLICT),
            message: "409 Conflict {\"error\":\"in_progress\"}".to_string(),
        });
        assert!(!is_lease_lost(not_lease.as_ref()));
    }

    #[test]
    fn run_authority_lost_includes_revoked_token_statuses_but_not_generic_conflict() {
        for status in [
            StatusCode::UNAUTHORIZED,
            StatusCode::FORBIDDEN,
            StatusCode::NOT_FOUND,
        ] {
            let revoked: Box<dyn std::error::Error + Send + Sync> = Box::new(ControlRpcError {
                kind: ControlRpcErrorKind::from_response(status, ""),
                status: Some(status),
                message: "run credential rejected".to_string(),
            });
            assert!(is_run_authority_lost(revoked.as_ref()));
        }

        let conflict: Box<dyn std::error::Error + Send + Sync> = Box::new(ControlRpcError {
            kind: ControlRpcErrorKind::Conflict,
            status: Some(StatusCode::CONFLICT),
            message: "ordinary state conflict".to_string(),
        });
        assert!(!is_run_authority_lost(conflict.as_ref()));
    }

    #[test]
    fn run_bootstrap_accepts_app_installation_context() {
        let bootstrap: RunBootstrap = serde_json::from_value(json!({
            "status": "running",
            "spaceId": "space_1",
            "installationId": "inst_1",
            "runtimeNamespace": "shared-cell://tokyo-cell-01/namespaces/inst_1",
            "threadId": "thread_1",
            "userId": "user_1",
            "agentType": "default"
        }))
        .expect("bootstrap should decode");

        assert_eq!(bootstrap.space_id, "space_1");
        assert_eq!(bootstrap.installation_id.as_deref(), Some("inst_1"));
        assert_eq!(
            bootstrap.runtime_namespace.as_deref(),
            Some("shared-cell://tokyo-cell-01/namespaces/inst_1")
        );
    }

    #[test]
    fn run_config_parser_uses_current_camel_case_fields_only() {
        let config = parse_run_config_response(&json!({
            "systemPrompt": "control prompt",
            "maxGraphSteps": 7,
            "maxToolRounds": 3
        }));

        assert_eq!(config.system_prompt, "control prompt");
        assert_eq!(config.max_graph_steps, Some(7));
        assert_eq!(config.max_tool_rounds, Some(3));
    }

    #[test]
    fn run_config_parser_ignores_snake_case_aliases() {
        let config = parse_run_config_response(&json!({
            "system_prompt": "old prompt",
            "max_iterations": 9,
            "max_graph_steps": 7,
            "max_tool_rounds": 3,
            "rate_limit": 2,
            "embedding_provider": "openai",
            "embedding_model": "text-embedding-3-small",
            "embedding_base_url": "https://api.example/v1",
            "embedding_api_key": "secret",
            "embedding_dimensions": 1536
        }));

        assert_eq!(config.system_prompt, "");
        assert_eq!(config.max_graph_steps, None);
        assert_eq!(config.max_tool_rounds, None);
    }

    #[tokio::test]
    async fn control_rpc_client_sends_executor_pool_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
        let address = listener.local_addr().expect("test listener address");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("test server should accept");
            let mut buffer = [0_u8; 4096];
            let mut request = Vec::new();
            let mut expected_len: Option<usize> = None;
            loop {
                let read = stream.read(&mut buffer).expect("request should read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if expected_len.is_none() {
                    if let Some(header_end) =
                        request.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_len = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                if name.eq_ignore_ascii_case("content-length") {
                                    value.trim().parse::<usize>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(0);
                        expected_len = Some(header_end + 4 + content_len);
                    }
                }
                if expected_len.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
                )
                .expect("response should write");
            String::from_utf8(request).expect("request should be utf8")
        });

        let client = control_rpc_client_with_env_cleared(&StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: Some("service-test".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(7),
            executor_tier: Some(3),
            executor_container_id: Some("tier3-scale-0".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");

        client.heartbeat().await.expect("heartbeat should succeed");
        let request = handle.join().expect("test server should join");
        let normalized = request.to_ascii_lowercase();

        assert!(normalized.contains("authorization: bearer test-token\r\n"));
        assert!(request.starts_with("POST /api/internal/v1/agent-control/heartbeat HTTP/1.1"));
        assert!(normalized.contains("x-takos-run-id: run-test\r\n"));
        assert!(normalized.contains("x-takos-executor-tier: 3\r\n"));
        assert!(
            normalized.contains("x-takos-executor-container-id: tier3-scale-0\r\n"),
            "request headers did not include executor container id: {request}",
        );
    }

    #[tokio::test]
    async fn control_rpc_client_complete_run_carries_atomic_transcript() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
        let address = listener.local_addr().expect("test listener address");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("test server should accept");
            let mut buffer = [0_u8; 4096];
            let mut request = Vec::new();
            let mut expected_len: Option<usize> = None;
            loop {
                let read = stream.read(&mut buffer).expect("request should read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if expected_len.is_none() {
                    if let Some(header_end) =
                        request.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_len = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                if name.eq_ignore_ascii_case("content-length") {
                                    value.trim().parse::<usize>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(0);
                        expected_len = Some(header_end + 4 + content_len);
                    }
                }
                if expected_len.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}",
                )
                .expect("response should write");
            String::from_utf8(request).expect("request should be utf8")
        });

        let client = control_rpc_client_with_env_cleared(&StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: Some("service-test".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(7),
            executor_tier: Some(3),
            executor_container_id: Some("tier3-scale-0".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");

        client
            .complete_run(
                "completed",
                super::UsagePayload::default(),
                Some("done"),
                None,
                vec![json!({
                    "role": "assistant",
                    "content": "done"
                })],
            )
            .await
            .expect("complete-run should succeed");

        let request = handle.join().expect("test server should join");
        let body = request
            .split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .expect("request should include http body");
        let parsed: serde_json::Value =
            serde_json::from_str(body).expect("request body should be json");

        assert_eq!(parsed["status"], "completed");
        assert_eq!(parsed["output"], "done");
        assert_eq!(parsed["serviceId"], "service-test");
        assert_eq!(parsed["leaseVersion"], 7);
        assert_eq!(parsed["messages"][0]["content"], "done");
    }

    #[tokio::test]
    async fn complete_run_replays_the_same_atomic_payload_on_transient_and_ambiguous_failures() {
        use axum::body::{to_bytes, Body};
        use axum::extract::State;
        use axum::http::{Request, StatusCode};
        use axum::response::{IntoResponse, Response};
        use axum::routing::post;
        use axum::{Json, Router};
        use std::sync::Arc;
        use tokio::sync::Mutex as AsyncMutex;

        type Captured = Arc<AsyncMutex<Vec<serde_json::Value>>>;
        async fn handler(State(captured): State<Captured>, request: Request<Body>) -> Response {
            let bytes = to_bytes(request.into_body(), 1024 * 1024)
                .await
                .expect("request body");
            let body = serde_json::from_slice(&bytes).expect("request JSON");
            let mut captured = captured.lock().await;
            captured.push(body);
            match captured.len() {
                1 => (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": "temporary" })),
                )
                    .into_response(),
                // A malformed success response is commit-ambiguous. Replaying
                // the same atomic completion is the only safe recovery.
                2 => (StatusCode::OK, "not-json").into_response(),
                _ => Json(json!({})).into_response(),
            }
        }

        let captured: Captured = Arc::new(AsyncMutex::new(Vec::new()));
        let app = Router::new()
            .fallback(post(handler))
            .with_state(captured.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("test server");
        });
        let client = control_rpc_client_with_env_cleared(&StartPayload {
            run_id: "run-complete-retry".to_string(),
            worker_id: "worker-complete-retry".to_string(),
            service_id: Some("service-complete-retry".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(11),
            executor_tier: Some(1),
            executor_container_id: Some("retry-container".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");

        client
            .complete_run(
                "completed",
                super::UsagePayload::default(),
                Some("done"),
                None,
                vec![json!({ "role": "assistant", "content": "done" })],
            )
            .await
            .expect("third identical atomic completion should succeed");

        server.abort();
        let captured = captured.lock().await;
        assert_eq!(captured.len(), 3);
        assert!(captured.iter().all(|payload| payload == &captured[0]));
        assert_eq!(captured[0]["status"], "completed");
    }

    #[tokio::test]
    async fn control_rpc_client_round_trips_engine_checkpoint_with_lease() {
        use axum::body::{to_bytes, Body};
        use axum::extract::State;
        use axum::http::Request;
        use axum::response::{IntoResponse, Response};
        use axum::routing::post;
        use axum::{Json, Router};
        use std::sync::Arc;
        use takos_agent_engine::domain::{LoopState, LoopStatus};
        use takos_agent_engine::ids::{LoopId, SessionId};
        use tokio::sync::Mutex as AsyncMutex;

        #[derive(Default)]
        struct CheckpointState {
            stored: Option<serde_json::Value>,
            save_attempts: usize,
            load_attempts: usize,
            save_payloads: Vec<serde_json::Value>,
        }
        type Stored = Arc<AsyncMutex<CheckpointState>>;
        async fn handler(State(stored): State<Stored>, request: Request<Body>) -> Response {
            let path = request.uri().path().to_string();
            let bytes = to_bytes(request.into_body(), 3 * 1024 * 1024)
                .await
                .expect("request body");
            let body: serde_json::Value =
                serde_json::from_slice(&bytes).expect("checkpoint request JSON");
            if path.ends_with("engine-checkpoint-save") {
                assert_eq!(body["leaseVersion"], 13);
                let mut stored = stored.lock().await;
                stored.save_attempts += 1;
                stored.save_payloads.push(body.clone());
                // Simulate a response failure after the exact checkpoint was
                // already accepted. The retry must replay the same payload.
                stored.stored = Some(body);
                if stored.save_attempts == 1 {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "response lost after commit" })),
                    )
                        .into_response();
                }
                return Json(json!({ "saved": true })).into_response();
            }
            let mut stored = stored.lock().await;
            stored.load_attempts += 1;
            if stored.load_attempts == 1 {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": "transient read failure" })),
                )
                    .into_response();
            }
            Json(json!({
                "checkpoint": stored.stored.as_ref().map(|value| value["checkpoint"].clone()),
                "usage": stored.stored.as_ref().map_or_else(
                    || json!({
                        "inputTokens": 0,
                        "outputTokens": 0,
                        "cachedInputTokens": 0,
                    }),
                    |value| value["usage"].clone(),
                ),
            }))
            .into_response()
        }

        let stored: Stored = Arc::new(AsyncMutex::new(CheckpointState::default()));
        let app = Router::new()
            .fallback(post(handler))
            .with_state(stored.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("test server");
        });
        let client = control_rpc_client_with_env_cleared(&StartPayload {
            run_id: "run-checkpoint".to_string(),
            worker_id: "worker-checkpoint".to_string(),
            service_id: Some("service-checkpoint".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(13),
            executor_tier: Some(1),
            executor_container_id: Some("checkpoint-container".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");
        let session_id = SessionId::new();
        let loop_id = LoopId::new();
        let checkpoint = LoopState {
            session_id,
            loop_id,
            current_node: "execute_tools".to_string(),
            status: LoopStatus::Running,
            state_json: json!({
                "session_id": session_id,
                "loop_id": loop_id,
                "execution_profile": "external_context",
            }),
        };
        let usage = crate::engine_support::UsageSnapshot {
            input_tokens: 120,
            output_tokens: 30,
            cached_input_tokens: 20,
        };

        client
            .save_engine_checkpoint(&checkpoint, &usage)
            .await
            .expect("checkpoint save");
        let (loaded, loaded_usage) = client
            .load_engine_checkpoint()
            .await
            .expect("checkpoint load");
        let loaded = loaded.expect("stored checkpoint");

        server.abort();
        assert_eq!(loaded, checkpoint);
        assert_eq!(loaded_usage, usage);
        let stored = stored.lock().await;
        assert_eq!(stored.save_attempts, 2);
        assert_eq!(stored.load_attempts, 2);
        assert_eq!(stored.save_payloads[0], stored.save_payloads[1]);
    }

    #[tokio::test]
    async fn control_rpc_client_parses_run_config_system_prompt() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("test listener should bind");
        let address = listener.local_addr().expect("test listener address");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("test server should accept");
            let mut buffer = [0_u8; 4096];
            let mut request = Vec::new();
            let mut expected_len: Option<usize> = None;
            loop {
                let read = stream.read(&mut buffer).expect("request should read");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                if expected_len.is_none() {
                    if let Some(header_end) =
                        request.windows(4).position(|window| window == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let content_len = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                if name.eq_ignore_ascii_case("content-length") {
                                    value.trim().parse::<usize>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(0);
                        expected_len = Some(header_end + 4 + content_len);
                    }
                }
                if expected_len.is_some_and(|length| request.len() >= length) {
                    break;
                }
            }
            let response_body =
                r#"{"systemPrompt":"control prompt","maxGraphSteps":7,"maxToolRounds":3}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("response should write");
            String::from_utf8(request).expect("request should be utf8")
        });

        let client = control_rpc_client_with_env_cleared(&StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: Some("service-test".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: None,
            executor_tier: None,
            executor_container_id: None,
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");

        let run_config = client
            .run_config(Some("implementer"))
            .await
            .expect("run config should parse");
        let request = handle.join().expect("test server should join");
        let body = request
            .split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .expect("request should include http body");
        let parsed: serde_json::Value =
            serde_json::from_str(body).expect("request body should be json");

        assert_eq!(parsed["agentType"], "implementer");
        assert_eq!(run_config.system_prompt, "control prompt");
        assert_eq!(run_config.max_graph_steps, Some(7));
        assert_eq!(run_config.max_tool_rounds, Some(3));
    }

    #[test]
    fn control_rpc_config_prefers_per_run_payload_over_stale_container_env() {
        let payload = StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: Some("service-test".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: None,
            executor_tier: None,
            executor_container_id: None,
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: "https://caller.example/".to_string(),
            control_rpc_token: "caller-token".to_string(),
        };

        let (base_url, token) = resolve_control_rpc_config(
            &payload,
            Some("https://env.example/base/".to_string()),
            Some(" env-token ".to_string()),
        )
        .expect("control RPC config should resolve");

        assert_eq!(base_url, "https://caller.example");
        assert_eq!(token, "caller-token");
    }

    #[test]
    fn control_rpc_config_uses_env_as_missing_payload_fallback() {
        let payload = StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: Some("service-test".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: None,
            executor_tier: None,
            executor_container_id: None,
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: "   ".to_string(),
            control_rpc_token: String::new(),
        };

        let (base_url, token) = resolve_control_rpc_config(
            &payload,
            Some("https://env.example/base/".to_string()),
            Some(" env-token ".to_string()),
        )
        .expect("control RPC env fallback should resolve");

        assert_eq!(base_url, "https://env.example/base");
        assert_eq!(token, "env-token");
    }

    #[test]
    fn control_rpc_client_keeps_takosumi_internal_url_separate_from_agent_rpc() {
        let _guard = CONTROL_RPC_ENV_LOCK
            .lock()
            .expect("env lock should not be poisoned");
        let saved = saved_control_rpc_env();
        clear_control_rpc_env();
        env::set_var("TAKOSUMI_INTERNAL_URL", "https://takosumi.internal");

        let client = ControlRpcClient::new(&StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: Some("service-test".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: None,
            executor_tier: None,
            executor_container_id: None,
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: "https://agent-control.example/".to_string(),
            control_rpc_token: "payload-token".to_string(),
        })
        .expect("control RPC client should build");

        restore_control_rpc_env(saved);
        assert_eq!(client.base_url, "https://agent-control.example");
    }

    fn control_rpc_client_with_env_cleared(
        payload: &StartPayload,
    ) -> crate::AppResult<ControlRpcClient> {
        let _guard = CONTROL_RPC_ENV_LOCK
            .lock()
            .expect("env lock should not be poisoned");
        let saved = saved_control_rpc_env();
        clear_control_rpc_env();
        let result = ControlRpcClient::new(payload);
        restore_control_rpc_env(saved);
        result
    }

    fn saved_control_rpc_env() -> Vec<(&'static str, Option<String>)> {
        [
            "TAKOS_AGENT_CONTROL_RPC_BASE_URL",
            "TAKOS_AGENT_CONTROL_RPC_TOKEN",
            "TAKOSUMI_INTERNAL_URL",
        ]
        .into_iter()
        .map(|key| (key, env::var(key).ok()))
        .collect()
    }

    fn clear_control_rpc_env() {
        for key in [
            "TAKOS_AGENT_CONTROL_RPC_BASE_URL",
            "TAKOS_AGENT_CONTROL_RPC_TOKEN",
            "TAKOSUMI_INTERNAL_URL",
        ] {
            env::remove_var(key);
        }
    }

    fn restore_control_rpc_env(saved: Vec<(&'static str, Option<String>)>) {
        for (key, value) in saved {
            if let Some(value) = value {
                env::set_var(key, value);
            } else {
                env::remove_var(key);
            }
        }
    }
}
