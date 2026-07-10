use std::io;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use takos_agent_engine::model::{
    ModelInput, ModelOutput, ModelRunner, ModelUsage, ToolCallRequest,
};

use crate::control_rpc::{ToolDefinition, UsagePayload};
use crate::engine_support::UsageTracker;
use crate::AppResult;

/// Default `OpenAI` Chat Completions endpoint. Centralised so the `mock-llm`
/// feature can override it without editing the production code path.
const DEFAULT_OPENAI_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";

/// Connect + read timeout for outbound LLM calls. Matches the default that
/// `takos_agent_engine::model::openai_chat::OpenAiChatConfig` uses so the two
/// runners observe the same upstream behaviour.
const MODEL_HTTP_TIMEOUT: Duration = Duration::from_secs(60);

const REPEATED_TOOL_FAILURE_THRESHOLD: usize = 2;
const TOOL_RECOVERY_INSTRUCTION: &str = "A tool has returned the same failure repeatedly. Do not call any tools in this response. Answer the user's request directly from the available context. If the task truly cannot be completed without that tool, explain the limitation once instead of retrying it.";
const UNAVAILABLE_TOOL_RECOVERY_INSTRUCTION: &str = "The previous response requested a tool that is not available in this runtime. Do not call any tools in this response. Answer the user's request directly from the available context. If the task truly requires an unavailable tool, explain the limitation once.";

fn build_model_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(MODEL_HTTP_TIMEOUT)
        .build()
        .expect("OpenAI reqwest client builder must produce a client with default TLS")
}

/// Returns the model endpoint, preferring the `TAKOS_AGENT_MODEL_ENDPOINT`
/// environment variable over the compiled-in default.
fn get_model_endpoint() -> String {
    std::env::var("TAKOS_AGENT_MODEL_ENDPOINT")
        .unwrap_or_else(|_| DEFAULT_OPENAI_ENDPOINT.to_string())
}

/// Returns the model name override from `TAKOS_AGENT_MODEL_NAME` if set.
fn get_model_name_override() -> Option<String> {
    std::env::var("TAKOS_AGENT_MODEL_NAME")
        .ok()
        .filter(|v| !v.is_empty())
}

#[derive(Clone)]
pub struct TakosModelRunner {
    client: reqwest::Client,
    model: String,
    temperature: Option<f32>,
    openai_api_keys: Arc<Vec<String>>,
    tools: Arc<Vec<ToolDefinition>>,
    usage_tracker: Arc<UsageTracker>,
    endpoint: Arc<String>,
}

impl TakosModelRunner {
    #[cfg(test)]
    pub fn new_with_openai_api_keys(
        model: impl Into<String>,
        temperature: Option<f32>,
        openai_api_keys: Vec<String>,
        tools: Vec<ToolDefinition>,
        usage_tracker: Arc<UsageTracker>,
    ) -> Self {
        Self::new_with_openai_api_keys_and_endpoint(
            model,
            temperature,
            openai_api_keys,
            tools,
            usage_tracker,
            None,
        )
    }

    pub fn new_with_openai_api_keys_and_endpoint(
        model: impl Into<String>,
        temperature: Option<f32>,
        openai_api_keys: Vec<String>,
        tools: Vec<ToolDefinition>,
        usage_tracker: Arc<UsageTracker>,
        endpoint: Option<String>,
    ) -> Self {
        let resolved_model = get_model_name_override().unwrap_or_else(|| model.into());
        Self {
            client: build_model_http_client(),
            model: resolved_model,
            temperature,
            openai_api_keys: Arc::new(sanitize_api_keys(openai_api_keys)),
            tools: Arc::new(tools),
            usage_tracker,
            endpoint: Arc::new(
                endpoint
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(get_model_endpoint),
            ),
        }
    }

