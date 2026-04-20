use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use reqwest::StatusCode;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};

use crate::AppResult;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPayload {
    pub run_id: String,
    pub worker_id: String,
    pub service_id: Option<String>,
    pub model: Option<String>,
    pub lease_version: Option<u32>,
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
#[derive(Debug, Clone, Default)]
pub struct SkillPlanResponse {
    pub locale: String,
    pub activated_skills: Vec<ActivatedSkill>,
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
    sequence: Arc<AtomicU64>,
}

impl ControlRpcClient {
    pub fn new(payload: &StartPayload) -> AppResult<Self> {
        let http = reqwest::Client::builder()
            .user_agent("takos-rust-agent/0.1.0")
            .build()?;
        let mut base_url = payload.control_rpc_base_url.trim().to_string();
        while base_url.ends_with('/') {
            base_url.pop();
        }
        if base_url.is_empty() {
            return Err(io::Error::other("control RPC base URL must not be empty").into());
        }
        Ok(Self {
            http,
            base_url,
            token: payload.control_rpc_token.clone(),
            run_id: payload.run_id.clone(),
            service_id: payload.resolved_service_id().to_string(),
            lease_version: payload.lease_version,
            sequence: Arc::new(AtomicU64::new(1)),
        })
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn next_sequence(&self) -> u64 {
        self.sequence.fetch_add(1, Ordering::SeqCst)
    }

    fn idempotency_hash(value: &str) -> String {
        let mut hash: u64 = 0xcbf29ce484222325;
        for byte in value.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        format!("{:x}", hash)
    }

    pub async fn run_bootstrap(&self) -> AppResult<RunBootstrap> {
        self.post_json(
            "/rpc/control/run-bootstrap",
            json!({
                "runId": self.run_id,
            }),
        )
        .await
    }

    pub async fn run_context(&self) -> AppResult<RunContext> {
        self.post_json(
            "/rpc/control/run-context",
            json!({
                "runId": self.run_id,
            }),
        )
        .await
    }

    pub async fn run_config(&self, agent_type: Option<&str>) -> AppResult<RunConfigResponse> {
        let payload: Value = self
            .post_json(
                "/rpc/control/run-config",
                json!({
                    "runId": self.run_id,
                    "agentType": agent_type.unwrap_or("default"),
                }),
            )
            .await?;
        Ok(RunConfigResponse {
            system_prompt: string_field(&payload, &["systemPrompt", "system_prompt"])
                .unwrap_or_default(),
            max_iterations: u32_field(&payload, &["maxIterations", "max_iterations"]),
            max_graph_steps: u32_field(&payload, &["max_graph_steps"]),
            max_tool_rounds: u32_field(&payload, &["max_tool_rounds"]),
            temperature: f32_field(&payload, &["temperature"]),
            rate_limit: u32_field(&payload, &["rateLimit", "rate_limit"]),
        })
    }

    pub async fn conversation_history(
        &self,
        thread_id: &str,
        space_id: &str,
        ai_model: &str,
    ) -> AppResult<ConversationHistoryResponse> {
        self.post_json(
            "/rpc/control/conversation-history",
            json!({
                "runId": self.run_id,
                "threadId": thread_id,
                "spaceId": space_id,
                "aiModel": ai_model,
            }),
        )
        .await
    }

    #[allow(dead_code)]
    pub async fn skill_plan(
        &self,
        thread_id: &str,
        space_id: &str,
        agent_type: &str,
        history: &[HistoryMessage],
        available_tool_names: &[String],
    ) -> AppResult<SkillPlanResponse> {
        let payload: Value = self
            .post_json(
                "/rpc/control/skill-plan",
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

        let activated_skills = payload
            .get("activatedSkills")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| serde_json::from_value::<ActivatedSkill>(value).ok())
            .collect();

        Ok(SkillPlanResponse {
            locale: string_field(&payload, &["locale", "skillLocale"])
                .unwrap_or_else(|| "en".to_string()),
            activated_skills,
        })
    }

    #[allow(dead_code)]
    pub async fn skill_catalog(
        &self,
        thread_id: &str,
        space_id: &str,
        agent_type: &str,
        history: &[HistoryMessage],
        available_tool_names: &[String],
    ) -> AppResult<SkillCatalogResponse> {
        let payload: Value = self
            .post_json(
                "/rpc/control/skill-catalog",
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

        let skills = payload
            .get("skills")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|value| serde_json::from_value::<ActivatedSkill>(value).ok())
            .collect();

        let resolution_context = payload
            .get("resolutionContext")
            .cloned()
            .or_else(|| payload.get("resolution_context").cloned())
            .and_then(|value| serde_json::from_value::<SkillResolutionContext>(value).ok())
            .unwrap_or_default();

        Ok(SkillCatalogResponse {
            locale: string_field(&payload, &["locale"]).unwrap_or_else(|| "en".to_string()),
            skills,
            resolution_context,
            managed_source: Some("control".to_string()),
        })
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
            .post_json(
                "/rpc/control/skill-runtime-context",
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
        self.post_json(
            "/rpc/control/tool-catalog",
            json!({
                "runId": self.run_id,
            }),
        )
        .await
    }

    pub async fn tool_execute(&self, name: &str, arguments: Value) -> AppResult<RpcToolResult> {
        self.post_json(
            "/rpc/control/tool-execute",
            json!({
                "runId": self.run_id,
                "toolCall": {
                    "id": format!("rust-agent-{}", uuid::Uuid::new_v4()),
                    "name": name,
                    "arguments": arguments,
                }
            }),
        )
        .await
    }

    pub async fn tool_cleanup(&self) -> AppResult<()> {
        let _: Value = self
            .post_json(
                "/rpc/control/tool-cleanup",
                json!({
                    "runId": self.run_id,
                }),
            )
            .await?;
        Ok(())
    }

    pub async fn heartbeat(&self) -> AppResult<()> {
        let _: Value = self
            .post_json(
                "/rpc/control/heartbeat",
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
        self.post_json(
            "/rpc/control/api-keys",
            json!({
                "runId": self.run_id,
            }),
        )
        .await
    }

    pub async fn add_assistant_message(&self, thread_id: &str, content: &str) -> AppResult<()> {
        let idempotency_key = format!(
            "run:{}:assistant-message:{}",
            self.run_id,
            Self::idempotency_hash(content)
        );
        let _: Value = self
            .post_json(
                "/rpc/control/add-message",
                json!({
                    "threadId": thread_id,
                    "idempotencyKey": idempotency_key,
                    "message": {
                        "role": "assistant",
                        "content": content,
                    }
                }),
            )
            .await?;
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
            .post_json(
                "/rpc/control/update-run-status",
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
            .post_json(
                "/rpc/control/run-event",
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

    async fn post_json<T: DeserializeOwned>(&self, path: &str, body: Value) -> AppResult<T> {
        let url = format!("{}{}", self.base_url, path);
        let response = self
            .http
            .post(url)
            .bearer_auth(&self.token)
            .header("X-Takos-Run-Id", &self.run_id)
            .json(&body)
            .send()
            .await?;
        Self::decode_response(path, response).await
    }

    async fn decode_response<T: DeserializeOwned>(
        path: &str,
        response: reqwest::Response,
    ) -> AppResult<T> {
        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            let detail = if text.is_empty() {
                status.to_string()
            } else {
                format!("{} {}", status, text)
            };
            return Err(io::Error::other(format!("{path} failed: {detail}")).into());
        }
        serde_json::from_str(&text).map_err(|err| {
            io::Error::other(format!(
                "failed to decode {path} response: {err}; body={text}"
            ))
            .into()
        })
    }
}

pub fn is_lease_lost(error: &(dyn std::error::Error + 'static)) -> bool {
    error
        .to_string()
        .contains(&StatusCode::CONFLICT.as_u16().to_string())
        || error.to_string().contains("Lease lost")
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
        payload
            .get(*key)
            .and_then(Value::as_f64)
            .map(|value| value as f32)
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
