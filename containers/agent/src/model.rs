use std::io;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use reqwest::header::HeaderMap;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use takos_agent_engine::model::{
    ConversationMessage, ConversationRole, ModelInput, ModelOutput, ModelRunner, ModelUsage,
    ToolCallRequest,
};
use tokio::time::Instant;

use crate::control_rpc::{ToolDefinition, UsagePayload};
use crate::engine_support::UsageTracker;
use crate::AppResult;

/// Default `OpenAI` Chat Completions endpoint. Centralised so the `mock-llm`
/// feature can override it without editing the production code path.
const DEFAULT_OPENAI_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";

/// Connect + read timeout for the wrapper-owned outbound model transport.
/// The engine calls this `ModelRunner`; it does not own a second HTTP timeout.
const MODEL_HTTP_TIMEOUT: Duration = Duration::from_secs(120);
/// Bound both provider cost and the amount of terminal text a single model
/// response can manufacture. This wrapper currently has no run-level output
/// token override, so the conservative cap is explicit on every request.
const MODEL_MAX_COMPLETION_TOKENS: u32 = 8_192;
const MODEL_MAX_RESPONSE_BODY_BYTES: usize = 4 * 1024 * 1024;
// Keep the provider response contract at or below the Worker complete-run
// validator. Reject before the engine executes any returned tool call so a
// valid provider response can always be committed atomically afterward.
const MODEL_MAX_ASSISTANT_CONTENT_BYTES: usize = 512 * 1024;
const MODEL_MAX_TOOL_CALLS: usize = 16;
const MODEL_MAX_TOOL_CALL_ID_BYTES: usize = 256;
const MODEL_MAX_TOOL_NAME_BYTES: usize = 256;
const MODEL_MAX_TOOL_ARGUMENT_BYTES: usize = 256 * 1024;
// The Worker complete-run parser owns an 8 MiB transcript cap. Reserve one MiB
// for JSON field names, metadata, correlation ids, and terminal framing. Before
// releasing model tool calls to the engine, also reserve the maximum 32 KiB
// result that the Worker can return for each call.
const MODEL_MAX_TURN_TRANSCRIPT_BYTES: usize = 7 * 1024 * 1024;
const WORKER_MAX_TOOL_RESULT_BYTES: usize = 32 * 1024;
const MODEL_MAX_ATTEMPTS: usize = 3;
const MODEL_RETRY_BASE_DELAY: Duration = Duration::from_millis(100);

const REPEATED_TOOL_FAILURE_THRESHOLD: usize = 2;
const TOOL_RECOVERY_INSTRUCTION: &str = "A tool has returned the same failure repeatedly. Do not call any tools in this response. Answer the user's request directly from the available context. If the task truly cannot be completed without that tool, explain the limitation once instead of retrying it.";
const UNAVAILABLE_TOOL_RECOVERY_INSTRUCTION: &str = "The previous response requested a tool that is not available in this runtime. Do not call any tools in this response. Answer the user's request directly from the available context. If the task truly requires an unavailable tool, explain the limitation once.";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OpenAiCompletionLimitField {
    MaxTokens,
    MaxCompletionTokens,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct OpenAiModelCapabilities {
    completion_limit_field: OpenAiCompletionLimitField,
    supports_temperature: bool,
}

impl OpenAiModelCapabilities {
    fn for_model(model: &str) -> Self {
        let normalized = model
            .rsplit('/')
            .next()
            .unwrap_or(model)
            .to_ascii_lowercase();
        if normalized == "gpt-5"
            || normalized.starts_with("gpt-5-")
            || normalized.starts_with("gpt-5.")
        {
            Self {
                completion_limit_field: OpenAiCompletionLimitField::MaxCompletionTokens,
                supports_temperature: false,
            }
        } else {
            Self {
                completion_limit_field: OpenAiCompletionLimitField::MaxTokens,
                supports_temperature: true,
            }
        }
    }
}

#[derive(Debug)]
struct ProviderRequestError {
    message: String,
    retryable: bool,
    retry_after: Option<Duration>,
}

impl ProviderRequestError {
    fn permanent(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retryable: false,
            retry_after: None,
        }
    }

    fn transient(message: impl Into<String>, retry_after: Option<Duration>) -> Self {
        Self {
            message: message.into(),
            retryable: true,
            retry_after,
        }
    }
}

impl std::fmt::Display for ProviderRequestError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ProviderRequestError {}

