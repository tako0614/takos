use std::sync::{Arc, Mutex, MutexGuard};

use async_trait::async_trait;
use takos_agent_engine::config::EngineConfig;
use takos_agent_engine::domain::{
    AbstractNode, AbstractNodeMetadata, DistillationState, EntityRef, GraphFragment, RawNodeKind,
    References, Relation,
};
use takos_agent_engine::engine::context_assembler::TokenEstimator;
use takos_agent_engine::engine::session_engine::EngineDeps;
use takos_agent_engine::ids::SessionId;
use takos_agent_engine::memory::distillation::{
    DistillationInput, DistillationOutput, Distiller, RawLifecycleUpdate,
};
use takos_agent_engine::memory::DefaultScoringPolicy;
use takos_agent_engine::model::{
    ConversationMessage, ConversationRole, Embedder, Embedding, ToolCallRequest,
};
use takos_agent_engine::storage::{
    InMemoryGraphRepository, InMemoryNodeRepository, InMemoryVectorIndex, LoopStateRepository,
    RawLifecyclePatch,
};
use takos_agent_engine::{Result, SessionRequest};
use tracing::warn;
use uuid::Uuid;

use crate::control_rpc::{RunConfigResponse, ToolDefinition};
use crate::model::TakosModelRunner;
use crate::tool_bridge::CompositeToolExecutor;
use crate::AppResult;

// Product transport budgets are intentionally owned by this wrapper rather
// than changing the generic engine library defaults. Leave enough outer
// margin for response decoding and cancellation propagation.
const TAKOS_MODEL_TIMEOUT_MS: u64 = 125_000;
const TAKOS_TOOL_TIMEOUT_MS: u64 = 310_000;

#[derive(Debug, Clone, Copy)]
pub struct RustHeuristicTokenEstimator;

impl TokenEstimator for RustHeuristicTokenEstimator {
    fn estimate_text(&self, text: &str) -> usize {
        estimate_tokens(text)
    }
}

/// Conservative tokenizer-independent estimate used before provider usage is
/// available. CJK code points commonly occupy at least one token while dense
/// JSON/code/identifiers need a character-based fallback because they may have
/// no whitespace at all.
#[must_use]
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let mut cjk = 0usize;
    let mut other_non_whitespace = 0usize;
    for ch in text.chars() {
        if is_cjk(ch) {
            cjk = cjk.saturating_add(1);
        } else if !ch.is_whitespace() {
            other_non_whitespace = other_non_whitespace.saturating_add(1);
        }
    }
    cjk.saturating_add(other_non_whitespace.saturating_add(3) / 4)
        .max(1)
}

const fn is_cjk(ch: char) -> bool {
    matches!(
        ch as u32,
        0x3000..=0x9fff | 0xf900..=0xfaff | 0xfe30..=0xfe6f
    )
}

#[derive(Debug, Clone)]
pub struct RustHashEmbedder {
    dimensions: usize,
}

impl Default for RustHashEmbedder {
    fn default() -> Self {
        Self { dimensions: 48 }
    }
}

#[async_trait]
impl Embedder for RustHashEmbedder {
    async fn embed_text(&self, text: &str) -> Result<Embedding> {
        let mut values = vec![0.0_f32; self.dimensions];
        if text.is_empty() {
            return Ok(Embedding(values));
        }

        for (index, byte) in text.bytes().enumerate() {
            let slot = index % self.dimensions;
            values[slot] += f32::from(byte) / 255.0;
        }

        let norm = values.iter().map(|value| value * value).sum::<f32>().sqrt();
        if norm != 0.0 {
            for value in &mut values {
                *value /= norm;
            }
        }

        Ok(Embedding(values))
    }
}

#[derive(Debug, Clone, Default)]
pub struct UsageSnapshot {
    pub input_tokens: usize,
    pub output_tokens: usize,
    /// Subset of `input_tokens` served from the provider's prompt cache (OpenAI
    /// automatic prefix caching). Reported so the run ledger can price cache
    /// reads at the discounted rate and surface cache effectiveness.
    pub cached_input_tokens: usize,
}

#[derive(Debug, Default)]
pub struct UsageTracker {
    inner: Mutex<UsageSnapshot>,
}

