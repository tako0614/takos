//! Phase 20E — takos-agent mock LLM e2e integration test.
//!
//! Spins up a local axum HTTP server stubbing the `OpenAI` Chat Completions
//! endpoint, points `TakosModelRunner` at it via the `mock-llm`-gated
//! `new_with_endpoint` constructor, and asserts:
//!
//!   1. A canned `tool_calls` response is decoded into the engine
//!      `ModelOutput.tool_calls` shape so the agent's tool-execution loop can
//!      schedule the call (the canonical e2e flow: thread -> mock LLM ->
//!      `tool_call` response -> `tool_bridge` dispatch -> conversation update).
//!   2. A canned assistant `content` response is surfaced as
//!      `ModelOutput.assistant_message` so the run loop terminates with a
//!      user-visible reply.
//!   3. Usage tracking (`prompt_tokens` / `completion_tokens`) flows through
//!      to `TakosModelRunner.usage_payload()`.
//!   4. The `local-smoke` model precedence rule still triggers when the model
//!      name is `local-smoke`: the mock server is never called and the
//!      built-in directives (`memory:` / `tool:`) intercept the prompt before
//!      any HTTP request fires. This is the same precedence that guards
//!      `skill_resolution` / memory tool short-circuits in production.
//!
//! Run with:
//!   cd takos/containers/agent
//!   cargo test --features mock-llm
//!
//! The test file is gated on the `mock-llm` Cargo feature (see Cargo.toml)
//! so production builds never compile the alternate constructor.

#![cfg(feature = "mock-llm")]

use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use takos_agent::control_rpc::{
    ControlRpcClient, RunConfigResponse, SkillCatalogResponse, StartPayload, ToolDefinition,
};
use takos_agent::engine_support::{
    build_engine_deps, resolve_embedding_backend_config, UsageTracker,
};
use takos_agent::model::TakosModelRunner;
use takos_agent::tool_bridge::CompositeToolExecutor;
use takos_agent_engine::ids::{LoopId, SessionId};
use takos_agent_engine::model::{Embedding, ModelInput, ModelRunner};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

// ---------------------------------------------------------------------------
// Mock OpenAI server
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
struct CapturedRequest {
    body: Value,
    auth_header: Option<String>,
}

#[derive(Clone)]
struct MockState {
    responses: Arc<Mutex<VecDeque<Value>>>,
    requests: Arc<Mutex<Vec<CapturedRequest>>>,
}

struct MockOpenAiServer {
    addr: SocketAddr,
    responses: Arc<Mutex<VecDeque<Value>>>,
    requests: Arc<Mutex<Vec<CapturedRequest>>>,
    handle: JoinHandle<()>,
}

impl MockOpenAiServer {
    async fn start(initial_response: Value) -> Self {
        Self::start_sequence(vec![initial_response]).await
    }

    async fn start_sequence(responses: Vec<Value>) -> Self {
        assert!(
            !responses.is_empty(),
            "mock response sequence must not be empty"
        );
        let responses = Arc::new(Mutex::new(VecDeque::from(responses)));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = MockState {
            responses: responses.clone(),
            requests: requests.clone(),
        };
        let app = Router::new()
            .route("/v1/chat/completions", post(handle_chat_completions))
            .route("/embeddings", post(handle_embeddings))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind mock server");
        let addr = listener.local_addr().expect("local_addr");
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self {
            addr,
            responses,
            requests,
            handle,
        }
    }

    fn endpoint(&self) -> String {
        format!("http://{}/v1/chat/completions", self.addr)
    }

    fn embedding_base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    async fn set_response(&self, response: Value) {
        let mut responses = self.responses.lock().await;
        responses.clear();
        responses.push_back(response);
    }

    async fn captured_requests(&self) -> Vec<CapturedRequest> {
        self.requests.lock().await.clone()
    }
}