    /// Phase 20E test-only constructor: route Chat Completions calls at a
    /// caller-supplied endpoint (e.g. a local mock `OpenAI` stub) instead of
    /// the public `OpenAI` API. The flag is gated on the `mock-llm` Cargo
    /// feature so production builds never expose the alternate path.
    #[cfg(any(test, feature = "mock-llm"))]
    #[allow(dead_code)]
    pub fn new_with_endpoint(
        endpoint: impl Into<String>,
        model: impl Into<String>,
        temperature: Option<f32>,
        openai_api_keys: Vec<String>,
        tools: Vec<ToolDefinition>,
        usage_tracker: Arc<UsageTracker>,
    ) -> Self {
        Self {
            client: build_model_http_client(),
            model: model.into(),
            temperature,
            openai_api_keys: Arc::new(sanitize_api_keys(openai_api_keys)),
            tools: Arc::new(tools),
            usage_tracker,
            endpoint: Arc::new(endpoint.into()),
        }
    }

    pub fn usage_payload(&self) -> UsagePayload {
        let snapshot = self.usage_tracker.snapshot();
        UsagePayload {
            input_tokens: snapshot.input_tokens,
            output_tokens: snapshot.output_tokens,
            cached_input_tokens: snapshot.cached_input_tokens,
        }
    }

    fn use_local_smoke(&self) -> bool {
        self.model == "local-smoke"
    }

    fn build_runner_prompt(input: &ModelInput) -> String {
        let mut sections = Vec::new();
        if !input.session_context.is_empty() {
            sections.push(format!(
                "Session Context:\n{}",
                input.session_context.join("\n")
            ));
        }
        if !input.memory_context.is_empty() {
            sections.push(format!(
                "Memory Context:\n{}",
                input.memory_context.join("\n")
            ));
        }
        if !input.tool_context.is_empty() {
            sections.push(format!("Tool Findings:\n{}", input.tool_context.join("\n")));
        }
        if let Some(plan) = &input.plan {
            sections.push(format!("Plan:\n{plan}"));
        }
        sections.push(format!("User Message:\n{}", input.user_message));
        sections.join("\n\n")
    }

    fn local_smoke_response(&self, input: &ModelInput) -> AppResult<ModelOutput> {
        if input.tool_context.is_empty() {
            if let Some(query) = input.user_message.strip_prefix("memory:") {
                return Ok(ModelOutput {
                    assistant_message: None,
                    tool_calls: vec![ToolCallRequest {
                        name: "semantic_search_memory".to_string(),
                        arguments: json!({
                            "query": query.trim(),
                            "target": "both",
                            "top_k": 4
                        }),
                    }],
                    usage: None,
                });
            }

            if let Some(rest) = input.user_message.strip_prefix("timeline:") {
                let session_id = rest.trim();
                return Ok(ModelOutput {
                    assistant_message: None,
                    tool_calls: vec![ToolCallRequest {
                        name: "timeline_search".to_string(),
                        arguments: json!({
                            "session_id": if session_id.is_empty() { Value::Null } else { Value::String(session_id.to_string()) },
                            "limit": 8
                        }),
                    }],
                    usage: None,
                });
            }

            if let Some(spec) = input.user_message.strip_prefix("tool:") {
                let trimmed = spec.trim();
                let (name, args) = parse_tool_directive(trimmed)?;
                return Ok(ModelOutput {
                    assistant_message: None,
                    tool_calls: vec![ToolCallRequest {
                        name,
                        arguments: args,
                    }],
                    usage: None,
                });
            }
        }

        let mut lines = Vec::new();
        lines.push("engine=rust_agent".to_string());
        lines.push(format!("model={}", self.model));
        lines.push(format!("session={}", input.session_id));
        lines.push(format!("loop={}", input.loop_id));
        if !input.memory_context.is_empty() {
            lines.push(format!("memory_hits={}", input.memory_context.len()));
        }
        if !input.tool_context.is_empty() {
            lines.push(format!("tool_findings={}", input.tool_context.join(" | ")));
        }
        lines.push(format!("user={}", input.user_message));

        let prompt_tokens =
            estimate_tokens(&input.system_prompt) + estimate_tokens(&input.user_message);
        let output_tokens = lines.iter().map(|line| estimate_tokens(line)).sum();
        // Local/smoke estimate path: no provider usage, so no cached tokens.
        self.usage_tracker.record(prompt_tokens, output_tokens, 0);

        Ok(ModelOutput {
            assistant_message: Some(lines.join("\n")),
            tool_calls: Vec::new(),
            usage: None,
        })
    }

