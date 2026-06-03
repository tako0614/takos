use std::env;
use std::path::Path;
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
    Embedder, Embedding, OpenAiCompatibleEmbedder, OpenAiEmbeddingConfig,
};
use takos_agent_engine::storage::{
    FileObjectStore, ObjectGraphRepository, ObjectLoopStateRepository, ObjectNodeRepository,
    ObjectVectorIndex, RawLifecyclePatch,
};
use takos_agent_engine::tools::memory_tools::MemoryTools;
use takos_agent_engine::{Result, SessionRequest};
use tracing::warn;
use uuid::Uuid;

use crate::control_rpc::{RunConfigResponse, ToolDefinition};
use crate::model::TakosModelRunner;
use crate::prompts::system_prompt_for_agent_type;
use crate::tool_bridge::CompositeToolExecutor;
use crate::AppResult;

const DEFAULT_OPENAI_EMBEDDING_MODEL: &str = "text-embedding-3-small";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddingBackendConfig {
    pub provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub api_key: String,
    pub dimensions: Option<u32>,
}

#[derive(Debug, Clone, Copy)]
pub struct RustWhitespaceTokenEstimator;

impl TokenEstimator for RustWhitespaceTokenEstimator {
    fn estimate_text(&self, text: &str) -> usize {
        text.split_whitespace().count().max(1)
    }
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

pub fn build_engine_config(run_config: &RunConfigResponse, agent_type: &str) -> EngineConfig {
    let mut config = EngineConfig {
        system_prompt: if run_config.system_prompt.trim().is_empty() {
            system_prompt_for_agent_type(agent_type)
        } else {
            run_config.system_prompt.clone()
        },
        ..EngineConfig::default()
    };
    if let Some(max_graph_steps) = run_config
        .max_graph_steps
        .or(run_config.max_iterations)
        .filter(|value| *value > 0)
    {
        config.runtime.max_graph_steps = max_graph_steps.min(128);
    }
    if let Some(max_tool_rounds) = run_config
        .max_tool_rounds
        .or(run_config.max_iterations)
        .filter(|value| *value > 0)
    {
        config.runtime.max_tool_rounds = max_tool_rounds.min(16);
    }
    config
}

pub fn build_engine_deps(
    root: &Path,
    model_runner: TakosModelRunner,
    tool_executor: CompositeToolExecutor,
    embedding_config: Option<EmbeddingBackendConfig>,
) -> AppResult<EngineDeps> {
    let store = FileObjectStore::open(root)?;
    let repository = Arc::new(ObjectNodeRepository::new(store.clone()));
    let vector_index = Arc::new(ObjectVectorIndex::new(store.clone()));
    let graph_repository = Arc::new(ObjectGraphRepository::new(store.clone()));
    let loop_state_repository = Arc::new(ObjectLoopStateRepository::new(store));
    let embedder = build_embedder(embedding_config)?;
    let scoring_policy = Arc::new(DefaultScoringPolicy::default());
    let token_estimator = Arc::new(RustWhitespaceTokenEstimator);
    let distiller = Arc::new(RustSimpleDistiller);
    let memory_tools = MemoryTools::new(
        repository.clone(),
        vector_index.clone(),
        graph_repository.clone(),
        embedder.clone(),
    );
    let tool_executor = Arc::new(tool_executor.with_local_memory_tools(memory_tools));

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

pub fn resolve_embedding_backend_config(
    run_config: &RunConfigResponse,
    control_openai_api_key: Option<&str>,
) -> AppResult<Option<EmbeddingBackendConfig>> {
    resolve_embedding_backend_config_from_values(
        run_config,
        control_openai_api_key,
        &EnvEmbeddingConfig {
            provider: first_nonempty_env(&["TAKOS_EMBEDDING_PROVIDER", "EMBEDDING_PROVIDER"]),
            model: first_nonempty_env(&[
                "TAKOS_EMBEDDING_MODEL",
                "EMBEDDING_MODEL",
                "OPENAI_EMBEDDING_MODEL",
            ]),
            base_url: first_nonempty_env(&[
                "TAKOS_EMBEDDING_BASE_URL",
                "EMBEDDING_BASE_URL",
                "OPENAI_EMBEDDING_BASE_URL",
            ]),
            api_key: first_nonempty_env(&[
                "TAKOS_EMBEDDING_API_KEY",
                "EMBEDDING_API_KEY",
                "OPENAI_EMBEDDING_API_KEY",
                "OPENAI_API_KEY",
            ]),
            dimensions: first_nonempty_env(&[
                "TAKOS_EMBEDDING_DIMENSIONS",
                "EMBEDDING_DIMENSIONS",
                "OPENAI_EMBEDDING_DIMENSIONS",
            ])
            .and_then(|value| value.parse::<u32>().ok()),
        },
    )
}

fn build_embedder(config: Option<EmbeddingBackendConfig>) -> AppResult<Arc<dyn Embedder>> {
    let Some(config) = config else {
        warn!(
            "embedding backend is not configured; falling back to Rust hash embedder for smoke/test use"
        );
        return Ok(Arc::new(RustHashEmbedder::default()));
    };

    let provider = config.provider.trim().to_ascii_lowercase();
    if !matches!(
        provider.as_str(),
        "openai" | "openai-compatible" | "openai_compatible"
    ) {
        return Err(format!("unsupported embedding provider {}", config.provider).into());
    }

    let mut openai_config = OpenAiEmbeddingConfig::new(config.model, config.api_key);
    if let Some(base_url) = config.base_url {
        openai_config = openai_config.with_base_url(base_url);
    }
    if let Some(dimensions) = config.dimensions {
        openai_config = openai_config.with_dimensions(dimensions);
    }
    Ok(Arc::new(OpenAiCompatibleEmbedder::with_config(
        openai_config,
    )?))
}

pub fn derive_engine_session_id(bootstrap_session_id: Option<&str>, thread_id: &str) -> SessionId {
    let seed = bootstrap_session_id
        .filter(|value| !value.is_empty())
        .unwrap_or(thread_id);
    SessionId(Uuid::new_v5(&Uuid::NAMESPACE_URL, seed.as_bytes()))
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

fn safe_storage_slug(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if slug.is_empty() || slug == "." || slug == ".." {
        slug = "_".to_string();
    }
    slug
}

pub fn safe_space_path(root: &Path, space_id: &str) -> std::path::PathBuf {
    root.join("spaces").join(safe_storage_slug(space_id))
}

pub fn safe_installation_path(
    root: &Path,
    space_id: &str,
    installation_id: &str,
) -> std::path::PathBuf {
    safe_space_path(root, space_id)
        .join("installations")
        .join(safe_storage_slug(installation_id))
}

pub fn safe_run_store_path(
    root: &Path,
    space_id: &str,
    installation_id: Option<&str>,
) -> std::path::PathBuf {
    if let Some(installation_id) = installation_id.filter(|value| !value.trim().is_empty()) {
        return safe_installation_path(root, space_id, installation_id);
    }
    safe_space_path(root, space_id)
}

#[derive(Debug, Clone, Default)]
struct EnvEmbeddingConfig {
    provider: Option<String>,
    model: Option<String>,
    base_url: Option<String>,
    api_key: Option<String>,
    dimensions: Option<u32>,
}

fn resolve_embedding_backend_config_from_values(
    run_config: &RunConfigResponse,
    control_openai_api_key: Option<&str>,
    env_config: &EnvEmbeddingConfig,
) -> AppResult<Option<EmbeddingBackendConfig>> {
    let provider = first_nonempty([
        env_config.provider.as_deref(),
        run_config.embedding_provider.as_deref(),
    ]);
    if matches!(
        provider.as_deref().map(str::to_ascii_lowercase).as_deref(),
        Some("hash" | "local" | "rust-hash")
    ) {
        return Ok(None);
    }

    let model = first_nonempty([
        env_config.model.as_deref(),
        run_config.embedding_model.as_deref(),
    ]);
    let base_url = first_nonempty([
        env_config.base_url.as_deref(),
        run_config.embedding_base_url.as_deref(),
    ]);
    let api_key = first_nonempty([
        env_config.api_key.as_deref(),
        run_config.embedding_api_key.as_deref(),
        control_openai_api_key,
    ]);
    let dimensions = env_config.dimensions.or(run_config.embedding_dimensions);
    let openai_configured = provider.is_some()
        || model.is_some()
        || base_url.is_some()
        || api_key.is_some()
        || dimensions.is_some();
    if !openai_configured {
        return Ok(None);
    }

    let provider = provider.unwrap_or_else(|| "openai-compatible".to_string());
    let normalized_provider = provider.trim().to_ascii_lowercase();
    if !matches!(
        normalized_provider.as_str(),
        "openai" | "openai-compatible" | "openai_compatible"
    ) {
        return Err(format!("unsupported embedding provider {provider}").into());
    }
    let api_key = api_key.ok_or("OpenAI-compatible embedding api key is not configured")?;

    Ok(Some(EmbeddingBackendConfig {
        provider,
        model: model.unwrap_or_else(|| DEFAULT_OPENAI_EMBEDDING_MODEL.to_string()),
        base_url,
        api_key,
        dimensions,
    }))
}

fn first_nonempty_env(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| env::var(key).ok().and_then(|value| nonempty_string(&value)))
}

fn first_nonempty<'a>(values: impl IntoIterator<Item = Option<&'a str>>) -> Option<String> {
    values.into_iter().flatten().find_map(nonempty_string)
}

fn nonempty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
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
        build_embedder, build_engine_config, resolve_embedding_backend_config_from_values,
        safe_run_store_path, truncate_title, EmbeddingBackendConfig, EnvEmbeddingConfig,
    };
    use crate::control_rpc::RunConfigResponse;
    use crate::prompts::system_prompt_for_agent_type;
    use serde_json::json;
    use std::path::{Path, PathBuf};
    use takos_agent_engine::model::Embedding;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

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
    fn build_engine_config_prefers_control_system_prompt() {
        let config = build_engine_config(
            &RunConfigResponse {
                system_prompt: "control prompt".to_string(),
                ..Default::default()
            },
            "implementer",
        );

        assert_eq!(config.system_prompt, "control prompt");
    }

    #[test]
    fn build_engine_config_falls_back_to_local_prompt_when_control_prompt_empty() {
        let config = build_engine_config(
            &RunConfigResponse {
                system_prompt: "  ".to_string(),
                ..Default::default()
            },
            "implementer",
        );

        assert_eq!(
            config.system_prompt,
            system_prompt_for_agent_type("implementer")
        );
    }

    #[test]
    fn build_engine_config_applies_control_budget_fields() {
        let config = build_engine_config(
            &RunConfigResponse {
                max_graph_steps: Some(7),
                max_tool_rounds: Some(3),
                ..Default::default()
            },
            "implementer",
        );

        assert_eq!(config.runtime.max_graph_steps, 7);
        assert_eq!(config.runtime.max_tool_rounds, 3);
    }

    #[test]
    fn run_store_path_uses_installation_namespace_when_present() {
        let root = PathBuf::from("/tmp/takos-agent-test");

        assert_eq!(
            safe_run_store_path(&root, "space_1", Some("inst_1"))
                .strip_prefix(&root)
                .unwrap(),
            Path::new("spaces/space_1/installations/inst_1"),
        );
        assert_eq!(
            safe_run_store_path(&root, "space_1", Some("../inst"))
                .strip_prefix(&root)
                .unwrap(),
            Path::new("spaces/space_1/installations/.._inst"),
        );
        assert_eq!(
            safe_run_store_path(&root, "space_1", Some(""))
                .strip_prefix(&root)
                .unwrap(),
            Path::new("spaces/space_1"),
        );
    }

    #[test]
    fn embedding_backend_config_uses_hash_when_unset() {
        let config = resolve_embedding_backend_config_from_values(
            &RunConfigResponse::default(),
            None,
            &EnvEmbeddingConfig::default(),
        )
        .expect("embedding config should resolve");

        assert_eq!(config, None);
    }

    #[test]
    fn embedding_backend_config_prefers_env_over_control() {
        let config = resolve_embedding_backend_config_from_values(
            &RunConfigResponse {
                embedding_provider: Some("openai".to_string()),
                embedding_model: Some("control-model".to_string()),
                embedding_base_url: Some("https://control.example/v1".to_string()),
                embedding_api_key: Some("control-key".to_string()),
                embedding_dimensions: Some(128),
                ..Default::default()
            },
            Some("api-key-from-control-secret"),
            &EnvEmbeddingConfig {
                provider: Some("openai-compatible".to_string()),
                model: Some("env-model".to_string()),
                base_url: Some("https://env.example/v1".to_string()),
                api_key: Some("env-key".to_string()),
                dimensions: Some(256),
            },
        )
        .expect("embedding config should resolve")
        .expect("OpenAI embedding config should be enabled");

        assert_eq!(
            config,
            EmbeddingBackendConfig {
                provider: "openai-compatible".to_string(),
                model: "env-model".to_string(),
                base_url: Some("https://env.example/v1".to_string()),
                api_key: "env-key".to_string(),
                dimensions: Some(256),
            }
        );
    }

    #[tokio::test]
    async fn openai_embedding_backend_sends_request_to_configured_server() {
        let server =
            FakeEmbeddingServer::spawn(r#"{"data":[{"index":0,"embedding":[0.25,0.75]}]}"#).await;
        let embedder = build_embedder(Some(EmbeddingBackendConfig {
            provider: "openai-compatible".to_string(),
            model: "embedding-test-model".to_string(),
            base_url: Some(server.base_url()),
            api_key: "embedding-test-key".to_string(),
            dimensions: Some(2),
        }))
        .expect("OpenAI embedding backend should build");

        let embedding = embedder
            .embed_text("agent service wiring")
            .await
            .expect("embedding request should succeed");

        assert_eq!(embedding, Embedding(vec![0.25, 0.75]));
        let request = server.request().await;
        assert!(request.starts_with("POST /embeddings HTTP/1.1"));
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: bearer embedding-test-key"));
        let body: serde_json::Value =
            serde_json::from_str(request_body(&request)).expect("request body should be json");
        assert_eq!(
            body,
            json!({
                "model": "embedding-test-model",
                "input": "agent service wiring",
                "dimensions": 2
            })
        );
    }

    struct FakeEmbeddingServer {
        address: std::net::SocketAddr,
        handle: JoinHandle<String>,
    }

    impl FakeEmbeddingServer {
        async fn spawn(response_body: &'static str) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .expect("fake embedding server should bind");
            let address = listener
                .local_addr()
                .expect("fake embedding server address should resolve");
            let handle = tokio::spawn(async move {
                let (mut stream, _) = listener
                    .accept()
                    .await
                    .expect("fake embedding server should accept");
                let request = read_http_request(&mut stream).await;
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .await
                    .expect("fake embedding server should respond");
                request
            });
            Self { address, handle }
        }

        fn base_url(&self) -> String {
            format!("http://{}", self.address)
        }

        async fn request(self) -> String {
            self.handle
                .await
                .expect("fake embedding server task should join")
        }
    }

    async fn read_http_request(stream: &mut tokio::net::TcpStream) -> String {
        let mut buffer = Vec::new();
        let mut temp = [0; 1024];
        let header_end;
        loop {
            let read = stream.read(&mut temp).await.expect("request should read");
            assert_ne!(read, 0, "client closed before request headers");
            buffer.extend_from_slice(&temp[..read]);
            if let Some(position) = find_header_end(&buffer) {
                header_end = position;
                break;
            }
        }

        let headers =
            std::str::from_utf8(&buffer[..header_end]).expect("request headers should be utf8");
        let content_length = headers
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
        let body_start = header_end + 4;
        while buffer.len() < body_start + content_length {
            let read = stream
                .read(&mut temp)
                .await
                .expect("request body should read");
            assert_ne!(read, 0, "client closed before request body");
            buffer.extend_from_slice(&temp[..read]);
        }

        String::from_utf8(buffer[..body_start + content_length].to_vec())
            .expect("request should be utf8")
    }

    fn find_header_end(buffer: &[u8]) -> Option<usize> {
        buffer.windows(4).position(|window| window == b"\r\n\r\n")
    }

    fn request_body(request: &str) -> &str {
        request
            .split_once("\r\n\r\n")
            .map(|(_, body)| body)
            .expect("request should include body")
    }
}