impl UsageTracker {
    pub fn record(&self, input_tokens: usize, output_tokens: usize, cached_input_tokens: usize) {
        let mut guard = lock_usage_snapshot(&self.inner);
        guard.input_tokens += input_tokens;
        guard.output_tokens += output_tokens;
        guard.cached_input_tokens += cached_input_tokens;
    }

    pub fn snapshot(&self) -> UsageSnapshot {
        lock_usage_snapshot(&self.inner).clone()
    }
}

fn lock_usage_snapshot(inner: &Mutex<UsageSnapshot>) -> MutexGuard<'_, UsageSnapshot> {
    inner.lock().unwrap_or_else(|poisoned| {
        warn!("usage tracker lock poisoned; recovering current snapshot");
        poisoned.into_inner()
    })
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RustSimpleDistiller;

#[async_trait]
impl Distiller for RustSimpleDistiller {
    async fn distill(&self, input: DistillationInput) -> Result<DistillationOutput> {
        if input.raw_nodes.is_empty() {
            return Ok(DistillationOutput::default());
        }

        let user_request = first_node_text(
            &input.raw_nodes,
            &RawNodeKind::UserUtterance,
            "Untitled session",
        );
        let assistant_summary = first_node_text(
            &input.raw_nodes,
            &RawNodeKind::AssistantUtterance,
            "No assistant output yet.",
        );

        let GraphFragment {
            entities,
            relations,
        } = build_distillation_graph(&input);

        let abstract_node = AbstractNode::new(
            truncate_title(&user_request),
            assistant_summary,
            References {
                abstract_node_ids: input.activated_abstract_ids.clone(),
                raw_node_ids: input.raw_nodes.iter().map(|node| node.id).collect(),
            },
            GraphFragment {
                entities,
                relations,
            },
            AbstractNodeMetadata {
                abstraction_level: 1,
                confidence: 0.72,
                importance: 0.75,
                tags: vec!["distilled".to_string(), "takos".to_string()],
            },
        )
        .with_operation_key(format!("loop:{}:abstract:primary", input.loop_id));

        let raw_updates = input
            .raw_nodes
            .iter()
            .map(|node| RawLifecycleUpdate {
                raw_node_id: node.id,
                patch: RawLifecyclePatch {
                    distillation_state: Some(DistillationState::Distilled),
                    overflow: Some(takos_agent_engine::domain::OverflowPolicy {
                        was_pushed_out_of_session: false,
                        relax_retrieval_until: None,
                    }),
                },
            })
            .collect();

        Ok(DistillationOutput {
            new_nodes: vec![abstract_node],
            raw_updates,
        })
    }
}

fn first_node_text(
    raw_nodes: &[takos_agent_engine::domain::RawNode],
    kind: &RawNodeKind,
    fallback: &str,
) -> String {
    raw_nodes
        .iter()
        .find(|node| &node.kind == kind)
        .map_or_else(
            || fallback.to_string(),
            takos_agent_engine::domain::RawNode::content_text,
        )
}

fn build_distillation_graph(input: &DistillationInput) -> GraphFragment {
    let mut entities = vec![
        EntityRef {
            id: input.session_id.to_string(),
            label: "session".to_string(),
        },
        EntityRef {
            id: input.loop_id.to_string(),
            label: "loop".to_string(),
        },
    ];

    let mut relations = vec![Relation {
        subject: input.session_id.to_string(),
        predicate: "contains_loop".to_string(),
        object: input.loop_id.to_string(),
        weight: 1.0,
        provenance_raw_node_ids: input.raw_nodes.iter().map(|node| node.id).collect(),
    }];

    for node in &input.raw_nodes {
        entities.push(EntityRef {
            id: node.id.to_string(),
            label: format!("raw:{:?}", node.kind),
        });
        relations.push(Relation {
            subject: input.loop_id.to_string(),
            predicate: match node.kind {
                RawNodeKind::UserUtterance => "captures_request".to_string(),
                RawNodeKind::AssistantUtterance => "captures_response".to_string(),
                RawNodeKind::ToolResult => "records_tool_result".to_string(),
                RawNodeKind::Note => "records_note".to_string(),
                RawNodeKind::Event => "records_event".to_string(),
            },
            object: node.id.to_string(),
            weight: 0.8,
            provenance_raw_node_ids: vec![node.id],
        });

        if node.kind == RawNodeKind::ToolResult {
            relations.push(Relation {
                subject: node.metadata.source.clone(),
                predicate: "produced".to_string(),
                object: node.id.to_string(),
                weight: 0.7,
                provenance_raw_node_ids: vec![node.id],
            });
        }
    }

    for abstract_id in &input.activated_abstract_ids {
        relations.push(Relation {
            subject: input.loop_id.to_string(),
            predicate: "informed_by".to_string(),
            object: abstract_id.to_string(),
            weight: 0.85,
            provenance_raw_node_ids: input.raw_nodes.iter().map(|node| node.id).collect(),
        });
    }

    entities.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then_with(|| left.label.cmp(&right.label))
    });
    relations.sort_by(|left, right| {
        left.subject
            .cmp(&right.subject)
            .then_with(|| left.predicate.cmp(&right.predicate))
            .then_with(|| left.object.cmp(&right.object))
    });

    GraphFragment {
        entities,
        relations,
    }
}