fn build_model_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(MODEL_HTTP_TIMEOUT)
        .build()
        .expect("OpenAI reqwest client builder must produce a client with default TLS")
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
        Self {
            client: build_model_http_client(),
            model: model.into(),
            temperature,
            openai_api_keys: Arc::new(sanitize_api_keys(openai_api_keys)),
            tools: Arc::new(tools),
            usage_tracker,
            endpoint: Arc::new(
                endpoint
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| DEFAULT_OPENAI_ENDPOINT.to_string()),
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
        // Current-turn tool exchanges are emitted as structured provider
        // messages. The legacy summary remains useful for memory-aware
        // embedders only when there is no native transcript to duplicate.
        if input.turn_messages.is_empty() && !input.tool_context.is_empty() {
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
            if let Some(spec) = input.user_message.strip_prefix("tool:") {
                let trimmed = spec.trim();
                let (name, args) = parse_tool_directive(trimmed)?;
                return Ok(ModelOutput {
                    assistant_message: None,
                    tool_calls: vec![ToolCallRequest {
                        id: None,
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
        if repeated_tool_failure {
            return self
                .send_openai_request(input, api_key, Some(TOOL_RECOVERY_INSTRUCTION))
                .await;
        }

        // Send the actual tool-capable request directly. A separate model
        // router call doubled latency/cost and shared the same node timeout,
        // while `tool_choice=auto` already lets the provider decide whether a
        // tool is needed.
        let output = self.send_openai_request(input, api_key, None).await?;
        if !self.has_unavailable_tool_call(&output) {
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
        let request = self.build_openai_request_with_recovery(input, recovery_instruction);
        let request_body = serde_json::to_vec(&request)
            .map_err(|err| io::Error::other(format!("failed to encode model request: {err}")))?;
        let max_attempts = if is_safe_pre_tool_model_call(input) {
            MODEL_MAX_ATTEMPTS
        } else {
            1
        };
        let deadline = Instant::now() + MODEL_HTTP_TIMEOUT;
        let mut attempt = 1;

        loop {
            let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
                return Err(Box::new(ProviderRequestError::permanent(
                    "OpenAI chat completions exceeded the total 120s transport budget",
                )));
            };
            let result = self
                .send_openai_request_once(api_key, request_body.clone(), remaining)
                .await;
            match result {
                Ok(output) => return Ok(output),
                Err(error) if error.retryable && attempt < max_attempts => {
                    let delay = model_retry_delay(attempt, error.retry_after);
                    let remaining = deadline
                        .checked_duration_since(Instant::now())
                        .unwrap_or_default();
                    if delay >= remaining {
                        return Err(Box::new(error));
                    }
                    tokio::time::sleep(delay).await;
                    attempt += 1;
                }
                Err(error) => return Err(Box::new(error)),
            }
        }
    }

    async fn send_openai_request_once(
        &self,
        api_key: &str,
        request_body: Vec<u8>,
        timeout: Duration,
    ) -> Result<ModelOutput, ProviderRequestError> {
        let response = self
            .client
            .post(self.endpoint.as_str())
            .timeout(timeout)
            .bearer_auth(api_key)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(request_body)
            .send()
            .await
            .map_err(|err| {
                let message = crate::redaction::redact_secret_text(&format!(
                    "OpenAI chat completions request failed: {err}"
                ));
                // A connect failure is known to precede an accepted model
                // request. Timeouts/body/request errors may happen after the
                // provider started a billable completion, so retrying them
                // without an upstream idempotency contract risks double cost.
                if err.is_connect() {
                    ProviderRequestError::transient(message, None)
                } else {
                    ProviderRequestError::permanent(message)
                }
            })?;

        let status = response.status();
        let retry_after = parse_retry_after(response.headers());
        let response_body = read_provider_response_limited(response, status).await?;
        let text = std::str::from_utf8(&response_body).map_err(|_| {
            ProviderRequestError::permanent(
                "OpenAI-compatible upstream returned a non-UTF-8 response body",
            )
        })?;
        if !status.is_success() {
            let message = format!(
                "OpenAI chat completions failed: {} {}",
                status,
                sanitize_provider_error_body(text)
            );
            if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
                return Err(ProviderRequestError::transient(message, retry_after));
            }
            return Err(ProviderRequestError::permanent(message));
        }

        self.decode_openai_response(text)
            .map_err(|err| ProviderRequestError::permanent(err.to_string()))
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

        let mut messages = vec![OpenAiRequestMessage::text("system", system_prompt)];
        messages.extend(
            input
                .conversation_history
                .iter()
                .filter_map(OpenAiRequestMessage::from_conversation),
        );
        messages.push(OpenAiRequestMessage::text(
            "user",
            Self::build_runner_prompt(input),
        ));
        messages.extend(
            input
                .turn_messages
                .iter()
                .filter_map(OpenAiRequestMessage::from_conversation),
        );

        let capabilities = OpenAiModelCapabilities::for_model(&self.model);
        let (max_tokens, max_completion_tokens) = match capabilities.completion_limit_field {
            OpenAiCompletionLimitField::MaxTokens => (Some(MODEL_MAX_COMPLETION_TOKENS), None),
            OpenAiCompletionLimitField::MaxCompletionTokens => {
                (None, Some(MODEL_MAX_COMPLETION_TOKENS))
            }
        };
        let temperature = if capabilities.supports_temperature {
            self.temperature
        } else {
            None
        };

        OpenAiChatCompletionRequest {
            model: self.model.clone(),
            temperature,
            max_tokens,
            max_completion_tokens,
            messages,
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

        let raw_tool_calls = choice.message.tool_calls.unwrap_or_default();
        if raw_tool_calls.len() > MODEL_MAX_TOOL_CALLS {
            return Err(io::Error::other(format!(
                "OpenAI-compatible upstream returned more than {MODEL_MAX_TOOL_CALLS} tool calls"
            ))
            .into());
        }
        let mut tool_calls = Vec::with_capacity(raw_tool_calls.len());
        for (index, call) in raw_tool_calls.into_iter().enumerate() {
            if call.id.is_empty() || call.id.len() > MODEL_MAX_TOOL_CALL_ID_BYTES {
                return Err(io::Error::other(format!(
                    "OpenAI-compatible upstream returned an invalid tool call id at index {index}"
                ))
                .into());
            }
            if call.function.name.is_empty() || call.function.name.len() > MODEL_MAX_TOOL_NAME_BYTES
            {
                return Err(io::Error::other(format!(
                    "OpenAI-compatible upstream returned an invalid tool name at index {index}"
                ))
                .into());
            }
            if call.function.arguments.len() > MODEL_MAX_TOOL_ARGUMENT_BYTES {
                return Err(io::Error::other(format!(
                    "OpenAI-compatible upstream returned oversized tool arguments at index {index}"
                ))
                .into());
            }
            let arguments = serde_json::from_str::<Value>(&call.function.arguments).map_err(|_| {
                io::Error::other(format!(
                    "OpenAI-compatible upstream returned invalid tool argument JSON at index {index}"
                ))
            })?;
            if !arguments.is_object() {
                return Err(io::Error::other(format!(
                    "OpenAI-compatible upstream returned non-object tool arguments at index {index}"
                ))
                .into());
            }
            tool_calls.push(ToolCallRequest {
                id: Some(call.id),
                name: call.function.name,
                arguments,
            });
        }

        let assistant_message = flatten_message_content(choice.message.content);
        if assistant_message
            .as_ref()
            .is_some_and(|content| content.len() > MODEL_MAX_ASSISTANT_CONTENT_BYTES)
        {
            return Err(io::Error::other(format!(
                "OpenAI-compatible upstream returned assistant content larger than {MODEL_MAX_ASSISTANT_CONTENT_BYTES} UTF-8 bytes"
            ))
            .into());
        }

        Ok(ModelOutput {
            assistant_message,
            tool_calls,
            usage: model_usage,
        })
    }
}

async fn read_provider_response_limited(
    mut response: reqwest::Response,
    status: StatusCode,
) -> Result<Vec<u8>, ProviderRequestError> {
    if response
        .content_length()
        .is_some_and(|length| length > MODEL_MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err(ProviderRequestError::permanent(format!(
            "OpenAI-compatible upstream response exceeded the {} byte limit",
            MODEL_MAX_RESPONSE_BODY_BYTES
        )));
    }

    let mut body = Vec::with_capacity(
        response
            .content_length()
            .and_then(|length| usize::try_from(length).ok())
            .unwrap_or_default()
            .min(MODEL_MAX_RESPONSE_BODY_BYTES),
    );
    while let Some(chunk) = response.chunk().await.map_err(|err| {
        let message = crate::redaction::redact_secret_text(&format!(
            "OpenAI chat completions response read failed: {err}"
        ));
        if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            ProviderRequestError::transient(message, None)
        } else {
            // A successful status followed by a truncated body is ambiguous:
            // the provider may already have generated and billed the output.
            // Do not resend it without a provider idempotency guarantee.
            ProviderRequestError::permanent(message)
        }
    })? {
        let next_len = body.len().checked_add(chunk.len()).ok_or_else(|| {
            ProviderRequestError::permanent("OpenAI-compatible upstream response size overflow")
        })?;
        if next_len > MODEL_MAX_RESPONSE_BODY_BYTES {
            return Err(ProviderRequestError::permanent(format!(
                "OpenAI-compatible upstream response exceeded the {} byte limit",
                MODEL_MAX_RESPONSE_BODY_BYTES
            )));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let value = headers.get(reqwest::header::RETRY_AFTER)?.to_str().ok()?;
    if let Ok(seconds) = value.trim().parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }
    let retry_at = httpdate::parse_http_date(value.trim()).ok()?;
    retry_at.duration_since(SystemTime::now()).ok()
}

fn is_safe_pre_tool_model_call(input: &ModelInput) -> bool {
    input.tool_context.is_empty()
        && input
            .turn_messages
            .iter()
            .all(|message| message.role != ConversationRole::Tool && message.tool_calls.is_empty())
}

fn model_retry_delay(failed_attempt: usize, retry_after: Option<Duration>) -> Duration {
    let exponent = u32::try_from(failed_attempt.saturating_sub(1)).unwrap_or(u32::MAX);
    let base = MODEL_RETRY_BASE_DELAY.saturating_mul(2_u32.saturating_pow(exponent.min(8)));
    let jitter_bound_ms = u64::try_from(base.as_millis() / 2)
        .unwrap_or(u64::MAX)
        .max(1);
    let entropy = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| u64::from(duration.subsec_nanos()));
    retry_after
        .unwrap_or(base)
        .saturating_add(Duration::from_millis(entropy % jitter_bound_ms))
}

fn has_repeated_tool_failure(input: &ModelInput) -> bool {
    let mut failures = input
        .tool_context
        .iter()
        .filter_map(|finding| finding.split_once(" error=").map(|(_, error)| error.trim()))
        .filter(|error| !error.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    failures.extend(input.turn_messages.iter().filter_map(|message| {
        if message.role != ConversationRole::Tool {
            return None;
        }
        serde_json::from_str::<Value>(&message.content)
            .ok()?
            .get("error")?
            .as_str()
            .map(str::trim)
            .filter(|error| !error.is_empty())
            .map(str::to_string)
    }));

    failures.iter().any(|candidate| {
        failures
            .iter()
            .filter(|error| *error == candidate)
            .take(REPEATED_TOOL_FAILURE_THRESHOLD)
            .count()
            >= REPEATED_TOOL_FAILURE_THRESHOLD
    })
}

#[async_trait]
impl ModelRunner for TakosModelRunner {
    async fn run(&self, input: ModelInput) -> takos_agent_engine::Result<ModelOutput> {
        let existing_bytes = conversation_wire_budget(&input.turn_messages);
        if existing_bytes > MODEL_MAX_TURN_TRANSCRIPT_BYTES {
            return Err(takos_agent_engine::EngineError::Model(format!(
                "agent turn transcript exceeds the {MODEL_MAX_TURN_TRANSCRIPT_BYTES} byte provider contract"
            )));
        }
        let result = if self.use_local_smoke() {
            self.local_smoke_response(&input)
        } else {
            self.openai_response(&input).await
        };
        let output =
            result.map_err(|err| takos_agent_engine::EngineError::Model(err.to_string()))?;
        let projected_bytes = existing_bytes
            .saturating_add(model_output_wire_budget(&output))
            .saturating_add(
                output
                    .tool_calls
                    .len()
                    .saturating_mul(WORKER_MAX_TOOL_RESULT_BYTES),
            );
        if projected_bytes > MODEL_MAX_TURN_TRANSCRIPT_BYTES {
            return Err(takos_agent_engine::EngineError::Model(format!(
                "model response would exceed the {MODEL_MAX_TURN_TRANSCRIPT_BYTES} byte terminal transcript contract"
            )));
        }
        Ok(output)
    }
}

fn tool_call_wire_budget(call: &ToolCallRequest) -> usize {
    128usize
        .saturating_add(call.id.as_ref().map_or(0, String::len))
        .saturating_add(call.name.len())
        .saturating_add(
            serde_json::to_vec(&call.arguments)
                .map_or(MODEL_MAX_TOOL_ARGUMENT_BYTES, |encoded| encoded.len()),
        )
}

fn conversation_wire_budget(messages: &[ConversationMessage]) -> usize {
    messages.iter().fold(0usize, |total, message| {
        total
            .saturating_add(256)
            .saturating_add(message.content.len())
            .saturating_add(message.tool_call_id.as_ref().map_or(0, String::len))
            .saturating_add(
                message
                    .tool_calls
                    .iter()
                    .map(tool_call_wire_budget)
                    .fold(0usize, usize::saturating_add),
            )
    })
}

fn model_output_wire_budget(output: &ModelOutput) -> usize {
    256usize
        .saturating_add(output.assistant_message.as_ref().map_or(0, String::len))
        .saturating_add(
            output
                .tool_calls
                .iter()
                .map(tool_call_wire_budget)
                .fold(0usize, usize::saturating_add),
        )
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
    crate::engine_support::estimate_tokens(text)
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
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_completion_tokens: Option<u32>,
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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<OpenAiRequestToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

impl OpenAiRequestMessage {
    fn text(role: &str, content: String) -> Self {
        Self {
            role: role.to_string(),
            content: Some(Value::String(content)),
            tool_calls: Vec::new(),
            tool_call_id: None,
        }
    }

    fn from_conversation(message: &ConversationMessage) -> Option<Self> {
        let role = match message.role {
            ConversationRole::System => "system",
            ConversationRole::User => "user",
            ConversationRole::Assistant => "assistant",
            ConversationRole::Tool => "tool",
        };
        if message.role == ConversationRole::Tool && message.tool_call_id.is_none() {
            return Some(Self::text(
                "user",
                format!("Historical tool result: {}", message.content),
            ));
        }
        Some(Self {
            role: role.to_string(),
            content: (!message.content.is_empty()).then(|| Value::String(message.content.clone())),
            tool_calls: message
                .tool_calls
                .iter()
                .map(OpenAiRequestToolCall::from_engine)
                .collect(),
            tool_call_id: message.tool_call_id.clone(),
        })
    }
}

#[derive(Debug, Serialize)]
struct OpenAiRequestToolCall {
    id: String,
    #[serde(rename = "type")]
    r#type: String,
    function: OpenAiRequestToolFunction,
}

impl OpenAiRequestToolCall {
    fn from_engine(call: &ToolCallRequest) -> Self {
        Self {
            id: call.id.clone().unwrap_or_else(|| {
                format!(
                    "call-{}",
                    crate::hash::fnv1a_hex(
                        &serde_json::json!({
                            "name": call.name,
                            "arguments": call.arguments,
                        })
                        .to_string(),
                    )
                )
            }),
            r#type: "function".to_string(),
            function: OpenAiRequestToolFunction {
                name: call.name.clone(),
                arguments: call.arguments.to_string(),
            },
        }
    }
}

#[derive(Debug, Serialize)]
struct OpenAiRequestToolFunction {
    name: String,
    arguments: String,
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
    id: String,
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use axum::response::{IntoResponse, Response};
    use axum::routing::post;
    use axum::{extract::State, Json, Router};
    use serde_json::{json, Value};
    use takos_agent_engine::model::{
        ConversationMessage, ConversationRole, ModelInput, ModelRunner,
    };
    use takos_agent_engine::{LoopId, SessionId};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::{
        conversation_wire_budget, is_openai_auth_failure, model_output_wire_budget,
        sanitize_api_keys, sanitize_provider_error_body, TakosModelRunner,
        MODEL_MAX_ASSISTANT_CONTENT_BYTES, MODEL_MAX_COMPLETION_TOKENS,
        MODEL_MAX_RESPONSE_BODY_BYTES, MODEL_MAX_TOOL_ARGUMENT_BYTES, MODEL_MAX_TOOL_CALLS,
        MODEL_MAX_TOOL_CALL_ID_BYTES, MODEL_MAX_TOOL_NAME_BYTES, MODEL_MAX_TURN_TRANSCRIPT_BYTES,
        TOOL_RECOVERY_INSTRUCTION, WORKER_MAX_TOOL_RESULT_BYTES,
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
            conversation_history: Vec::new(),
            turn_messages: Vec::new(),
            user_message: "51 + 52".to_string(),
            plan: None,
        }
    }

    fn toolbox_definition() -> ToolDefinition {
        ToolDefinition {
            name: "toolbox".to_string(),
            description: "Find and call available tools".to_string(),
            parameters: json!({ "type": "object" }),
            risk_level: Some("low".to_string()),
            side_effects: Some(false),
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
    fn repeated_external_context_tool_failure_forces_a_tool_free_final_request() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            vec![toolbox_definition()],
            Arc::new(UsageTracker::default()),
        );
        let mut input = model_input(Vec::new());
        input.turn_messages = ["call-1", "call-2"]
            .into_iter()
            .map(|tool_call_id| ConversationMessage {
                role: ConversationRole::Tool,
                content: json!({ "error": "tool_not_permitted: toolbox" }).to_string(),
                tool_call_id: Some(tool_call_id.to_string()),
                tool_calls: Vec::new(),
            })
            .collect();

        let request = runner.build_openai_request(&input);

        assert!(request.tools.is_empty());
        assert_eq!(request.tool_choice, None);
        assert!(matches!(
            request.messages[0].content.as_ref(),
            Some(Value::String(value)) if value.contains(TOOL_RECOVERY_INSTRUCTION)
        ));
    }

    #[test]
    fn runner_prompt_keeps_memory_context_without_duplicating_native_tool_messages() {
        let mut input = model_input(vec!["legacy tool summary".to_string()]);
        input.session_context = vec!["recent session item".to_string()];
        input.memory_context = vec!["activated memory item".to_string()];

        let legacy_prompt = TakosModelRunner::build_runner_prompt(&input);
        assert!(legacy_prompt.contains("Session Context:\nrecent session item"));
        assert!(legacy_prompt.contains("Memory Context:\nactivated memory item"));
        assert!(legacy_prompt.contains("Tool Findings:\nlegacy tool summary"));

        input.turn_messages.push(ConversationMessage {
            role: ConversationRole::Tool,
            content: json!({ "ok": true }).to_string(),
            tool_call_id: Some("call-1".to_string()),
            tool_calls: Vec::new(),
        });
        let native_prompt = TakosModelRunner::build_runner_prompt(&input);
        assert!(native_prompt.contains("Session Context:\nrecent session item"));
        assert!(native_prompt.contains("Memory Context:\nactivated memory item"));
        assert!(!native_prompt.contains("legacy tool summary"));
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

    #[test]
    fn gpt5_direct_request_uses_current_completion_contract() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gpt-5.5",
            Some(0.5),
            vec!["runtime-token".to_string()],
            vec![toolbox_definition()],
            Arc::new(UsageTracker::default()),
        );

        let request = runner.build_openai_request(&model_input(Vec::new()));
        let body = serde_json::to_value(request).expect("request must serialize");

        assert_eq!(body["model"], "gpt-5.5");
        assert_eq!(
            body["max_completion_tokens"],
            json!(MODEL_MAX_COMPLETION_TOKENS)
        );
        assert!(body.get("max_tokens").is_none());
        assert!(body.get("temperature").is_none());
    }

    #[test]
    fn non_gpt5_compatible_request_preserves_legacy_completion_contract() {
        let runner = TakosModelRunner::new_with_openai_api_keys_and_endpoint(
            "deepseek/chat",
            Some(0.5),
            vec!["runtime-token".to_string()],
            vec![toolbox_definition()],
            Arc::new(UsageTracker::default()),
            Some("https://gateway.example.test/v1/chat/completions".to_string()),
        );

        let request = runner.build_openai_request(&model_input(Vec::new()));
        let body = serde_json::to_value(request).expect("request must serialize");

        assert_eq!(body["model"], "deepseek/chat");
        assert_eq!(body["max_tokens"], json!(MODEL_MAX_COMPLETION_TOKENS));
        assert!(body.get("max_completion_tokens").is_none());
        assert_eq!(body["temperature"], json!(0.5));
    }

    #[test]
    fn tool_arguments_fail_closed_instead_of_becoming_raw_model_control_data() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            vec![toolbox_definition()],
            Arc::new(UsageTracker::default()),
        );
        let response = |arguments: &str| {
            json!({
                "choices": [{
                    "message": {
                        "content": null,
                        "tool_calls": [{
                            "id": "call-1",
                            "function": { "name": "toolbox", "arguments": arguments }
                        }]
                    }
                }]
            })
            .to_string()
        };

        let invalid = runner
            .decode_openai_response(&response("{not-json"))
            .expect_err("invalid JSON must fail closed");
        assert!(invalid.to_string().contains("invalid tool argument JSON"));
        assert!(!invalid.to_string().contains("{not-json"));

        let non_object = runner
            .decode_openai_response(&response("[1,2,3]"))
            .expect_err("non-object arguments must fail closed");
        assert!(non_object.to_string().contains("non-object tool arguments"));
    }

    #[test]
    fn tool_call_response_fields_and_fanout_are_bounded() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            vec![toolbox_definition()],
            Arc::new(UsageTracker::default()),
        );
        let response = |calls: Value| {
            json!({
                "choices": [{
                    "message": { "content": null, "tool_calls": calls }
                }]
            })
            .to_string()
        };
        let call = |id: String, name: String, arguments: String| {
            json!({
                "id": id,
                "function": { "name": name, "arguments": arguments }
            })
        };

        let too_many = (0..=MODEL_MAX_TOOL_CALLS)
            .map(|index| {
                call(
                    format!("call-{index}"),
                    "toolbox".to_string(),
                    "{}".to_string(),
                )
            })
            .collect::<Vec<_>>();
        assert!(runner
            .decode_openai_response(&response(json!(too_many)))
            .expect_err("tool fanout must be bounded")
            .to_string()
            .contains("more than"));

        let long_id = "i".repeat(MODEL_MAX_TOOL_CALL_ID_BYTES + 1);
        assert!(runner
            .decode_openai_response(&response(json!([call(
                long_id,
                "toolbox".to_string(),
                "{}".to_string()
            )])))
            .expect_err("tool id must be bounded")
            .to_string()
            .contains("invalid tool call id"));

        let long_name = "n".repeat(MODEL_MAX_TOOL_NAME_BYTES + 1);
        assert!(runner
            .decode_openai_response(&response(json!([call(
                "call-1".to_string(),
                long_name,
                "{}".to_string()
            )])))
            .expect_err("tool name must be bounded")
            .to_string()
            .contains("invalid tool name"));

        let oversized_arguments = format!(
            "{{\"value\":\"{}\"}}",
            "x".repeat(MODEL_MAX_TOOL_ARGUMENT_BYTES)
        );
        assert!(runner
            .decode_openai_response(&response(json!([call(
                "call-1".to_string(),
                "toolbox".to_string(),
                oversized_arguments
            )])))
            .expect_err("tool arguments must be bounded")
            .to_string()
            .contains("oversized tool arguments"));
    }

    #[test]
    fn assistant_content_matches_the_worker_terminal_contract() {
        let runner = TakosModelRunner::new_with_openai_api_keys(
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            Vec::new(),
            Arc::new(UsageTracker::default()),
        );
        let oversized = "x".repeat(MODEL_MAX_ASSISTANT_CONTENT_BYTES + 1);
        let response = json!({
            "choices": [{
                "message": { "content": oversized, "tool_calls": [] }
            }]
        })
        .to_string();

        let error = runner
            .decode_openai_response(&response)
            .expect_err("assistant content beyond complete-run must fail before tool execution");
        assert!(error.to_string().contains("assistant content larger than"));
    }

    #[test]
    fn turn_transcript_budget_reserves_every_worker_tool_result() {
        let calls = (0..MODEL_MAX_TOOL_CALLS)
            .map(|index| takos_agent_engine::model::ToolCallRequest {
                id: Some(format!("call-{index}")),
                name: "write".to_string(),
                arguments: json!({ "payload": "x".repeat(1024) }),
            })
            .collect::<Vec<_>>();
        let output = takos_agent_engine::model::ModelOutput {
            assistant_message: Some("working".to_string()),
            tool_calls: calls,
            usage: None,
        };
        let projected = model_output_wire_budget(&output).saturating_add(
            output
                .tool_calls
                .len()
                .saturating_mul(WORKER_MAX_TOOL_RESULT_BYTES),
        );
        assert!(projected < MODEL_MAX_TURN_TRANSCRIPT_BYTES);

        let existing = vec![ConversationMessage {
            role: ConversationRole::Tool,
            content: "x".repeat(MODEL_MAX_TURN_TRANSCRIPT_BYTES),
            tool_call_id: Some("call-old".to_string()),
            tool_calls: Vec::new(),
        }];
        assert!(conversation_wire_budget(&existing) > MODEL_MAX_TURN_TRANSCRIPT_BYTES);
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
                conversation_history: Vec::new(),
                turn_messages: Vec::new(),
                user_message: "hello".to_string(),
                plan: None,
            })
            .await
            .expect_err("non-smoke model without keys must fail");

        assert!(error
            .to_string()
            .contains("OpenAI-compatible API key is not configured"));
    }

    #[tokio::test]
    async fn safe_pre_tool_model_call_retries_rate_limits_and_5xx_with_retry_after() {
        #[derive(Clone)]
        struct RetryState(Arc<AtomicUsize>);

        async fn handler(State(state): State<RetryState>) -> Response {
            let attempt = state.0.fetch_add(1, Ordering::SeqCst);
            if attempt == 0 {
                return (
                    axum::http::StatusCode::TOO_MANY_REQUESTS,
                    [(reqwest::header::RETRY_AFTER, "0")],
                    Json(json!({ "error": "slow down" })),
                )
                    .into_response();
            }
            if attempt == 1 {
                return (
                    axum::http::StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": "temporary" })),
                )
                    .into_response();
            }
            Json(json!({
                "choices": [{ "message": { "content": "done", "tool_calls": [] } }]
            }))
            .into_response()
        }

        let attempts = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/chat/completions", post(handler))
            .with_state(RetryState(attempts.clone()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("test server");
        });
        let runner = TakosModelRunner::new_with_endpoint(
            format!("http://{address}/v1/chat/completions"),
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            Vec::new(),
            Arc::new(UsageTracker::default()),
        );

        let output = runner
            .run(model_input(Vec::new()))
            .await
            .expect("safe pre-tool request should retry");

        server.abort();
        assert_eq!(attempts.load(Ordering::SeqCst), 3);
        assert_eq!(output.assistant_message.as_deref(), Some("done"));
    }

    #[tokio::test]
    async fn ambiguous_transport_disconnect_is_not_retried() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let attempts_for_server = attempts.clone();
        let server = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                attempts_for_server.fetch_add(1, Ordering::SeqCst);
                // Accept the request connection and close it without an HTTP
                // response, producing a real transport-level ambiguity.
                drop(stream);
            }
        });
        let runner = TakosModelRunner::new_with_endpoint(
            format!("http://{address}/v1/chat/completions"),
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            Vec::new(),
            Arc::new(UsageTracker::default()),
        );

        let error = runner
            .run(model_input(Vec::new()))
            .await
            .expect_err("an ambiguous disconnect must remain an error");

        server.abort();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(error.to_string().contains("request failed"));
    }

    #[tokio::test]
    async fn truncated_success_response_is_not_retried() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let attempts_for_server = attempts.clone();
        let server = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                attempts_for_server.fetch_add(1, Ordering::SeqCst);
                let mut request = vec![0_u8; 8 * 1024];
                let _ = stream.read(&mut request).await;
                stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 128\r\nConnection: close\r\n\r\n{\"choices\":[",
                    )
                    .await
                    .expect("partial response");
                let _ = stream.shutdown().await;
            }
        });
        let runner = TakosModelRunner::new_with_endpoint(
            format!("http://{address}/v1/chat/completions"),
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            Vec::new(),
            Arc::new(UsageTracker::default()),
        );

        let error = runner
            .run(model_input(Vec::new()))
            .await
            .expect_err("a truncated successful completion is ambiguous");

        server.abort();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(error.to_string().contains("response read failed"));
    }

    #[tokio::test]
    async fn post_tool_model_call_does_not_retry_transient_provider_failure() {
        #[derive(Clone)]
        struct RetryState(Arc<AtomicUsize>);

        async fn handler(State(state): State<RetryState>) -> Response {
            state.0.fetch_add(1, Ordering::SeqCst);
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "temporary" })),
            )
                .into_response()
        }

        let attempts = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/chat/completions", post(handler))
            .with_state(RetryState(attempts.clone()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("test server");
        });
        let runner = TakosModelRunner::new_with_endpoint(
            format!("http://{address}/v1/chat/completions"),
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            Vec::new(),
            Arc::new(UsageTracker::default()),
        );

        let error = runner
            .run(model_input(vec!["toolbox output={}".to_string()]))
            .await
            .expect_err("post-tool request must not retry automatically");

        server.abort();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(error.to_string().contains("503"));
    }

    #[tokio::test]
    async fn provider_response_body_is_byte_bounded_before_json_decode() {
        #[derive(Clone)]
        struct BodyState(Arc<AtomicUsize>);

        async fn handler(State(state): State<BodyState>) -> Response {
            state.0.fetch_add(1, Ordering::SeqCst);
            (
                axum::http::StatusCode::OK,
                "x".repeat(MODEL_MAX_RESPONSE_BODY_BYTES + 1),
            )
                .into_response()
        }

        let attempts = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/chat/completions", post(handler))
            .with_state(BodyState(attempts.clone()));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("test server");
        });
        let runner = TakosModelRunner::new_with_endpoint(
            format!("http://{address}/v1/chat/completions"),
            "gateway-model",
            None,
            vec!["runtime-token".to_string()],
            Vec::new(),
            Arc::new(UsageTracker::default()),
        );

        let error = runner
            .run(model_input(Vec::new()))
            .await
            .expect_err("oversized provider body must fail closed");

        server.abort();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
        assert!(error.to_string().contains("response exceeded"));
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