    async fn openai_response(&self, input: &ModelInput) -> AppResult<ModelOutput> {
        if self.openai_api_keys.is_empty() {
            return Err(io::Error::other("OpenAI-compatible API key is not configured").into());
        }

        let mut last_auth_error: Option<String> = None;
        for (index, api_key) in self.openai_api_keys.iter().enumerate() {
            match self.openai_response_with_key(input, api_key).await {
                Ok(output) => return Ok(output),
                Err(err) => {
                    let message = err.to_string();
                    if is_openai_auth_failure(&message) && index + 1 < self.openai_api_keys.len() {
                        last_auth_error = Some(message);
                        continue;
                    }
                    return Err(err);
                }
            }
        }

        Err(io::Error::other(
            last_auth_error
                .unwrap_or_else(|| "OpenAI-compatible API key is not configured".to_string()),
        )
        .into())
    }

    async fn openai_response_with_key(
        &self,
        input: &ModelInput,
        api_key: &str,
    ) -> AppResult<ModelOutput> {
        let repeated_tool_failure = has_repeated_tool_failure(input);
        let first_recovery_instruction = repeated_tool_failure.then_some(TOOL_RECOVERY_INSTRUCTION);
        let output = self
            .send_openai_request(input, api_key, first_recovery_instruction)
            .await?;
        if repeated_tool_failure || !self.has_unavailable_tool_call(&output) {
            return Ok(output);
        }

        self.send_openai_request(input, api_key, Some(UNAVAILABLE_TOOL_RECOVERY_INSTRUCTION))
            .await
    }

    async fn send_openai_request(
        &self,
        input: &ModelInput,
        api_key: &str,
        recovery_instruction: Option<&str>,
    ) -> AppResult<ModelOutput> {
        let response = self
            .client
            .post(self.endpoint.as_str())
            .bearer_auth(api_key)
            .json(&self.build_openai_request_with_recovery(input, recovery_instruction))
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(io::Error::other(format!(
                "OpenAI chat completions failed: {} {}",
                status,
                sanitize_provider_error_body(&text)
            ))
            .into());
        }