pub fn build_engine_config(run_config: &RunConfigResponse) -> AppResult<EngineConfig> {
    if run_config.system_prompt.trim().is_empty() {
        return Err(std::io::Error::other(
            "Takos Worker returned an empty system prompt for the agent run",
        )
        .into());
    }
    let mut config = EngineConfig {
        system_prompt: run_config.system_prompt.clone(),
        ..EngineConfig::default()
    };
    config.runtime.model_timeout_ms = TAKOS_MODEL_TIMEOUT_MS;
    config.runtime.tool_timeout_ms = TAKOS_TOOL_TIMEOUT_MS;
    if let Some(max_graph_steps) = run_config.max_graph_steps.filter(|value| *value > 0) {
        config.runtime.max_graph_steps = max_graph_steps.min(128);
    }
    if let Some(max_tool_rounds) = run_config.max_tool_rounds.filter(|value| *value > 0) {
        config.runtime.max_tool_rounds = max_tool_rounds.min(16);
    }
    Ok(config)
}

pub fn build_engine_deps(
    model_runner: TakosModelRunner,
    tool_executor: CompositeToolExecutor,
    loop_state_repository: Arc<dyn LoopStateRepository>,
) -> AppResult<EngineDeps> {
    // Takos Worker owns durable thread history and memory. The production call
    // opts into ExecutionProfile::ExternalContext, so only the loop checkpoint
    // repository is exercised; the remaining in-memory dependencies satisfy
    // the engine's profile-neutral trait bundle without becoming a second
    // memory authority under `/tmp`.
    let repository = Arc::new(InMemoryNodeRepository::default());
    let vector_index = Arc::new(InMemoryVectorIndex::default());
    let graph_repository = Arc::new(InMemoryGraphRepository::default());
    // Durable semantic retrieval is already performed by the Takos Worker.
    // The external-context graph never invokes this deterministic fallback;
    // retaining it keeps EngineDeps usable in focused library/test scenarios
    // without introducing a provider embedding credential.
    let embedder: Arc<dyn Embedder> = Arc::new(RustHashEmbedder::default());
    let scoring_policy = Arc::new(DefaultScoringPolicy::default());
    let token_estimator = Arc::new(RustHeuristicTokenEstimator);
    let distiller = Arc::new(RustSimpleDistiller);
    // Every product-visible tool, including memory and timeline operations,
    // is Worker-owned and must cross the remote control-RPC policy boundary.
    // The external-context graph does not expose or persist through the unused
    // memory repositories above.
    let tool_executor = Arc::new(tool_executor);

    Ok(EngineDeps {
        repository,
        vector_index,
        graph_repository,
        loop_state_repository,
        embedder,
        model_runner: Arc::new(model_runner),
        tool_executor,
        distiller,
        scoring_policy,
        token_estimator,
    })
}

pub fn derive_engine_session_id(thread_id: &str) -> SessionId {
    // The Takos Thread is the durable conversation authority. A run/bootstrap
    // session id is execution metadata and may rotate between leases, so using
    // it here would split one thread across unrelated engine session identities.
    SessionId(Uuid::new_v5(&Uuid::NAMESPACE_URL, thread_id.as_bytes()))
}

pub fn last_user_message(
    history: &[crate::control_rpc::HistoryMessage],
    fallback: Option<&str>,
) -> Option<String> {
    history
        .iter()
        .rev()
        .find(|message| message.role == "user" && !message.content.trim().is_empty())
        .map(|message| message.content.clone())
        .or_else(|| fallback.map(str::to_string))
}

