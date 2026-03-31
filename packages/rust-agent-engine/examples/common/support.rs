use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::json;
use takos_agent_engine::config::EngineConfig;
use takos_agent_engine::domain::{
    AbstractNode, AbstractNodeMetadata, DistillationState, EntityRef, GraphFragment, RawNodeKind,
    References, Relation,
};
use takos_agent_engine::engine::context_assembler::TokenEstimator;
use takos_agent_engine::engine::session_engine::EngineDeps;
use takos_agent_engine::memory::distillation::{
    DistillationInput, DistillationOutput, Distiller, RawLifecycleUpdate,
};
use takos_agent_engine::memory::scoring::DefaultScoringPolicy;
use takos_agent_engine::model::embedding::{Embedder, Embedding};
use takos_agent_engine::model::runner::{ModelInput, ModelOutput, ModelRunner, ToolCallRequest};
use takos_agent_engine::storage::{
    FileObjectStore, ObjectGraphRepository, ObjectLoopStateRepository, ObjectNodeRepository,
    ObjectVectorIndex, RawLifecyclePatch,
};
use takos_agent_engine::tools::executor::DefaultToolExecutor;
use takos_agent_engine::tools::memory_tools::MemoryTools;
use takos_agent_engine::Result;

#[derive(Debug, Clone, Copy)]
pub struct ExampleWhitespaceTokenEstimator;

impl TokenEstimator for ExampleWhitespaceTokenEstimator {
    fn estimate_text(&self, text: &str) -> usize {
        text.split_whitespace().count().max(1)
    }
}

#[derive(Debug, Clone)]
pub struct ExampleHashEmbedder {
    dimensions: usize,
}

impl Default for ExampleHashEmbedder {
    fn default() -> Self {
        Self { dimensions: 32 }
    }
}

#[async_trait]
impl Embedder for ExampleHashEmbedder {
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

#[derive(Debug, Clone, Copy, Default)]
pub struct ExampleRuleBasedModelRunner;

#[async_trait]
impl ModelRunner for ExampleRuleBasedModelRunner {
    async fn run(&self, input: ModelInput) -> Result<ModelOutput> {
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

            if input.user_message.starts_with("timeline:") {
                return Ok(ModelOutput {
                    assistant_message: None,
                    tool_calls: vec![ToolCallRequest {
                        name: "timeline_search".to_string(),
                        arguments: json!({
                            "limit": 8
                        }),
                    }],
                });
            }
        }

        let mut lines = Vec::new();
        lines.push(format!(
            "session={} loop={}",
            input.session_id, input.loop_id
        ));
        lines.push(format!(
            "system_prompt_tokens={}",
            input.system_prompt.split_whitespace().count()
        ));
        lines.push(format!(
            "recent_session_items={}",
            input.session_context.len()
        ));
        if let Some(plan) = &input.plan {
            lines.push(format!("plan={plan}"));
        }
        if !input.memory_context.is_empty() {
            lines.push(format!("memory_hits={}", input.memory_context.len()));
        }
        if !input.tool_context.is_empty() {
            lines.push(format!("tool_findings={}", input.tool_context.join(" | ")));
        }
        lines.push(format!("user={}", input.user_message));

        Ok(ModelOutput {
            assistant_message: Some(lines.join("\n")),
            tool_calls: Vec::new(),
        })
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ExampleSimpleDistiller;

#[async_trait]
impl Distiller for ExampleSimpleDistiller {
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
                confidence: 0.68,
                importance: 0.72,
                tags: vec!["distilled".to_string(), "loop".to_string()],
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

pub fn build_object_deps(root: &Path) -> Result<EngineDeps> {
    let store = FileObjectStore::open(root)?;
    let repository = Arc::new(ObjectNodeRepository::new(store.clone()));
    let vector_index = Arc::new(ObjectVectorIndex::new(store.clone()));
    let graph_repository = Arc::new(ObjectGraphRepository::new(store.clone()));
    let loop_state_repository = Arc::new(ObjectLoopStateRepository::new(store));
    let embedder = Arc::new(ExampleHashEmbedder::default());
    let scoring_policy = Arc::new(DefaultScoringPolicy::default());
    let token_estimator = Arc::new(ExampleWhitespaceTokenEstimator);
    let model_runner = Arc::new(ExampleRuleBasedModelRunner);
    let distiller = Arc::new(ExampleSimpleDistiller);
    let memory_tools = MemoryTools::new(
        repository.clone(),
        vector_index.clone(),
        graph_repository.clone(),
        embedder.clone(),
    );
    let tool_executor = Arc::new(DefaultToolExecutor::new(memory_tools));

    Ok(EngineDeps {
        repository,
        vector_index,
        graph_repository,
        loop_state_repository,
        embedder,
        model_runner,
        tool_executor,
        distiller,
        scoring_policy,
        token_estimator,
    })
}

pub fn default_demo_config() -> EngineConfig {
    EngineConfig::default()
}

fn truncate_title(source: &str) -> String {
    let trimmed = source.trim();
    if trimmed.len() <= 64 {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..61])
    }
}