        self.decode_openai_response(&text)
    }

    #[cfg(test)]
    fn build_openai_request(&self, input: &ModelInput) -> OpenAiChatCompletionRequest {
        let recovery_instruction =
            has_repeated_tool_failure(input).then_some(TOOL_RECOVERY_INSTRUCTION);
        self.build_openai_request_with_recovery(input, recovery_instruction)
    }

    fn build_openai_request_with_recovery(
        &self,
        input: &ModelInput,
        recovery_instruction: Option<&str>,
    ) -> OpenAiChatCompletionRequest {
        let force_final_answer = recovery_instruction.is_some();
        let tools = if force_final_answer {
            Vec::new()
        } else {
            self.tools
                .iter()
                .map(|tool| OpenAiToolDefinition {
                    r#type: "function".to_string(),
                    function: OpenAiToolSpec {
                        name: tool.name.clone(),
                        description: tool.description.clone(),
                        parameters: tool.parameters.clone(),
                    },
                })
                .collect::<Vec<_>>()
        };
        let tool_choice = if tools.is_empty() {
            None
        } else {
            Some("auto".to_string())
        };
        let system_prompt = recovery_instruction.map_or_else(
            || input.system_prompt.clone(),
            |instruction| format!("{}\n\n{instruction}", input.system_prompt),
        );

        OpenAiChatCompletionRequest {
            model: self.model.clone(),
            temperature: self.temperature,
            messages: vec![
                OpenAiRequestMessage {
                    role: "system".to_string(),
                    content: Some(Value::String(system_prompt)),
                },
                OpenAiRequestMessage {
                    role: "user".to_string(),
                    content: Some(Value::String(Self::build_runner_prompt(input))),
                },
            ],
            tools,
            tool_choice,
        }
    }

    fn has_unavailable_tool_call(&self, output: &ModelOutput) -> bool {
        output
            .tool_calls
            .iter()
            .any(|call| !self.tools.iter().any(|tool| tool.name == call.name))
    }

    fn decode_openai_response(&self, text: &str) -> AppResult<ModelOutput> {
        let body: OpenAiChatCompletionResponse = serde_json::from_str(text).map_err(|err| {
            // The raw body may contain a reflected credential; redact before it
            // becomes an error string that is logged / persisted.
            io::Error::other(format!(
                "failed to decode OpenAI response: {err}; body={}",
                sanitize_provider_error_body(text)
            ))
        })?;
        let choice =
            body.choices.into_iter().next().ok_or_else(|| {
                io::Error::other("OpenAI-compatible upstream returned no choices")
            })?;

        // prompt_tokens is the TOTAL prompt tokens (cached + uncached);
        // prompt_tokens_details.cached_tokens is the cached subset. Record it for
        // billing AND surface it on ModelOutput so the engine can reconcile its
        // token estimate against ground truth.
        let model_usage = body.usage.as_ref().map(|usage| {
            let cached = usage
                .prompt_tokens_details
                .as_ref()
                .map_or(0, |details| details.cached_tokens);
            self.usage_tracker
                .record(usage.prompt_tokens, usage.completion_tokens, cached);
            ModelUsage {
                input_tokens: usage.prompt_tokens as u32,
                output_tokens: usage.completion_tokens as u32,
                cached_input_tokens: cached as u32,
            }
        });

        let tool_calls = choice
            .message
            .tool_calls
            .unwrap_or_default()
            .into_iter()
            .map(|call| {
                let arguments =
                    serde_json::from_str(&call.function.arguments).unwrap_or_else(|_| {
                        json!({
                            "_raw": call.function.arguments,
                        })
                    });
                ToolCallRequest {
                    name: call.function.name,
                    arguments,
                }
            })
            .collect::<Vec<_>>();

        let assistant_message = flatten_message_content(choice.message.content);

        Ok(ModelOutput {
            assistant_message,
            tool_calls,
            usage: model_usage,
        })
    }
}

fn has_repeated_tool_failure(input: &ModelInput) -> bool {
    input.tool_context.iter().any(|candidate| {
        let Some((_, candidate_error)) = candidate.split_once(" error=") else {
            return false;
        };
        let candidate_error = candidate_error.trim();
        !candidate_error.is_empty()
            && input
                .tool_context
                .iter()
                .filter_map(|finding| finding.split_once(" error=").map(|(_, error)| error.trim()))
                .filter(|error| *error == candidate_error)
                .take(REPEATED_TOOL_FAILURE_THRESHOLD)
                .count()
                >= REPEATED_TOOL_FAILURE_THRESHOLD
    })
}

#[async_trait]
impl ModelRunner for TakosModelRunner {
    async fn run(&self, input: ModelInput) -> takos_agent_engine::Result<ModelOutput> {
        let result = if self.use_local_smoke() {
            self.local_smoke_response(&input)
        } else {
            self.openai_response(&input).await
        };
        result.map_err(|err| takos_agent_engine::EngineError::Model(err.to_string()))
    }
}

fn parse_tool_directive(input: &str) -> AppResult<(String, Value)> {
    let mut parts = input.splitn(2, char::is_whitespace);
    let name = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| io::Error::other("tool directive is missing a tool name"))?;
    let args = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(serde_json::from_str::<Value>)
        .transpose()
        .map_err(|err| io::Error::other(format!("invalid tool directive JSON: {err}")))?
        .unwrap_or_else(|| json!({}));
    Ok((name.to_string(), args))
}

fn estimate_tokens(text: &str) -> usize {
    text.split_whitespace().count().max(1)
}