/// Normalize the control-plane's canonical history into the engine's
/// provider-neutral transcript and exclude the current user message. The
/// current message is carried separately by `SessionRequest`, so keeping it in
/// both places would duplicate the prompt and break tool-message ordering.
#[must_use]
pub fn durable_history_before_current(
    history: &[crate::control_rpc::HistoryMessage],
    current_user_message: &str,
) -> Vec<ConversationMessage> {
    let last_user_index = history
        .iter()
        .rposition(|message| message.role == "user" && !message.content.trim().is_empty());
    let current_user_index = last_user_index
        .filter(|&index| history[index].content.trim() == current_user_message.trim());
    let prior = current_user_index.map_or(history, |index| &history[..index]);
    let normalized = prior.iter().filter_map(normalize_history_message).collect();
    coherent_conversation_history(normalized)
}

fn coherent_conversation_history(messages: Vec<ConversationMessage>) -> Vec<ConversationMessage> {
    let mut coherent = Vec::with_capacity(messages.len());
    let mut index = 0;
    while index < messages.len() {
        let message = &messages[index];
        if message.role == ConversationRole::Tool {
            index += 1;
            continue;
        }
        if message.role != ConversationRole::Assistant || message.tool_calls.is_empty() {
            coherent.push(message.clone());
            index += 1;
            continue;
        }

        let call_ids = message
            .tool_calls
            .iter()
            .filter_map(|call| call.id.as_deref())
            .filter(|id| !id.is_empty())
            .collect::<Vec<_>>();
        let expected_ids = call_ids
            .iter()
            .copied()
            .collect::<std::collections::HashSet<_>>();
        let mut seen_ids = std::collections::HashSet::new();
        let mut matched_results = Vec::new();
        let mut next_index = index + 1;
        while next_index < messages.len() && messages[next_index].role == ConversationRole::Tool {
            let result = &messages[next_index];
            if let Some(id) = result.tool_call_id.as_deref() {
                if expected_ids.contains(id) && seen_ids.insert(id) {
                    matched_results.push(result.clone());
                }
            }
            next_index += 1;
        }

        let complete = call_ids.len() == message.tool_calls.len()
            && expected_ids.len() == call_ids.len()
            && seen_ids.len() == expected_ids.len();
        if complete {
            coherent.push(message.clone());
            coherent.extend(matched_results);
        } else if !message.content.trim().is_empty() {
            let mut plain = message.clone();
            plain.tool_calls.clear();
            coherent.push(plain);
        }
        index = next_index;
    }
    coherent
}

fn normalize_history_message(
    message: &crate::control_rpc::HistoryMessage,
) -> Option<ConversationMessage> {
    let role = match message.role.as_str() {
        "system" => ConversationRole::System,
        "user" => ConversationRole::User,
        "assistant" => ConversationRole::Assistant,
        "tool" => ConversationRole::Tool,
        _ => return None,
    };
    let tool_calls = message
        .tool_calls
        .iter()
        .filter_map(normalize_history_tool_call)
        .collect();
    Some(ConversationMessage {
        role,
        content: message.content.clone(),
        tool_call_id: message.tool_call_id.clone(),
        tool_calls,
    })
}

fn normalize_history_tool_call(value: &serde_json::Value) -> Option<ToolCallRequest> {
    let object = value.as_object()?;
    // The Takos canonical wire shape is flat `{ id, name, arguments }`.
    // Accept the older OpenAI-shaped nested form while persisted pre-migration
    // history ages out, but never emit it as the product contract.
    let legacy_function = object
        .get("function")
        .and_then(serde_json::Value::as_object);
    let name = object
        .get("name")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            legacy_function?
                .get("name")
                .and_then(serde_json::Value::as_str)
        })?
        .trim();
    if name.is_empty() {
        return None;
    }
    let arguments_value = object
        .get("arguments")
        .or_else(|| legacy_function.and_then(|function| function.get("arguments")));
    let arguments = match arguments_value {
        Some(serde_json::Value::String(raw)) => {
            serde_json::from_str(raw).unwrap_or_else(|_| serde_json::json!({ "_raw": raw }))
        }
        Some(value) => value.clone(),
        None => serde_json::json!({}),
    };
    let arguments = if arguments.is_object() {
        arguments
    } else {
        serde_json::json!({ "_raw": arguments })
    };
    Some(ToolCallRequest {
        id: object
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
        name: name.to_string(),
        arguments,
    })
}