impl Drop for MockOpenAiServer {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

async fn handle_chat_completions(
    State(state): State<MockState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_mock_request(&state, headers, body).await;
    let response = next_mock_response(&state).await;
    Json(response)
}

async fn handle_embeddings(
    State(state): State<MockState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<Value>,
) -> Json<Value> {
    capture_mock_request(&state, headers, body).await;
    let response = next_mock_response(&state).await;
    Json(response)
}

async fn next_mock_response(state: &MockState) -> Value {
    let mut responses = state.responses.lock().await;
    if responses.len() > 1 {
        return responses.pop_front().expect("mock response must exist");
    }
    responses
        .front()
        .cloned()
        .expect("mock response must exist")
}

async fn capture_mock_request(state: &MockState, headers: axum::http::HeaderMap, body: Value) {
    let auth_header = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    state
        .requests
        .lock()
        .await
        .push(CapturedRequest { body, auth_header });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn echo_tool() -> ToolDefinition {
    ToolDefinition {
        name: "echo".to_string(),
        description: "Echo the input string back to the user.".to_string(),
        parameters: json!({
            "type": "object",
            "properties": {
                "text": { "type": "string" }
            },
            "required": ["text"]
        }),
    }
}

fn sample_input(prompt: &str) -> ModelInput {
    ModelInput {
        session_id: SessionId::new(),
        loop_id: LoopId::new(),
        system_prompt: "You are a Takos test agent.".to_string(),
        session_context: Vec::new(),
        memory_context: Vec::new(),
        tool_context: Vec::new(),
        user_message: prompt.to_string(),
        plan: None,
    }
}

fn tool_call_response() -> Value {
    json!({
        "id": "chatcmpl-mock-tool-1",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": "mock-llm",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [
                        {
                            "id": "call_echo_1",
                            "type": "function",
                            "function": {
                                "name": "echo",
                                "arguments": "{\"text\":\"hello from mock\"}"
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls"
            }
        ],
        "usage": {
            "prompt_tokens": 17,
            "completion_tokens": 5,
            "total_tokens": 22
        }
    })
}

fn unavailable_tool_call_response() -> Value {
    json!({
        "id": "chatcmpl-mock-tool-unavailable",
        "object": "chat.completion",
        "created": 1_700_000_000,
        "model": "mock-llm",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [
                        {
                            "id": "call_calculate_1",
                            "type": "function",
                            "function": {
                                "name": "calculate",
                                "arguments": "{\"expression\":\"51 + 52\"}"
                            }
                        }
                    ]
                },
                "finish_reason": "tool_calls"
            }
        ],
        "usage": {
            "prompt_tokens": 17,
            "completion_tokens": 5,
            "total_tokens": 22
        }
    })
}

fn assistant_message_response(text: &str) -> Value {
    json!({
        "id": "chatcmpl-mock-msg-1",
        "object": "chat.completion",
        "created": 1_700_000_001,
        "model": "mock-llm",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": text,
                },
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": 23,
            "completion_tokens": 9,
            "total_tokens": 32
        }
    })
}