fn sanitize_api_keys(keys: Vec<String>) -> Vec<String> {
    let mut sanitized = Vec::new();
    for value in keys {
        let trimmed = value.trim();
        if trimmed.is_empty() || sanitized.iter().any(|existing| existing == trimmed) {
            continue;
        }
        sanitized.push(trimmed.to_string());
    }
    sanitized
}

fn is_openai_auth_failure(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains(StatusCode::UNAUTHORIZED.as_str())
        || normalized.contains("invalid_api_key")
        || normalized.contains("incorrect api key")
}

fn sanitize_provider_error_body(body: &str) -> String {
    const MAX_ERROR_BODY_CHARS: usize = 512;
    // Use the shared strong redactor (provider keys, AWS ids, JWTs, Bearer
    // pairs, emails) — NOT a `sk-`-only scrub — so a non-OpenAI provider key or
    // a reflected Authorization header in the upstream error body is removed
    // before the message reaches logs / persisted run records.
    let redacted = crate::redaction::redact_secret_text(body);
    if redacted.chars().count() <= MAX_ERROR_BODY_CHARS {
        return redacted;
    }
    let mut truncated = redacted
        .chars()
        .take(MAX_ERROR_BODY_CHARS)
        .collect::<String>();
    truncated.push_str("...");
    truncated
}

fn flatten_message_content(content: Option<Value>) -> Option<String> {
    let content = content?;
    match content {
        Value::String(text) => Some(text),
        Value::Array(parts) => {
            let mut lines = Vec::new();
            for part in parts {
                match part {
                    Value::Object(map) => {
                        if let Some(Value::String(text)) = map.get("text") {
                            lines.push(text.clone());
                        } else if let Some(Value::String(text)) = map.get("content") {
                            lines.push(text.clone());
                        }
                    }
                    Value::String(text) => lines.push(text),
                    _ => {}
                }
            }
            if lines.is_empty() {
                None
            } else {
                Some(lines.join("\n"))
            }
        }
        other => Some(other.to_string()),
    }
}

#[derive(Debug, Serialize)]
struct OpenAiChatCompletionRequest {
    model: String,
    messages: Vec<OpenAiRequestMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tools: Vec<OpenAiToolDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<String>,
}

#[derive(Debug, Serialize)]
struct OpenAiRequestMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<Value>,
}

#[derive(Debug, Serialize)]
struct OpenAiToolDefinition {
    #[serde(rename = "type")]
    r#type: String,
    function: OpenAiToolSpec,
}

#[derive(Debug, Serialize)]
struct OpenAiToolSpec {
    name: String,
    description: String,
    parameters: Value,
}