pub fn build_session_request(
    session_id: SessionId,
    user_message: String,
    remote_tools: &[ToolDefinition],
) -> SessionRequest {
    let plan = if remote_tools.is_empty() {
        None
    } else {
        Some(format!(
            "Direct tools available: {}. Use direct tools for obvious work. If a useful capability, manual, or extension is not obvious, use toolbox action=search early, describe likely candidates, then call the tool when it advances the task.",
            remote_tools
                .iter()
                .map(|tool| tool.name.clone())
                .collect::<Vec<_>>()
                .join(", "),
        ))
    };

    SessionRequest {
        session_id: Some(session_id),
        user_message,
        plan,
    }
}

/// Truncates a distillation title to at most 64 bytes while keeping the cut on
/// a UTF-8 char boundary. Multi-byte input (e.g. Japanese titles) used to
/// panic here because `&trimmed[..61]` sliced through a code point.
fn truncate_title(source: &str) -> String {
    const TARGET_LEN: usize = 64;
    const PREFIX_BUDGET: usize = TARGET_LEN - 3; // 3 bytes reserved for "..."

    let trimmed = source.trim();
    if trimmed.len() <= TARGET_LEN {
        return trimmed.to_string();
    }

    let mut safe_cut = 0;
    for (offset, _) in trimmed.char_indices() {
        if offset > PREFIX_BUDGET {
            break;
        }
        safe_cut = offset;
    }
    format!("{}...", &trimmed[..safe_cut])
}

#[cfg(test)]
mod tests {
    use super::{
        build_engine_config, derive_engine_session_id, durable_history_before_current,
        estimate_tokens, normalize_history_tool_call, truncate_title, TAKOS_MODEL_TIMEOUT_MS,
        TAKOS_TOOL_TIMEOUT_MS,
    };
    use crate::control_rpc::{HistoryMessage, RunConfigResponse};
    use serde_json::json;
    use takos_agent_engine::model::ConversationRole;

    #[test]
    fn truncate_title_preserves_short_ascii_input() {
        assert_eq!(truncate_title("hello"), "hello");
        assert_eq!(truncate_title("  hello  "), "hello");
    }

    #[test]
    fn truncate_title_does_not_panic_on_multibyte_input() {
        let source = "日本語の長いタイトル".repeat(8);
        let truncated = truncate_title(&source);
        assert!(truncated.ends_with("..."));
        assert!(truncated.len() <= 64);
        assert!(
            truncated.is_char_boundary(truncated.len()),
            "truncate_title must keep multi-byte input on a char boundary",
        );
        // Sanity: the prefix should contain at least one full code point from the source.
        assert!(truncated.starts_with('日'));
    }

    #[test]
    fn truncate_title_truncates_long_ascii_input_with_ellipsis() {
        let source = "a".repeat(80);
        let truncated = truncate_title(&source);
        assert!(truncated.ends_with("..."));
        assert_eq!(truncated.len(), 64);
    }