fn embedding_response() -> Value {
    json!({
        "object": "list",
        "data": [
            {
                "object": "embedding",
                "index": 0,
                "embedding": [0.125, 0.875]
            }
        ],
        "model": "embedding-mock"
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "current_thread")]
async fn mock_llm_emits_tool_call_for_echo_tool() {
    let server = MockOpenAiServer::start(tool_call_response()).await;
    let usage = Arc::new(UsageTracker::default());
    let runner = TakosModelRunner::new_with_endpoint(
        server.endpoint(),
        "gpt-mock",
        Some(0.0),
        vec!["sk-mock-key".to_string()],
        vec![echo_tool()],
        usage.clone(),
    );

    let output = runner
        .run(sample_input("Say hello via the echo tool."))
        .await
        .expect("model runner should succeed against mock server");

    assert!(
        output.assistant_message.is_none(),
        "tool-call response should not surface an assistant message"
    );
    assert_eq!(
        output.tool_calls.len(),
        1,
        "expected exactly one tool_call to be decoded"
    );
    let call = &output.tool_calls[0];
    assert_eq!(call.name, "echo");
    assert_eq!(
        call.arguments,
        json!({ "text": "hello from mock" }),
        "tool arguments should be parsed as JSON, not a raw string",
    );

    // Conversation accumulator: simulate the agent loop appending a tool
    // result back into the conversation. This mirrors the production flow
    // where the engine forwards `ToolCallRequest` to `tool_bridge` and then
    // re-enters the model with the tool output appended to the prompt.
    let echo_text = call
        .arguments
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tool_result = format!("[echo] {echo_text}");

    server
        .set_response(assistant_message_response(&format!(
            "Tool result received: {tool_result}"
        )))
        .await;

    let mut next_input = sample_input("Say hello via the echo tool.");
    next_input.tool_context.push(tool_result.clone());

    let final_output = runner
        .run(next_input)
        .await
        .expect("second mock turn should succeed");
    assert_eq!(
        final_output.tool_calls.len(),
        0,
        "second turn returns text-only response"
    );
    let assistant = final_output
        .assistant_message
        .expect("second turn should surface an assistant message");
    assert!(
        assistant.contains(&tool_result),
        "assistant message must reference the tool result"
    );

    // Usage tracker should accumulate across both turns.
    let payload = runner.usage_payload();
    assert_eq!(payload.input_tokens, 17 + 23);
    assert_eq!(payload.output_tokens, 5 + 9);

    // Verify the request shape sent to the mock server included our tool
    // catalog and bearer auth header.
    let captured = server.captured_requests().await;
    assert_eq!(captured.len(), 2, "mock server should observe both turns");
    let first = &captured[0];
    assert_eq!(
        first.auth_header.as_deref(),
        Some("Bearer sk-mock-key"),
        "bearer auth header must reach the mock endpoint",
    );
    let tools = first
        .body
        .get("tools")
        .and_then(|v| v.as_array())
        .expect("request must include tools array");
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|tool| {
            tool.get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
        })
        .collect();
    assert_eq!(
        names,
        vec!["echo"],
        "echo tool must be advertised to the LLM"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn unavailable_tool_call_retries_once_without_tools() {
    let server = MockOpenAiServer::start_sequence(vec![
        unavailable_tool_call_response(),
        assistant_message_response("103"),
    ])
    .await;
    let usage = Arc::new(UsageTracker::default());
    let runner = TakosModelRunner::new_with_endpoint(
        server.endpoint(),
        "gpt-mock",
        Some(0.0),
        vec!["sk-mock-key".to_string()],
        vec![echo_tool()],
        usage.clone(),
    );

    let output = runner
        .run(sample_input("Return only the answer to 51 + 52."))
        .await
        .expect("unavailable tool should recover with a tool-free request");

    assert_eq!(output.assistant_message.as_deref(), Some("103"));
    assert!(output.tool_calls.is_empty());
    assert_eq!(usage.snapshot().input_tokens, 17 + 23);
    assert_eq!(usage.snapshot().output_tokens, 5 + 9);

    let requests = server.captured_requests().await;
    assert_eq!(requests.len(), 2);
    assert!(requests[0].body.get("tools").is_some());
    assert!(requests[1].body.get("tools").is_none());
    assert!(requests[1].body.get("tool_choice").is_none());
    let retry_system_prompt = requests[1].body["messages"][0]["content"]
        .as_str()
        .expect("retry system prompt");
    assert!(retry_system_prompt.contains("not available in this runtime"));
}

#[tokio::test(flavor = "current_thread")]
async fn local_smoke_model_intercepts_directives_before_hitting_mock_endpoint() {
    // Skill resolution / memory tool intercept precedence: when the model is
    // `local-smoke`, the runner short-circuits to the in-process directive
    // parser regardless of the endpoint configuration. This proves that
    // production memory-tool / skill-resolution intercepts cannot be
    // accidentally bypassed by an attacker swapping the endpoint.
    let server = MockOpenAiServer::start(json!({"unreachable": true})).await;
    let usage = Arc::new(UsageTracker::default());
    let runner = TakosModelRunner::new_with_endpoint(
        server.endpoint(),
        "local-smoke",
        None,
        vec!["sk-should-not-be-used".to_string()],
        vec![echo_tool()],
        usage.clone(),
    );

    let output = runner
        .run(sample_input("memory:hello world"))
        .await
        .expect("local-smoke directive should resolve in-process");

    assert!(output.assistant_message.is_none());
    assert_eq!(output.tool_calls.len(), 1);
    assert_eq!(output.tool_calls[0].name, "semantic_search_memory");
    assert_eq!(
        output.tool_calls[0]
            .arguments
            .get("query")
            .and_then(|v| v.as_str()),
        Some("hello world"),
    );
    assert_eq!(
        server.captured_requests().await.len(),
        0,
        "local-smoke must NOT touch the mock OpenAI endpoint"
    );

    // `tool:` directive — also intercepted before any HTTP traffic.
    let tool_output = runner
        .run(sample_input("tool:echo {\"text\":\"direct\"}"))
        .await
        .expect("tool: directive should resolve in-process");
    assert_eq!(tool_output.tool_calls.len(), 1);
    assert_eq!(tool_output.tool_calls[0].name, "echo");
    assert_eq!(
        tool_output.tool_calls[0].arguments,
        json!({ "text": "direct" }),
    );
    assert_eq!(
        server.captured_requests().await.len(),
        0,
        "second local-smoke turn must also stay in-process",
    );
}

#[tokio::test(flavor = "current_thread")]
async fn mock_llm_assistant_message_only_response_decodes_to_engine_output() {
    let server = MockOpenAiServer::start(assistant_message_response("done")).await;
    let usage = Arc::new(UsageTracker::default());
    let runner = TakosModelRunner::new_with_endpoint(
        server.endpoint(),
        "gpt-mock",
        None,
        vec!["sk-mock-key".to_string()],
        Vec::new(),
        usage,
    );
    let output = runner
        .run(sample_input("Just answer briefly."))
        .await
        .expect("mock server response should decode");
    assert_eq!(output.assistant_message.as_deref(), Some("done"));
    assert!(
        output.tool_calls.is_empty(),
        "no tool_calls expected for this fixture"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn mock_openai_embedding_config_wires_engine_embedder() {
    let server = MockOpenAiServer::start(embedding_response()).await;
    let run_config = RunConfigResponse {
        embedding_provider: Some("openai".to_string()),
        embedding_model: Some("embedding-mock".to_string()),
        embedding_base_url: Some(server.embedding_base_url()),
        embedding_dimensions: Some(2),
        ..Default::default()
    };
    let embedding_config =
        resolve_embedding_backend_config(&run_config, Some("sk-embedding-control"))
            .expect("embedding config should resolve")
            .expect("OpenAI-compatible embedding config should be enabled");
    let usage = Arc::new(UsageTracker::default());
    let model_runner = TakosModelRunner::new_with_endpoint(
        server.endpoint(),
        "local-smoke",
        None,
        vec!["sk-chat-unused".to_string()],
        Vec::new(),
        usage,
    );
    let client = ControlRpcClient::new(&StartPayload {
        run_id: "run-embedding-test".to_string(),
        worker_id: "worker-embedding-test".to_string(),
        service_id: None,
        model: Some("local-smoke".to_string()),
        lease_version: None,
        executor_tier: None,
        executor_container_id: None,
        control_rpc_base_url: "http://127.0.0.1:1".to_string(),
        control_rpc_token: "control-token".to_string(),
    })
    .expect("control RPC client should build for test wiring");
    let tool_executor =
        CompositeToolExecutor::new(client, Vec::new(), SkillCatalogResponse::default());
    let root = unique_temp_dir("takos-agent-embedding");
    std::fs::create_dir_all(&root).expect("test engine root should be created");
    let deps = build_engine_deps(&root, model_runner, tool_executor, Some(embedding_config))
        .expect("engine deps should build with OpenAI-compatible embedder");

    let embedding = deps
        .embedder
        .embed_text("remember agent memory")
        .await
        .expect("embedding request should succeed");
    assert_eq!(embedding, Embedding(vec![0.125, 0.875]));

    let captured = server.captured_requests().await;
    assert_eq!(
        captured.len(),
        1,
        "embedding request should hit mock server"
    );
    let request = &captured[0];
    assert_eq!(
        request.auth_header.as_deref(),
        Some("Bearer sk-embedding-control"),
        "control-plane OpenAI key should be used for embeddings",
    );
    assert_eq!(
        request.body,
        json!({
            "model": "embedding-mock",
            "input": "remember agent memory",
            "dimensions": 2
        }),
    );

    std::fs::remove_dir_all(root).expect("test engine root should be removed");
}

fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system time should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}