#[derive(Debug, Deserialize)]
struct OpenAiChatCompletionResponse {
    choices: Vec<OpenAiChoice>,
    usage: Option<OpenAiUsage>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: OpenAiResponseMessage,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponseMessage {
    content: Option<Value>,
    tool_calls: Option<Vec<OpenAiToolCall>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolCall {
    function: OpenAiToolFunction,
}

#[derive(Debug, Deserialize)]
struct OpenAiToolFunction {
    name: String,
    arguments: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiUsage {
    prompt_tokens: usize,
    completion_tokens: usize,
    // Some OpenAI-compatible upstreams report the cached subset of prompt_tokens.
    #[serde(default)]
    prompt_tokens_details: Option<OpenAiPromptTokensDetails>,
}

#[derive(Debug, Deserialize, Default)]
struct OpenAiPromptTokensDetails {
    #[serde(default)]
    cached_tokens: usize,
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{json, Value};
    use takos_agent_engine::model::{ModelInput, ModelRunner};
    use takos_agent_engine::{LoopId, SessionId};

    use super::{
        is_openai_auth_failure, sanitize_api_keys, sanitize_provider_error_body, TakosModelRunner,
        TOOL_RECOVERY_INSTRUCTION,
    };
    use crate::control_rpc::ToolDefinition;
    use crate::engine_support::UsageTracker;

    fn model_input(tool_context: Vec<String>) -> ModelInput {
        ModelInput {
            session_id: SessionId::new(),
            loop_id: LoopId::new(),
            system_prompt: "system".to_string(),
            session_context: Vec::new(),
            memory_context: Vec::new(),
            tool_context,
            user_message: "51 + 52".to_string(),
            plan: None,
        }
    }

    fn toolbox_definition() -> ToolDefinition {
        ToolDefinition {
            name: "toolbox".to_string(),
            description: "Find and call available tools".to_string(),
            parameters: json!({ "type": "object" }),
        }
    }

    #[test]
    fn sanitize_api_keys_filters_empty_and_duplicate_values() {
        let keys = sanitize_api_keys(vec![
            " sk-one ".to_string(),
            String::new(),
            "sk-one".to_string(),
            "sk-two".to_string(),
        ]);

        assert_eq!(keys, vec!["sk-one", "sk-two"]);
    }

    #[test]
    fn openai_auth_failure_detects_invalid_key_errors() {
        assert!(is_openai_auth_failure(
            "OpenAI chat completions failed: 401 Unauthorized {\"code\":\"invalid_api_key\"}",
        ));
        assert!(is_openai_auth_failure("Incorrect API key provided"));
        assert!(!is_openai_auth_failure(
            "OpenAI chat completions failed: 429 Too Many Requests",
        ));
    }

    #[test]
    fn run_scoped_endpoint_overrides_the_container_default() {
        let runner = TakosModelRunner::new_with_openai_api_keys_and_endpoint(
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            Vec::new(),
            Arc::new(UsageTracker::default()),
            Some(" https://gateway.example.test/v1/chat/completions ".to_string()),
        );

        assert_eq!(
            runner.endpoint.as_str(),
            "https://gateway.example.test/v1/chat/completions"
        );
    }

    #[test]
    fn repeated_same_tool_failure_forces_a_tool_free_final_request() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            vec![toolbox_definition()],
            Arc::new(UsageTracker::default()),
        );
        let failure = "toolbox error=tool \"math\" is missing a capability descriptor".to_string();

        let request = runner.build_openai_request(&model_input(vec![
            failure.clone(),
            "toolbox output={\"results\":[]}".to_string(),
            failure,
        ]));

        assert!(request.tools.is_empty());
        assert_eq!(request.tool_choice, None);
        assert!(matches!(
            request.messages[0].content.as_ref(),
            Some(Value::String(value)) if value.contains(TOOL_RECOVERY_INSTRUCTION)
        ));
    }

    #[test]
    fn one_tool_failure_keeps_the_catalog_available() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            vec![toolbox_definition()],
            Arc::new(UsageTracker::default()),
        );

        let request = runner.build_openai_request(&model_input(vec![
            "toolbox error=temporary upstream failure".to_string(),
        ]));

        assert_eq!(request.tools.len(), 1);
        assert_eq!(request.tool_choice.as_deref(), Some("auto"));
        assert!(matches!(
            request.messages[0].content.as_ref(),
            Some(Value::String(value)) if !value.contains(TOOL_RECOVERY_INSTRUCTION)
        ));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn missing_openai_key_does_not_fall_back_to_local_smoke() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gpt-test",
            None,
            Vec::new(),
            Vec::new(),
            Arc::new(UsageTracker::default()),
        );

        let error = runner
            .run(ModelInput {
                session_id: SessionId::new(),
                loop_id: LoopId::new(),
                system_prompt: "system".to_string(),
                session_context: Vec::new(),
                memory_context: Vec::new(),
                tool_context: Vec::new(),
                user_message: "hello".to_string(),
                plan: None,
            })
            .await
            .expect_err("non-smoke model without keys must fail");

        assert!(error
            .to_string()
            .contains("OpenAI-compatible API key is not configured"));
    }

    #[test]
    fn provider_error_body_redacts_secret_like_tokens_and_truncates() {
        let body = format!("bad key sk-secret {}", "x".repeat(700));
        let sanitized = sanitize_provider_error_body(&body);

        assert!(!sanitized.contains("sk-secret"));
        assert!(sanitized.contains("<redacted>"));
        assert!(sanitized.ends_with("..."));
    }
}