    #[test]
    fn token_estimator_accounts_for_japanese_and_dense_json() {
        assert_eq!(estimate_tokens("日本語の長い入力"), 8);
        let dense_json = format!(r#"{{"payload":"{}"}}"#, "x".repeat(400));
        assert!(estimate_tokens(&dense_json) >= 100);
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn engine_session_identity_is_thread_scoped_and_deterministic() {
        let first = derive_engine_session_id("thread-1");
        let same_thread = derive_engine_session_id("thread-1");
        let other_thread = derive_engine_session_id("thread-2");

        assert_eq!(first, same_thread);
        assert_ne!(first, other_thread);
    }

    #[test]
    fn durable_history_is_structured_and_excludes_current_user() {
        let history = vec![
            HistoryMessage {
                role: "system".to_string(),
                content: "summary".to_string(),
                ..Default::default()
            },
            HistoryMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_calls: vec![json!({
                    "id": "call-1",
                    "name": "web_fetch",
                    "arguments": { "url": "https://example.com" }
                })],
                tool_call_id: None,
            },
            HistoryMessage {
                role: "tool".to_string(),
                content: "ok".to_string(),
                tool_calls: Vec::new(),
                tool_call_id: Some("call-1".to_string()),
            },
            HistoryMessage {
                role: "user".to_string(),
                content: "current request".to_string(),
                ..Default::default()
            },
        ];

        let normalized = durable_history_before_current(&history, "current request");
        assert_eq!(normalized.len(), 3);
        assert_eq!(normalized[0].role, ConversationRole::System);
        assert_eq!(normalized[1].tool_calls[0].id.as_deref(), Some("call-1"));
        assert_eq!(normalized[2].tool_call_id.as_deref(), Some("call-1"));
        assert!(normalized
            .iter()
            .all(|message| message.content != "current request"));
    }

    #[test]
    fn history_tool_call_normalizer_accepts_flat_and_legacy_nested_shapes() {
        let flat = normalize_history_tool_call(&json!({
            "id": "flat-1",
            "name": "web_fetch",
            "arguments": { "url": "https://example.com" }
        }))
        .expect("flat canonical call must parse");
        assert_eq!(flat.id.as_deref(), Some("flat-1"));
        assert_eq!(flat.name, "web_fetch");
        assert_eq!(flat.arguments["url"], "https://example.com");

        let legacy = normalize_history_tool_call(&json!({
            "id": "legacy-1",
            "type": "function",
            "function": {
                "name": "web_fetch",
                "arguments": "{\"url\":\"https://example.org\"}"
            }
        }))
        .expect("legacy nested call must remain readable during migration");
        assert_eq!(legacy.id.as_deref(), Some("legacy-1"));
        assert_eq!(legacy.arguments["url"], "https://example.org");
    }

    #[test]
    fn durable_history_drops_orphan_and_incomplete_tool_messages() {
        let history = vec![
            HistoryMessage {
                role: "tool".to_string(),
                content: "orphan".to_string(),
                tool_call_id: Some("old".to_string()),
                ..Default::default()
            },
            HistoryMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_calls: vec![
                    json!({ "id": "call-a", "name": "read_a", "arguments": {} }),
                    json!({ "id": "call-b", "name": "read_b", "arguments": {} }),
                ],
                tool_call_id: None,
            },
            HistoryMessage {
                role: "tool".to_string(),
                content: "only a".to_string(),
                tool_call_id: Some("call-a".to_string()),
                ..Default::default()
            },
            HistoryMessage {
                role: "user".to_string(),
                content: "previous request".to_string(),
                ..Default::default()
            },
        ];

        let normalized = durable_history_before_current(&history, "current request");

        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].role, ConversationRole::User);
        assert_eq!(normalized[0].content, "previous request");
    }

    #[test]
    fn durable_history_keeps_last_user_when_current_message_is_not_in_history() {
        let history = vec![HistoryMessage {
            role: "user".to_string(),
            content: "previous request".to_string(),
            ..Default::default()
        }];

        let normalized = durable_history_before_current(&history, "current request");

        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].content, "previous request");
    }

    #[test]
    fn build_engine_config_prefers_control_system_prompt() {
        let config = build_engine_config(&RunConfigResponse {
            system_prompt: "control prompt".to_string(),
            ..Default::default()
        })
        .expect("control prompt must be accepted");

        assert_eq!(config.system_prompt, "control prompt");
    }

    #[test]
    fn build_engine_config_rejects_empty_control_prompt() {
        let error = build_engine_config(&RunConfigResponse {
            system_prompt: "  ".to_string(),
            ..Default::default()
        })
        .expect_err("the Worker-owned prompt is required");

        assert!(error.to_string().contains("empty system prompt"));
    }

    #[test]
    fn build_engine_config_applies_control_budget_fields() {
        let config = build_engine_config(&RunConfigResponse {
            system_prompt: "control prompt".to_string(),
            max_graph_steps: Some(7),
            max_tool_rounds: Some(3),
            ..Default::default()
        })
        .expect("control config must be accepted");

        assert_eq!(config.runtime.max_graph_steps, 7);
        assert_eq!(config.runtime.max_tool_rounds, 3);
        assert_eq!(config.runtime.model_timeout_ms, TAKOS_MODEL_TIMEOUT_MS);
        assert_eq!(config.runtime.tool_timeout_ms, TAKOS_TOOL_TIMEOUT_MS);
    }
}
