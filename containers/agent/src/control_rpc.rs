use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::{env, io};

use chrono::Utc;
use reqwest::StatusCode;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::internal_rpc::{sign_internal_rpc, InternalRpcSignInput, TakosActorContext};
use crate::AppResult;

/// Connect + read timeout for control-plane RPC calls. Picked to be short
/// enough that a stalled control plane can't keep an agent run wedged forever
/// while still giving room for normal Cloudflare round-trips.
const CONTROL_RPC_HTTP_TIMEOUT: Duration = Duration::from_secs(30);

const CONTROL_RPC_BASE_URL_ENV_KEY: &str = "TAKOS_AGENT_CONTROL_RPC_BASE_URL";
const CONTROL_RPC_TOKEN_ENV_KEY: &str = "TAKOS_AGENT_CONTROL_RPC_TOKEN";
const AGENT_CONTROL_RPC_PATH_PREFIX: &str = "/api/internal/v1/agent-control";
/// Operator-provided HMAC key for signing outbound control-plane RPC requests
/// using the shared `takos-internal-v3` envelope. When set, every `post_json`
/// caller signs its body with this key. The receiver (`takos`) MUST
/// independently configure the same key and run `verify_internal_rpc` over
/// incoming requests before trusting the bearer token — without that, this
/// header is purely advisory and any plain-bearer leak would still let an
/// attacker forge calls.
const CONTROL_RPC_INTERNAL_KEY_ENV_KEY: &str = "TAKOS_AGENT_INTERNAL_RPC_KEY";
const CONTROL_RPC_INTERNAL_CALLER: &str = "takos-agent";
const CONTROL_RPC_INTERNAL_AUDIENCE: &str = "takos-worker";
const CONTROL_RPC_INTERNAL_CAPABILITY: &str = "agent-control.rpc";

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
    #[serde(alias = "sessionId")]
    pub session_id: Option<String>,
    #[serde(alias = "threadId")]
    pub thread_id: String,
    #[serde(alias = "userId")]
    pub user_id: String,
    #[serde(alias = "agentType")]
    pub agent_type: Option<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RunContext {
    pub status: Option<String>,
    #[serde(alias = "threadId")]
    pub thread_id: Option<String>,
    #[serde(alias = "sessionId")]
    pub session_id: Option<String>,
    #[serde(alias = "lastUserMessage")]
    pub last_user_message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
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
    pub max_iterations: Option<u32>,
    pub max_graph_steps: Option<u32>,
    pub max_tool_rounds: Option<u32>,
    pub temperature: Option<f32>,
    pub rate_limit: Option<u32>,
    pub embedding_provider: Option<String>,
    pub embedding_model: Option<String>,
    pub embedding_base_url: Option<String>,
    pub embedding_api_key: Option<String>,
    pub embedding_dimensions: Option<u32>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ApiKeysResponse {
    pub openai: Option<String>,
    pub anthropic: Option<String>,
    pub google: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
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
    pub output: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UsagePayload {
    #[serde(rename = "inputTokens")]
    pub input_tokens: usize,
    #[serde(rename = "outputTokens")]
    pub output_tokens: usize,
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
    internal_rpc_key: Option<String>,
    nonce_counter: Arc<AtomicU64>,
}

impl ControlRpcClient {
    pub fn new(payload: &StartPayload) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent("takos-agent/0.1.0")
            .timeout(CONTROL_RPC_HTTP_TIMEOUT)
            .build()?;
        let (base_url, token) = resolve_control_rpc_config(
            payload,
            nonempty_env(CONTROL_RPC_BASE_URL_ENV_KEY),
            nonempty_env(CONTROL_RPC_TOKEN_ENV_KEY),
        )?;
        let internal_rpc_key = nonempty_env(CONTROL_RPC_INTERNAL_KEY_ENV_KEY);
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
            internal_rpc_key,
            nonce_counter: Arc::new(AtomicU64::new(1)),
        })
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst)
    }

    fn idempotency_hash(value: &str) -> String {
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in value.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
        format!("{hash:x}")
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

    pub async fn run_context(&self) -> AppResult<RunContext> {
        self.post_control_json(
            "run-context",
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

    pub async fn tool_execute(&self, name: &str, arguments: Value) -> AppResult<RpcToolResult> {
        self.post_control_json(
            "tool-execute",
            json!({
                "runId": self.run_id,
                "toolCall": {
                    "id": format!("takos-agent-{}", uuid::Uuid::new_v4()),
                    "name": name,
                    "arguments": arguments,
                }
            }),
        )
        .await
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

    pub async fn add_assistant_message(
        &self,
        thread_id: &str,
        content: &str,
        metadata: Option<Value>,
    ) -> AppResult<()> {
        let idempotency_key = format!(
            "run:{}:assistant-message:{}",
            self.run_id,
            Self::idempotency_hash(content)
        );
        let mut body = json!({
            "threadId": thread_id,
            "idempotencyKey": idempotency_key,
            "message": {
                "role": "assistant",
                "content": content,
            },
        });
        if let Some(metadata) = metadata {
            body["metadata"] = metadata;
        }
        let _: Value = self.post_control_json("add-message", body).await?;
        Ok(())
    }

    pub async fn update_run_status(
        &self,
        status: &str,
        usage: UsagePayload,
        output: Option<&str>,
        error: Option<&str>,
    ) -> AppResult<()> {
        let _: Value = self
            .post_control_json(
                "update-run-status",
                json!({
                    "runId": self.run_id,
                    "status": status,
                    "usage": usage,
                    "output": output,
                    "error": error,
                }),
            )
            .await?;
        Ok(())
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
        self.post_json(&path, body).await
    }

    async fn post_json<T: DeserializeOwned>(&self, path: &str, body: Value) -> AppResult<T> {
        let url = format!("{}{}", self.base_url, path);
        // Serialize the body to a deterministic JSON string so the HMAC body
        // digest covers exactly the bytes we send on the wire.
        let body_bytes = serde_json::to_vec(&body).map_err(|err| {
            io::Error::other(format!("failed to encode {path} request body: {err}"))
        })?;
        let body_string = std::str::from_utf8(&body_bytes)
            .map_err(|err| {
                io::Error::other(format!("{path} request body is not valid utf-8: {err}"))
            })?
            .to_string();
        let mut request = self
            .http
            .post(url)
            .bearer_auth(&self.token)
            .header("Content-Type", "application/json")
            .header("X-Takos-Run-Id", &self.run_id);
        if let Some(executor_tier) = self.executor_tier {
            request = request.header("X-Takos-Executor-Tier", executor_tier.to_string());
        }
        if let Some(executor_container_id) = &self.executor_container_id {
            request = request.header("X-Takos-Executor-Container-Id", executor_container_id);
        }
        // When the operator has provisioned an internal HMAC key, attach a
        // signed envelope (capability, actor context, body digest, nonce,
        // timestamp). The receiver on takos must independently verify the
        // signature via `verify_internal_rpc` before trusting the bearer.
        if let Some(secret) = self.internal_rpc_key.as_deref() {
            let request_id = format!("agent-{}-{}", self.run_id, uuid::Uuid::new_v4());
            let nonce = format!(
                "agent-{}-{}",
                self.run_id,
                self.nonce_counter.fetch_add(1, Ordering::Relaxed),
            );
            let timestamp = Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
            let actor = TakosActorContext {
                actor_account_id: CONTROL_RPC_INTERNAL_CALLER.into(),
                space_id: None,
                roles: vec!["agent".into()],
                request_id: request_id.clone(),
                principal_kind: Some("service".into()),
                service_id: Some(self.service_id.clone()),
                agent_id: Some(self.run_id.clone()),
            };
            let signed = sign_internal_rpc(&InternalRpcSignInput {
                method: "POST",
                path,
                query: None,
                body: &body_string,
                actor: &actor,
                caller: CONTROL_RPC_INTERNAL_CALLER,
                audience: CONTROL_RPC_INTERNAL_AUDIENCE,
                capabilities: &[CONTROL_RPC_INTERNAL_CAPABILITY],
                request_id: Some(&request_id),
                nonce: &nonce,
                timestamp: &timestamp,
                secret,
            })
            .map_err(io::Error::other)?;
            for (name, value) in signed.headers {
                request = request.header(name, value);
            }
        }
        let response = request.body(body_bytes).send().await?;
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
            kind: ControlRpcErrorKind::Network,
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
            kind: ControlRpcErrorKind::Other,
            status: Some(status),
            message: format!("failed to decode {path} response: {err}; body={text}"),
        })
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
}

fn parse_run_config_response(payload: &Value) -> RunConfigResponse {
    RunConfigResponse {
        system_prompt: string_field(payload, &["systemPrompt"]).unwrap_or_default(),
        max_iterations: u32_field(payload, &["maxIterations"]),
        max_graph_steps: u32_field(payload, &["maxGraphSteps"]),
        max_tool_rounds: u32_field(payload, &["maxToolRounds"]),
        temperature: f32_field(payload, &["temperature"]),
        rate_limit: u32_field(payload, &["rateLimit"]),
        embedding_provider: string_field(payload, &["embeddingProvider"]),
        embedding_model: string_field(payload, &["embeddingModel"]),
        embedding_base_url: string_field(payload, &["embeddingBaseUrl"]),
        embedding_api_key: string_field(payload, &["embeddingApiKey"]),
        embedding_dimensions: u32_field(payload, &["embeddingDimensions"]),
    }
}

fn resolve_control_rpc_config(
    payload: &StartPayload,
    env_base_url: Option<String>,
    env_token: Option<String>,
) -> AppResult<(String, String)> {
    let mut base_url = env_base_url
        .unwrap_or_else(|| payload.control_rpc_base_url.clone())
        .trim()
        .to_string();
    while base_url.ends_with('/') {
        base_url.pop();
    }
    if base_url.is_empty() {
        return Err(io::Error::other("agent control RPC base URL must not be empty").into());
    }
    let token = env_token
        .unwrap_or_else(|| payload.control_rpc_token.clone())
        .trim()
        .to_string();
    if token.is_empty() {
        return Err(io::Error::other("agent control RPC token must not be empty").into());
    }
    Ok((base_url, token))
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
        is_lease_lost, parse_run_config_response, resolve_control_rpc_config, ControlRpcClient,
        ControlRpcError, ControlRpcErrorKind, RunBootstrap, StartPayload,
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
    fn run_bootstrap_accepts_app_installation_context() {
        let bootstrap: RunBootstrap = serde_json::from_value(json!({
            "status": "running",
            "spaceId": "space_1",
            "installationId": "inst_1",
            "runtimeNamespace": "shared-cell://tokyo-cell-01/namespaces/inst_1",
            "sessionId": "session_1",
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
            "maxIterations": 9,
            "maxGraphSteps": 7,
            "maxToolRounds": 3,
            "rateLimit": 2,
            "embeddingProvider": "openai",
            "embeddingModel": "text-embedding-3-small",
            "embeddingBaseUrl": "https://api.example/v1",
            "embeddingApiKey": "secret",
            "embeddingDimensions": 1536
        }));

        assert_eq!(config.system_prompt, "control prompt");
        assert_eq!(config.max_iterations, Some(9));
        assert_eq!(config.max_graph_steps, Some(7));
        assert_eq!(config.max_tool_rounds, Some(3));
        assert_eq!(config.rate_limit, Some(2));
        assert_eq!(config.embedding_provider.as_deref(), Some("openai"));
        assert_eq!(
            config.embedding_model.as_deref(),
            Some("text-embedding-3-small")
        );
        assert_eq!(
            config.embedding_base_url.as_deref(),
            Some("https://api.example/v1")
        );
        assert_eq!(config.embedding_api_key.as_deref(), Some("secret"));
        assert_eq!(config.embedding_dimensions, Some(1536));
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
        assert_eq!(config.max_iterations, None);
        assert_eq!(config.max_graph_steps, None);
        assert_eq!(config.max_tool_rounds, None);
        assert_eq!(config.rate_limit, None);
        assert_eq!(config.embedding_provider, None);
        assert_eq!(config.embedding_model, None);
        assert_eq!(config.embedding_base_url, None);
        assert_eq!(config.embedding_api_key, None);
        assert_eq!(config.embedding_dimensions, None);
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
    async fn control_rpc_client_add_assistant_message_includes_metadata() {
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
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");

        client
            .add_assistant_message(
                "thread-1",
                "done",
                Some(json!({
                    "tool_executions": [{
                        "tool_call_id": "rust-tool-1",
                        "name": "repo_list",
                        "summary": "repo_list output=ok",
                        "output": "ok",
                        "error": null,
                    }]
                })),
            )
            .await
            .expect("assistant message should succeed");

        let request = handle.join().expect("test server should join");
        let body = request
            .split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .expect("request should include http body");
        let parsed: serde_json::Value =
            serde_json::from_str(body).expect("request body should be json");

        assert_eq!(parsed["threadId"], "thread-1");
        assert_eq!(parsed["message"]["content"], "done");
        assert!(parsed["message"]["metadata"].is_null());
        assert_eq!(
            parsed["metadata"]["tool_executions"][0]["tool_call_id"],
            "rust-tool-1",
        );
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
            let response_body = r#"{"systemPrompt":"control prompt","maxIterations":9,"maxGraphSteps":7,"maxToolRounds":3}"#;
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
        assert_eq!(run_config.max_iterations, Some(9));
        assert_eq!(run_config.max_graph_steps, Some(7));
        assert_eq!(run_config.max_tool_rounds, Some(3));
    }

    #[test]
    fn control_rpc_config_prefers_env_values_over_payload_values() {
        let payload = StartPayload {
            run_id: "run-test".to_string(),
            worker_id: "worker-test".to_string(),
            service_id: Some("service-test".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: None,
            executor_tier: None,
            executor_container_id: None,
            control_rpc_base_url: "https://caller.example/".to_string(),
            control_rpc_token: "caller-token".to_string(),
        };

        let (base_url, token) = resolve_control_rpc_config(
            &payload,
            Some("https://env.example/base/".to_string()),
            Some(" env-token ".to_string()),
        )
        .expect("control RPC config should resolve");

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
