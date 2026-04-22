use std::io;
use std::sync::Arc;

use async_trait::async_trait;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use takos_agent_engine::model::{ModelInput, ModelOutput, ModelRunner, ToolCallRequest};

use crate::control_rpc::{ToolDefinition, UsagePayload};
use crate::engine_support::UsageTracker;
use crate::AppResult;

#[derive(Clone)]
pub struct TakosModelRunner {
    client: reqwest::Client,
    model: String,
    temperature: Option<f32>,
    openai_api_keys: Arc<Vec<String>>,
    tools: Arc<Vec<ToolDefinition>>,
    usage_tracker: Arc<UsageTracker>,
}

impl TakosModelRunner {
    #[allow(dead_code)]
    pub fn new(
        model: impl Into<String>,
        temperature: Option<f32>,
        openai_api_key: Option<String>,
        tools: Vec<ToolDefinition>,
        usage_tracker: Arc<UsageTracker>,
    ) -> Self {
        Self::new_with_openai_api_keys(
            model,
            temperature,
            openai_api_key.into_iter().collect(),
            tools,
            usage_tracker,
        )
    }

    pub fn new_with_openai_api_keys(
        model: impl Into<String>,
        temperature: Option<f32>,
        openai_api_keys: Vec<String>,
        tools: Vec<ToolDefinition>,
        usage_tracker: Arc<UsageTracker>,
    ) -> Self {
        Self {
            client: reqwest::Client::new(),
            model: model.into(),
            temperature,
            openai_api_keys: Arc::new(sanitize_api_keys(openai_api_keys)),
            tools: Arc::new(tools),
            usage_tracker,
        }
    }

    pub fn usage_payload(&self) -> UsagePayload {
        let snapshot = self.usage_tracker.snapshot();
        UsagePayload {
            input_tokens: snapshot.input_tokens,
            output_tokens: snapshot.output_tokens,
        }
    }

    fn use_local_smoke(&self) -> bool {
        self.model == "local-smoke" || self.openai_api_keys.is_empty()
    }

    fn build_runner_prompt(&self, input: &ModelInput) -> String {
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
        self.usage_tracker.record(prompt_tokens, output_tokens);

        Ok(ModelOutput {
            assistant_message: Some(lines.join("\n")),
            tool_calls: Vec::new(),
        })
    }

    async fn openai_response(&self, input: &ModelInput) -> AppResult<ModelOutput> {
        if self.openai_api_keys.is_empty() {
            return Err(io::Error::other("OpenAI API key is not configured").into());
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
            last_auth_error.unwrap_or_else(|| "OpenAI API key is not configured".to_string()),
        )
        .into())
    }

    async fn openai_response_with_key(
        &self,
        input: &ModelInput,
        api_key: &str,
    ) -> AppResult<ModelOutput> {
        let response = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(api_key)
            .json(&self.build_openai_request(input))
            .send()
            .await?;

        let status = response.status();
        let text = response.text().await?;
        if !status.is_success() {
            return Err(io::Error::other(format!(
                "OpenAI chat completions failed: {} {}",
                status, text
            ))
            .into());
        }

        self.decode_openai_response(text)
    }

    fn build_openai_request(&self, input: &ModelInput) -> OpenAiChatCompletionRequest {
        OpenAiChatCompletionRequest {
            model: self.model.clone(),
            temperature: self.temperature,
            messages: vec![
                OpenAiRequestMessage {
                    role: "system".to_string(),
                    content: Some(Value::String(input.system_prompt.clone())),
                },
                OpenAiRequestMessage {
                    role: "user".to_string(),
                    content: Some(Value::String(self.build_runner_prompt(input))),
                },
            ],
            tools: self
                .tools
                .iter()
                .map(|tool| OpenAiToolDefinition {
                    r#type: "function".to_string(),
                    function: OpenAiToolSpec {
                        name: tool.name.clone(),
                        description: tool.description.clone(),
                        parameters: tool.parameters.clone(),
                    },
                })
                .collect(),
            tool_choice: Some("auto".to_string()),
        }
    }

    fn decode_openai_response(&self, text: String) -> AppResult<ModelOutput> {
        let body: OpenAiChatCompletionResponse = serde_json::from_str(&text).map_err(|err| {
            io::Error::other(format!(
                "failed to decode OpenAI response: {err}; body={text}"
            ))
        })?;
        let choice = body
            .choices
            .into_iter()
            .next()
            .ok_or_else(|| io::Error::other("OpenAI returned no choices"))?;

        if let Some(usage) = body.usage {
            self.usage_tracker
                .record(usage.prompt_tokens, usage.completion_tokens);
        }

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
        })
    }
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
}

#[cfg(test)]
mod tests {
    use super::{is_openai_auth_failure, sanitize_api_keys};

    #[test]
    fn sanitize_api_keys_filters_empty_and_duplicate_values() {
        let keys = sanitize_api_keys(vec![
            " sk-one ".to_string(),
            "".to_string(),
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
}
