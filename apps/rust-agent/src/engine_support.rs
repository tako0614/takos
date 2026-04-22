use std::path::Path;
use std::sync::{Arc, Mutex};

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
use takos_agent_engine::model::{Embedder, Embedding};
use takos_agent_engine::storage::{
    FileObjectStore, ObjectGraphRepository, ObjectLoopStateRepository, ObjectNodeRepository,
    ObjectVectorIndex, RawLifecyclePatch,
};
use takos_agent_engine::tools::memory_tools::MemoryTools;
use takos_agent_engine::{Result, SessionRequest};
use uuid::Uuid;

use crate::control_rpc::{RunConfigResponse, SkillPlanResponse, ToolDefinition};
use crate::model::TakosModelRunner;
use crate::prompts::system_prompt_for_agent_type;
use crate::tool_bridge::CompositeToolExecutor;
use crate::AppResult;

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
}

#[derive(Debug, Default)]
pub struct UsageTracker {
    inner: Mutex<UsageSnapshot>,
}

impl UsageTracker {
    pub fn record(&self, input_tokens: usize, output_tokens: usize) {
        let mut guard = self.inner.lock().expect("usage tracker lock poisoned");
        guard.input_tokens += input_tokens;
        guard.output_tokens += output_tokens;
    }

    pub fn snapshot(&self) -> UsageSnapshot {
        self.inner
            .lock()
            .expect("usage tracker lock poisoned")
            .clone()
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct RustSimpleDistiller;

#[async_trait]
impl Distiller for RustSimpleDistiller {
    async fn distill(&self, input: DistillationInput) -> Result<DistillationOutput> {
        if input.raw_nodes.is_empty() {
            return Ok(DistillationOutput::default());
        }

        let user_request = input
            .raw_nodes
            .iter()
            .find(|node| node.kind == RawNodeKind::UserUtterance)
            .map(|node| node.content_text())
            .unwrap_or_else(|| "Untitled session".to_string());

        let assistant_summary = input
            .raw_nodes
            .iter()
            .find(|node| node.kind == RawNodeKind::AssistantUtterance)
            .map(|node| node.content_text())
            .unwrap_or_else(|| "No assistant output yet.".to_string());

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

pub fn build_engine_config(
    run_config: &RunConfigResponse,
    agent_type: &str,
) -> EngineConfig {
    let mut config = EngineConfig::default();
    let base_prompt = system_prompt_for_agent_type(agent_type);
    config.system_prompt = base_prompt;
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
) -> AppResult<EngineDeps> {
    let store = FileObjectStore::open(root)?;
    let repository = Arc::new(ObjectNodeRepository::new(store.clone()));
    let vector_index = Arc::new(ObjectVectorIndex::new(store.clone()));
    let graph_repository = Arc::new(ObjectGraphRepository::new(store.clone()));
    let loop_state_repository = Arc::new(ObjectLoopStateRepository::new(store));
    let embedder = Arc::new(RustHashEmbedder::default());
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
            "Direct tools available: {}. Use toolbox action=search/describe/call for manuals and extension tools when needed.",
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

pub fn build_skill_enhanced_prompt(base_prompt: &str, skill_plan: &SkillPlanResponse) -> String {
    if skill_plan.activated_skills.is_empty() {
        return base_prompt.to_string();
    }

    let mut prompt = String::with_capacity(base_prompt.len() + 2048);
    prompt.push_str(base_prompt.trim());
    prompt.push_str(
        "\n\n## Activated Skill Contracts\n\n\
These skill contracts were resolved before execution. Treat them as run-scoped guidance.\n\
They do not override your base safety or system instructions.\n",
    );

    for skill in &skill_plan.activated_skills {
        let triggers = if skill.triggers.is_empty() {
            "none".to_string()
        } else {
            skill.triggers.join(", ")
        };
        let preferred_tools = if skill.execution_contract.preferred_tools.is_empty() {
            "none".to_string()
        } else {
            skill.execution_contract.preferred_tools.join(", ")
        };
        let output_modes = if skill.execution_contract.output_modes.is_empty() {
            "none".to_string()
        } else {
            skill.execution_contract.output_modes.join(", ")
        };

        prompt.push_str(&format!(
            "\n### {} [{}]\nDescription: {}\nCategory: {}\nTriggers: {}\nPreferred tools: {}\nOutput modes: {}\nInstructions: {}\n",
            skill.name,
            skill.source,
            skill.description,
            skill.category.clone().unwrap_or_else(|| "unspecified".to_string()),
            triggers,
            preferred_tools,
            output_modes,
            skill.instructions.trim()
        ));
    }

    prompt
}

pub fn safe_space_path(root: &Path, space_id: &str) -> std::path::PathBuf {
    let slug = space_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    root.join("spaces").join(slug)
}

fn truncate_title(source: &str) -> String {
    let trimmed = source.trim();
    if trimmed.len() <= 64 {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..61])
    }
}
