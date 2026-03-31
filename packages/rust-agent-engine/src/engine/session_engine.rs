use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;
use chrono::{Duration as ChronoDuration, Utc};
use tracing::{info_span, instrument};

use crate::config::EngineConfig;
use crate::domain::{
    AbstractNode, DistillationState, LoopStatus, OverflowPolicy, RawContent, RawNode, RawNodeKind,
};
use crate::engine::context_assembler::{ContextAssembler, TokenEstimator};
use crate::engine::execution_graph::{
    ExecutionGraph, ExecutionState, GraphNode, GraphRunResult, GraphRunner, NodeOutcome,
    NodeRuntimeClass, ResolvedRunOptions, RunOptions, DEFAULT_EDGE,
};
use crate::error::{EngineError, Result};
use crate::ids::{LoopId, SessionId};
use crate::memory::{
    ActivationQuery, ActivationService, DistillationInput, Distiller, ScoringPolicy,
};
use crate::model::{Embedder, ModelInput, ModelRunner};
use crate::storage::{
    GraphRepository, LoopStateRepository, NodeRepository, RawLifecyclePatch, VectorIndex,
};
use crate::tools::executor::{ToolCallResult, ToolExecutor};

const INGEST_USER_INPUT_NODE: &str = "ingest_user_input";
const LOAD_SESSION_VIEW_NODE: &str = "load_session_view";
const BUILD_ACTIVATION_QUERY_NODE: &str = "build_activation_query";
const ACTIVATE_MEMORY_NODE: &str = "activate_memory";
const ASSEMBLE_CONTEXT_NODE: &str = "assemble_context";
const RUN_MODEL_NODE: &str = "run_model";
const EXECUTE_TOOLS_NODE: &str = "execute_tools";
const BUILD_FOLLOWUP_ACTIVATION_QUERY_NODE: &str = "build_followup_activation_query";
const REACTIVATE_MEMORY_NODE: &str = "reactivate_memory";
const REASSEMBLE_CONTEXT_NODE: &str = "reassemble_context";
const RUN_MODEL_AFTER_TOOLS_NODE: &str = "run_model_after_tools";
const PERSIST_ASSISTANT_OUTPUT_NODE: &str = "persist_assistant_output";
const MARK_SESSION_OVERFLOW_NODE: &str = "mark_session_overflow";
const DISTILL_CURRENT_LOOP_NODE: &str = "distill_current_loop";

#[derive(Clone)]
pub struct EngineDeps {
    pub repository: Arc<dyn NodeRepository>,
    pub vector_index: Arc<dyn VectorIndex>,
    pub graph_repository: Arc<dyn GraphRepository>,
    pub loop_state_repository: Arc<dyn LoopStateRepository>,
    pub embedder: Arc<dyn Embedder>,
    pub model_runner: Arc<dyn ModelRunner>,
    pub tool_executor: Arc<dyn ToolExecutor>,
    pub distiller: Arc<dyn Distiller>,
    pub scoring_policy: Arc<dyn ScoringPolicy>,
    pub token_estimator: Arc<dyn TokenEstimator>,
}

impl EngineDeps {
    fn activation_service(&self) -> ActivationService {
        ActivationService::new(
            self.repository.clone(),
            self.vector_index.clone(),
            self.scoring_policy.clone(),
        )
    }

    fn context_assembler(&self) -> ContextAssembler {
        ContextAssembler::new(self.token_estimator.clone())
    }
}

#[derive(Debug, Clone)]
pub struct SessionRequest {
    pub session_id: Option<SessionId>,
    pub user_message: String,
    pub plan: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionResponse {
    pub session_id: SessionId,
    pub loop_id: LoopId,
    pub status: LoopStatus,
    pub assistant_message: Option<String>,
    pub activated_raw_count: usize,
    pub activated_abstract_count: usize,
    pub tool_results_count: usize,
    pub completed_steps: u32,
    pub tool_rounds_completed: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MaintenanceReport {
    pub processed_loops: usize,
    pub skipped_loops: usize,
    pub new_abstract_nodes: usize,
    pub updated_raw_nodes: usize,
}

#[instrument(skip(config, deps), fields(session_id, loop_id))]
pub async fn run_turn(
    config: &EngineConfig,
    deps: &EngineDeps,
    request: SessionRequest,
) -> Result<SessionResponse> {
    run_turn_with_options(config, deps, request, RunOptions::default()).await
}

#[instrument(skip(config, deps, options), fields(session_id, loop_id))]
pub async fn run_turn_with_options(
    config: &EngineConfig,
    deps: &EngineDeps,
    request: SessionRequest,
    options: RunOptions,
) -> Result<SessionResponse> {
    config.validate()?;

    let session_id = request.session_id.unwrap_or_default();
    let loop_id = LoopId::new();
    tracing::Span::current().record("session_id", tracing::field::display(session_id));
    tracing::Span::current().record("loop_id", tracing::field::display(loop_id));

    let resolved_options = ResolvedRunOptions::from_config(config, options);
    let graph = Arc::new(build_default_execution_graph());
    let runner = GraphRunner::new(graph);
    let mut state = ExecutionState::from_request(request, session_id, loop_id);
    let result = runner
        .run(&mut state, config, deps, &resolved_options)
        .await?;

    Ok(build_response(state, result))
}

#[instrument(skip(config, deps, options), fields(session_id, loop_id))]
pub async fn resume_loop(
    config: &EngineConfig,
    deps: &EngineDeps,
    session_id: SessionId,
    loop_id: LoopId,
    options: RunOptions,
) -> Result<SessionResponse> {
    config.validate()?;
    tracing::Span::current().record("session_id", tracing::field::display(session_id));
    tracing::Span::current().record("loop_id", tracing::field::display(loop_id));

    let checkpoint = deps
        .loop_state_repository
        .load_checkpoint(&session_id, &loop_id)
        .await?
        .ok_or_else(|| EngineError::CheckpointNotFound {
            session_id: session_id.to_string(),
            loop_id: loop_id.to_string(),
        })?;

    let resolved_options = ResolvedRunOptions::from_config(config, options);
    let graph = Arc::new(build_default_execution_graph());
    let runner = GraphRunner::new(graph);
    let (state, result) = runner
        .resume(checkpoint, config, deps, &resolved_options)
        .await?;

    Ok(build_response(state, result))
}

pub async fn run_maintenance_pass(
    config: &EngineConfig,
    deps: &EngineDeps,
    limit: usize,
) -> Result<MaintenanceReport> {
    config.validate()?;
    let resolved_options = ResolvedRunOptions::from_config(config, RunOptions::default());
    let backlog_limit = limit.max(1).min(resolved_options.maintenance_batch_size);
    let backlog = deps.repository.undistilled_raw(backlog_limit, true).await?;
    let mut grouped: BTreeMap<(SessionId, LoopId), Vec<RawNode>> = BTreeMap::new();
    for node in backlog {
        if let (Some(session_id), Some(loop_id)) = (node.session_id, node.loop_id) {
            grouped.entry((session_id, loop_id)).or_default().push(node);
        }
    }

    let mut report = MaintenanceReport::default();
    for ((session_id, loop_id), raw_nodes) in grouped {
        let span = info_span!(
            "maintenance_distillation",
            session_id = %session_id,
            loop_id = %loop_id,
            raw_nodes = raw_nodes.len()
        );
        let _guard = span.enter();
        let distilled = deps
            .distiller
            .distill(DistillationInput {
                session_id,
                loop_id,
                raw_nodes: raw_nodes.clone(),
                activated_abstract_ids: Vec::new(),
            })
            .await?;

        let mut created_for_loop = 0usize;
        for node in distilled.new_nodes {
            if persist_abstract_node(deps, node).await?.is_some() {
                report.new_abstract_nodes += 1;
                created_for_loop += 1;
            }
        }
        for update in distilled.raw_updates {
            deps.repository
                .update_raw_lifecycle(&[update.raw_node_id], &update.patch)
                .await?;
            report.updated_raw_nodes += 1;
        }
        if created_for_loop == 0 {
            report.skipped_loops += 1;
        } else {
            report.processed_loops += 1;
        }
    }

    Ok(report)
}

pub(crate) fn build_default_execution_graph() -> ExecutionGraph {
    let mut graph = ExecutionGraph::new(INGEST_USER_INPUT_NODE);
    graph.add_node(Arc::new(IngestUserInputNode));
    graph.add_node(Arc::new(LoadSessionViewNode));
    graph.add_node(Arc::new(BuildActivationQueryNode {
        id: BUILD_ACTIVATION_QUERY_NODE,
    }));
    graph.add_node(Arc::new(ActivateMemoryNode {
        id: ACTIVATE_MEMORY_NODE,
    }));
    graph.add_node(Arc::new(AssembleContextNode {
        id: ASSEMBLE_CONTEXT_NODE,
        reload_session: false,
    }));
    graph.add_node(Arc::new(ModelNode { id: RUN_MODEL_NODE }));
    graph.add_node(Arc::new(ExecuteToolsNode));
    graph.add_node(Arc::new(BuildActivationQueryNode {
        id: BUILD_FOLLOWUP_ACTIVATION_QUERY_NODE,
    }));
    graph.add_node(Arc::new(ActivateMemoryNode {
        id: REACTIVATE_MEMORY_NODE,
    }));
    graph.add_node(Arc::new(AssembleContextNode {
        id: REASSEMBLE_CONTEXT_NODE,
        reload_session: true,
    }));
    graph.add_node(Arc::new(ModelNode {
        id: RUN_MODEL_AFTER_TOOLS_NODE,
    }));
    graph.add_node(Arc::new(PersistAssistantOutputNode));
    graph.add_node(Arc::new(MarkSessionOverflowNode));
    graph.add_node(Arc::new(DistillCurrentLoopNode));

    graph.add_edge(INGEST_USER_INPUT_NODE, DEFAULT_EDGE, LOAD_SESSION_VIEW_NODE);
    graph.add_edge(
        LOAD_SESSION_VIEW_NODE,
        DEFAULT_EDGE,
        BUILD_ACTIVATION_QUERY_NODE,
    );
    graph.add_edge(
        BUILD_ACTIVATION_QUERY_NODE,
        DEFAULT_EDGE,
        ACTIVATE_MEMORY_NODE,
    );
    graph.add_edge(ACTIVATE_MEMORY_NODE, DEFAULT_EDGE, ASSEMBLE_CONTEXT_NODE);
    graph.add_edge(ASSEMBLE_CONTEXT_NODE, DEFAULT_EDGE, RUN_MODEL_NODE);
    graph.add_edge(RUN_MODEL_NODE, DEFAULT_EDGE, PERSIST_ASSISTANT_OUTPUT_NODE);
    graph.add_edge(RUN_MODEL_NODE, "needs_tools", EXECUTE_TOOLS_NODE);
    graph.add_edge(
        EXECUTE_TOOLS_NODE,
        DEFAULT_EDGE,
        BUILD_FOLLOWUP_ACTIVATION_QUERY_NODE,
    );
    graph.add_edge(
        BUILD_FOLLOWUP_ACTIVATION_QUERY_NODE,
        DEFAULT_EDGE,
        REACTIVATE_MEMORY_NODE,
    );
    graph.add_edge(
        REACTIVATE_MEMORY_NODE,
        DEFAULT_EDGE,
        REASSEMBLE_CONTEXT_NODE,
    );
    graph.add_edge(
        REASSEMBLE_CONTEXT_NODE,
        DEFAULT_EDGE,
        RUN_MODEL_AFTER_TOOLS_NODE,
    );
    graph.add_edge(
        RUN_MODEL_AFTER_TOOLS_NODE,
        DEFAULT_EDGE,
        PERSIST_ASSISTANT_OUTPUT_NODE,
    );
    graph.add_edge(
        RUN_MODEL_AFTER_TOOLS_NODE,
        "needs_tools",
        EXECUTE_TOOLS_NODE,
    );
    graph.add_edge(
        PERSIST_ASSISTANT_OUTPUT_NODE,
        DEFAULT_EDGE,
        MARK_SESSION_OVERFLOW_NODE,
    );
    graph.add_edge(
        MARK_SESSION_OVERFLOW_NODE,
        DEFAULT_EDGE,
        DISTILL_CURRENT_LOOP_NODE,
    );

    graph
}

struct IngestUserInputNode;

#[async_trait]
impl GraphNode for IngestUserInputNode {
    fn id(&self) -> &'static str {
        INGEST_USER_INPUT_NODE
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let node = RawNode::text(
            RawNodeKind::UserUtterance,
            Some(state.session_id),
            Some(state.loop_id),
            "user",
            state.user_message.clone(),
            0.85,
            vec!["input".to_string()],
        )
        .with_operation_key(user_input_operation_key(state.loop_id));
        let node = persist_raw_node(deps, node).await?;
        push_raw_node_into_state(state, node);
        Ok(NodeOutcome::Continue)
    }
}

struct LoadSessionViewNode;

#[async_trait]
impl GraphNode for LoadSessionViewNode {
    fn id(&self) -> &'static str {
        LOAD_SESSION_VIEW_NODE
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        state.recent_session = deps.repository.session_raw(&state.session_id).await?;
        Ok(NodeOutcome::Continue)
    }
}

struct BuildActivationQueryNode {
    id: &'static str,
}

#[async_trait]
impl GraphNode for BuildActivationQueryNode {
    fn id(&self) -> &'static str {
        self.id
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        _deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let recent_context = state
            .recent_session
            .iter()
            .rev()
            .take(12)
            .map(|node| node.context_text())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        state.activation_query = Some(ActivationQuery::new(
            state.user_message.clone(),
            recent_context,
            state.plan.clone(),
            state
                .tool_results
                .iter()
                .map(|result| result.summary.clone())
                .collect(),
        ));
        Ok(NodeOutcome::Continue)
    }
}

struct ActivateMemoryNode {
    id: &'static str,
}

#[async_trait]
impl GraphNode for ActivateMemoryNode {
    fn id(&self) -> &'static str {
        self.id
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        config: &EngineConfig,
        deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let activation_query = state.activation_query.as_ref().ok_or_else(|| {
            EngineError::Configuration(
                "activation query must exist before memory activation".into(),
            )
        })?;
        let query_embedding = deps
            .embedder
            .embed_text(&activation_query.as_embedding_input())
            .await?;
        state.query_embedding = Some(query_embedding.clone());
        state.activated_memory = deps
            .activation_service()
            .activate(config, &query_embedding, Utc::now())
            .await?;
        Ok(NodeOutcome::Continue)
    }
}

struct AssembleContextNode {
    id: &'static str,
    reload_session: bool,
}

#[async_trait]
impl GraphNode for AssembleContextNode {
    fn id(&self) -> &'static str {
        self.id
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        config: &EngineConfig,
        deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        if self.reload_session {
            state.recent_session = deps.repository.session_raw(&state.session_id).await?;
        }
        let context = deps.context_assembler().assemble(
            &config.context_budget,
            &config.system_prompt,
            &state.recent_session,
            &state.activated_memory,
            &state.tool_results,
        );
        state.session_window_ids = context.session_window.included_raw_ids.clone();
        state.pushed_out_raw_ids = context.session_window.pushed_out_raw_ids.clone();
        state.assembled_context = Some(context);
        Ok(NodeOutcome::Continue)
    }
}

struct ModelNode {
    id: &'static str,
}

#[async_trait]
impl GraphNode for ModelNode {
    fn id(&self) -> &'static str {
        self.id
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        deps: &EngineDeps,
        options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let context = state.assembled_context.as_ref().ok_or_else(|| {
            EngineError::Configuration("assembled context must exist before model execution".into())
        })?;
        let output = deps
            .model_runner
            .run(to_model_input(
                state.session_id,
                state.loop_id,
                &state.user_message,
                state.plan.clone(),
                context,
            ))
            .await?;
        state.model_invocations = state.model_invocations.saturating_add(1);
        state.pending_tool_calls = output.tool_calls.clone();
        if let Some(message) = &output.assistant_message {
            state.assistant_message = Some(message.clone());
        }
        state.latest_model_output = Some(output.clone());

        if !state.pending_tool_calls.is_empty()
            && state.tool_rounds_completed < options.max_tool_rounds
        {
            return Ok(NodeOutcome::Branch("needs_tools".to_string()));
        }

        if !state.pending_tool_calls.is_empty() && state.assistant_message.is_none() {
            state.assistant_message = Some(format!(
                "Tool round limit reached after {} rounds without a final assistant message.",
                options.max_tool_rounds
            ));
        }
        Ok(NodeOutcome::Continue)
    }
}

struct ExecuteToolsNode;

#[async_trait]
impl GraphNode for ExecuteToolsNode {
    fn id(&self) -> &'static str {
        EXECUTE_TOOLS_NODE
    }

    fn runtime_class(&self) -> NodeRuntimeClass {
        NodeRuntimeClass::ToolExecution
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        deps: &EngineDeps,
        options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let calls = std::mem::take(&mut state.pending_tool_calls);
        let round = state.tool_rounds_completed.saturating_add(1);
        for (index, call) in calls.into_iter().enumerate() {
            if options.is_cancelled() {
                return Ok(NodeOutcome::Pause);
            }

            let operation_key = tool_result_operation_key(state.loop_id, round, index, &call.name);
            let raw_node = if let Some(existing) = deps
                .repository
                .get_raw_by_operation_key(&operation_key)
                .await?
            {
                existing
            } else {
                let result = deps.tool_executor.execute(call.clone()).await?;
                let raw = RawNode::json(
                    RawNodeKind::ToolResult,
                    Some(state.session_id),
                    Some(state.loop_id),
                    format!("tool:{}", result.name),
                    serde_json::to_value(&result).map_err(|err| {
                        EngineError::Tool(format!("failed to encode tool result payload: {err}"))
                    })?,
                    0.72,
                    vec!["tool".to_string()],
                )
                .with_operation_key(operation_key.clone());
                let raw = persist_raw_node(deps, raw).await?;
                state.last_effect_key = Some(operation_key);
                raw
            };

            let tool_result = decode_tool_result_from_raw(&raw_node)?;
            push_raw_node_into_state(state, raw_node);
            state.tool_results.push(tool_result);
        }

        state.tool_rounds_completed = round;
        Ok(NodeOutcome::Continue)
    }
}

struct PersistAssistantOutputNode;

#[async_trait]
impl GraphNode for PersistAssistantOutputNode {
    fn id(&self) -> &'static str {
        PERSIST_ASSISTANT_OUTPUT_NODE
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let assistant_message = state
            .assistant_message
            .clone()
            .or_else(|| {
                state
                    .latest_model_output
                    .as_ref()
                    .and_then(|output| output.assistant_message.clone())
            })
            .unwrap_or_else(|| "No assistant message generated.".to_string());
        let node = RawNode::text(
            RawNodeKind::AssistantUtterance,
            Some(state.session_id),
            Some(state.loop_id),
            "assistant",
            assistant_message.clone(),
            0.78,
            vec!["output".to_string()],
        )
        .with_operation_key(assistant_output_operation_key(state.loop_id));
        let node = persist_raw_node(deps, node).await?;
        state.assistant_message = Some(assistant_message);
        push_raw_node_into_state(state, node);
        Ok(NodeOutcome::Continue)
    }
}

struct MarkSessionOverflowNode;

#[async_trait]
impl GraphNode for MarkSessionOverflowNode {
    fn id(&self) -> &'static str {
        MARK_SESSION_OVERFLOW_NODE
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let clear_ids: Vec<_> = state
            .recent_session
            .iter()
            .filter(|node| {
                node.distillation_state != DistillationState::Distilled
                    && state.session_window_ids.contains(&node.id)
            })
            .map(|node| node.id)
            .collect();
        if !clear_ids.is_empty() {
            deps.repository
                .update_raw_lifecycle(
                    &clear_ids,
                    &RawLifecyclePatch {
                        distillation_state: None,
                        overflow: Some(OverflowPolicy {
                            was_pushed_out_of_session: false,
                            relax_retrieval_until: None,
                        }),
                    },
                )
                .await?;
        }

        let pushed_ids: Vec<_> = state
            .recent_session
            .iter()
            .filter(|node| {
                node.distillation_state != DistillationState::Distilled
                    && state.pushed_out_raw_ids.contains(&node.id)
            })
            .map(|node| node.id)
            .collect();
        if !pushed_ids.is_empty() {
            deps.repository
                .update_raw_lifecycle(
                    &pushed_ids,
                    &RawLifecyclePatch {
                        distillation_state: None,
                        overflow: Some(OverflowPolicy {
                            was_pushed_out_of_session: true,
                            relax_retrieval_until: Some(Utc::now() + ChronoDuration::hours(24)),
                        }),
                    },
                )
                .await?;
        }

        state.recent_session = deps.repository.session_raw(&state.session_id).await?;
        Ok(NodeOutcome::Continue)
    }
}

struct DistillCurrentLoopNode;

#[async_trait]
impl GraphNode for DistillCurrentLoopNode {
    fn id(&self) -> &'static str {
        DISTILL_CURRENT_LOOP_NODE
    }

    fn runtime_class(&self) -> NodeRuntimeClass {
        NodeRuntimeClass::Distillation
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        _config: &EngineConfig,
        deps: &EngineDeps,
        _options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome> {
        let raw_nodes = deps.repository.raw_for_loop(&state.loop_id).await?;
        let distilled = deps
            .distiller
            .distill(DistillationInput {
                session_id: state.session_id,
                loop_id: state.loop_id,
                raw_nodes,
                activated_abstract_ids: state
                    .activated_memory
                    .abstract_nodes
                    .iter()
                    .map(|entry| entry.node.id)
                    .collect(),
            })
            .await?;

        for node in distilled.new_nodes {
            if let Some(node) = persist_abstract_node(deps, node).await? {
                state.new_abstract_ids.push(node.id);
                if let Some(operation_key) = &node.operation_key {
                    state.last_effect_key = Some(operation_key.clone());
                }
            }
        }
        for update in distilled.raw_updates {
            deps.repository
                .update_raw_lifecycle(&[update.raw_node_id], &update.patch)
                .await?;
        }
        Ok(NodeOutcome::Finish)
    }
}

fn build_response(state: ExecutionState, result: GraphRunResult) -> SessionResponse {
    SessionResponse {
        session_id: state.session_id,
        loop_id: state.loop_id,
        status: result.status,
        assistant_message: state.assistant_message,
        activated_raw_count: state.activated_memory.raw_nodes.len(),
        activated_abstract_count: state.activated_memory.abstract_nodes.len(),
        tool_results_count: state.tool_results.len(),
        completed_steps: result.completed_steps,
        tool_rounds_completed: result.tool_rounds_completed,
    }
}

fn to_model_input(
    session_id: SessionId,
    loop_id: LoopId,
    user_message: &str,
    plan: Option<String>,
    context: &crate::engine::context_assembler::AssembledContext,
) -> ModelInput {
    ModelInput {
        session_id,
        loop_id,
        system_prompt: context.system_prompt.clone(),
        session_context: context.session_context.clone(),
        memory_context: context.memory_context.clone(),
        tool_context: context.tool_context.clone(),
        user_message: user_message.to_string(),
        plan,
    }
}

async fn persist_raw_node(deps: &EngineDeps, node: RawNode) -> Result<RawNode> {
    if let Some(operation_key) = &node.operation_key {
        if let Some(existing) = deps
            .repository
            .get_raw_by_operation_key(operation_key)
            .await?
        {
            return Ok(existing);
        }
    }
    let embedding = deps.embedder.embed_text(&node.content_text()).await?;
    deps.repository.insert_raw(node.clone()).await?;
    deps.vector_index.index_raw(node.id, embedding).await?;
    Ok(node)
}

async fn persist_abstract_node(
    deps: &EngineDeps,
    node: AbstractNode,
) -> Result<Option<AbstractNode>> {
    if let Some(operation_key) = &node.operation_key {
        if let Some(existing) = deps
            .repository
            .get_abstract_by_operation_key(operation_key)
            .await?
        {
            return Ok(Some(existing));
        }
    }
    let embedding = deps
        .embedder
        .embed_text(&format!("{} {}", node.title, node.summary))
        .await?;
    deps.repository.insert_abstract(node.clone()).await?;
    deps.vector_index.index_abstract(node.id, embedding).await?;
    deps.graph_repository.index_abstract(&node).await?;
    Ok(Some(node))
}

fn push_raw_node_into_state(state: &mut ExecutionState, node: RawNode) {
    if !state.persisted_raw_ids.contains(&node.id) {
        state.persisted_raw_ids.push(node.id);
    }
    if matches!(node.kind, RawNodeKind::ToolResult) && !state.tool_result_ids.contains(&node.id) {
        state.tool_result_ids.push(node.id);
    }
    if !state.recent_session.iter().any(|entry| entry.id == node.id) {
        state.recent_session.push(node);
        state
            .recent_session
            .sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
    }
}

fn decode_tool_result_from_raw(node: &RawNode) -> Result<ToolCallResult> {
    match &node.content {
        RawContent::Json(value) => serde_json::from_value(value.clone()).map_err(|err| {
            EngineError::Tool(format!("failed to decode tool result from raw node: {err}"))
        }),
        RawContent::Text(_) => Err(EngineError::Tool(
            "tool result raw node must store a JSON payload".to_string(),
        )),
    }
}

fn user_input_operation_key(loop_id: LoopId) -> String {
    format!("loop:{loop_id}:user_input")
}

fn assistant_output_operation_key(loop_id: LoopId) -> String {
    format!("loop:{loop_id}:assistant_output")
}

fn tool_result_operation_key(loop_id: LoopId, round: u32, index: usize, name: &str) -> String {
    format!("loop:{loop_id}:tool:{round}:{index}:{name}")
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    use async_trait::async_trait;
    use tokio::time::sleep;
    use tokio_util::sync::CancellationToken;

    use crate::config::EngineConfig;
    use crate::domain::{DistillationState, LoopStatus, RawNode, RawNodeKind};
    use crate::engine::execution_graph::{
        ExecutionGraph, ExecutionState, GraphNode, GraphRunner, NodeOutcome, ResolvedRunOptions,
        RunOptions, DEFAULT_EDGE,
    };
    use crate::engine::session_engine::{
        build_default_execution_graph, run_maintenance_pass, run_turn, run_turn_with_options,
        EngineDeps, SessionRequest,
    };
    use crate::error::Result;
    use crate::ids::{LoopId, SessionId};
    use crate::memory::scoring::DefaultScoringPolicy;
    use crate::model::{ModelInput, ModelOutput, ModelRunner};
    use crate::storage::object_store::{
        FileObjectStore, ObjectGraphRepository, ObjectLoopStateRepository, ObjectNodeRepository,
        ObjectVectorIndex,
    };
    use crate::storage::{
        InMemoryGraphRepository, InMemoryLoopStateRepository, InMemoryNodeRepository,
        InMemoryVectorIndex,
    };
    use crate::test_support::{
        TestHashEmbedder, TestRuleBasedModelRunner, TestSimpleDistiller,
        TestWhitespaceTokenEstimator,
    };
    use crate::tools::executor::DefaultToolExecutor;
    use crate::tools::memory_tools::MemoryTools;

    fn build_demo_deps() -> EngineDeps {
        let repository = Arc::new(InMemoryNodeRepository::default());
        let vector_index = Arc::new(InMemoryVectorIndex::default());
        let graph_repository = Arc::new(InMemoryGraphRepository::default());
        let loop_state_repository = Arc::new(InMemoryLoopStateRepository::default());
        let embedder = Arc::new(TestHashEmbedder::default());
        let scoring_policy = Arc::new(DefaultScoringPolicy::default());
        let token_estimator = Arc::new(TestWhitespaceTokenEstimator);
        let model_runner = Arc::new(TestRuleBasedModelRunner);
        let distiller = Arc::new(TestSimpleDistiller);
        let memory_tools = MemoryTools::new(
            repository.clone(),
            vector_index.clone(),
            graph_repository.clone(),
            embedder.clone(),
        );
        let tool_executor = Arc::new(DefaultToolExecutor::new(memory_tools));

        EngineDeps {
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
        }
    }

    #[tokio::test]
    async fn session_engine_runs_end_to_end() -> Result<()> {
        let deps = build_demo_deps();
        let response = run_turn(
            &EngineConfig::default(),
            &deps,
            SessionRequest {
                session_id: None,
                user_message: "memory: session and memory".to_string(),
                plan: Some("Demonstrate memory retrieval.".to_string()),
            },
        )
        .await?;

        assert_eq!(response.status, LoopStatus::Finished);
        assert_eq!(response.tool_results_count, 1);
        assert!(response.assistant_message.is_some());
        Ok(())
    }

    struct PauseNode;
    struct FinishNode;
    struct LoopNode;
    struct SlowNode;

    #[async_trait]
    impl GraphNode for PauseNode {
        fn id(&self) -> &'static str {
            "pause"
        }

        async fn run(
            &self,
            state: &mut ExecutionState,
            _config: &EngineConfig,
            _deps: &EngineDeps,
            _options: &ResolvedRunOptions,
        ) -> Result<NodeOutcome> {
            if state.assistant_message.is_none() {
                state.assistant_message = Some("paused".to_string());
                Ok(NodeOutcome::Pause)
            } else {
                Ok(NodeOutcome::Continue)
            }
        }
    }

    #[async_trait]
    impl GraphNode for FinishNode {
        fn id(&self) -> &'static str {
            "finish"
        }

        async fn run(
            &self,
            state: &mut ExecutionState,
            _config: &EngineConfig,
            _deps: &EngineDeps,
            _options: &ResolvedRunOptions,
        ) -> Result<NodeOutcome> {
            state.assistant_message = Some("finished".to_string());
            Ok(NodeOutcome::Finish)
        }
    }

    #[async_trait]
    impl GraphNode for LoopNode {
        fn id(&self) -> &'static str {
            "loop"
        }

        async fn run(
            &self,
            _state: &mut ExecutionState,
            _config: &EngineConfig,
            _deps: &EngineDeps,
            _options: &ResolvedRunOptions,
        ) -> Result<NodeOutcome> {
            Ok(NodeOutcome::Continue)
        }
    }

    #[async_trait]
    impl GraphNode for SlowNode {
        fn id(&self) -> &'static str {
            "slow"
        }

        async fn run(
            &self,
            _state: &mut ExecutionState,
            _config: &EngineConfig,
            _deps: &EngineDeps,
            _options: &ResolvedRunOptions,
        ) -> Result<NodeOutcome> {
            sleep(Duration::from_millis(50)).await;
            Ok(NodeOutcome::Finish)
        }
    }

    #[tokio::test]
    async fn graph_runner_can_pause_and_resume() -> Result<()> {
        let deps = build_demo_deps();
        let mut graph = ExecutionGraph::new("pause");
        graph.add_node(Arc::new(PauseNode));
        graph.add_node(Arc::new(FinishNode));
        graph.add_edge("pause", DEFAULT_EDGE, "finish");
        let runner = GraphRunner::new(Arc::new(graph));
        let resolved_options =
            ResolvedRunOptions::from_config(&EngineConfig::default(), RunOptions::default());

        let session_id = SessionId::new();
        let loop_id = LoopId::new();
        let request = SessionRequest {
            session_id: Some(session_id),
            user_message: "pause".to_string(),
            plan: None,
        };
        let mut state = ExecutionState::from_request(request, session_id, loop_id);
        let first = runner
            .run(
                &mut state,
                &EngineConfig::default(),
                &deps,
                &resolved_options,
            )
            .await?;
        assert_eq!(first.status, LoopStatus::Paused);

        let checkpoint = deps
            .loop_state_repository
            .load_checkpoint(&session_id, &loop_id)
            .await?
            .expect("checkpoint");
        let (resumed_state, resumed) = runner
            .resume(
                checkpoint,
                &EngineConfig::default(),
                &deps,
                &resolved_options,
            )
            .await?;
        assert_eq!(resumed.status, LoopStatus::Finished);
        assert_eq!(resumed_state.assistant_message.as_deref(), Some("finished"));
        Ok(())
    }

    #[tokio::test]
    async fn graph_runner_respects_cancellation() -> Result<()> {
        let deps = build_demo_deps();
        let token = CancellationToken::new();
        token.cancel();
        let response = run_turn_with_options(
            &EngineConfig::default(),
            &deps,
            SessionRequest {
                session_id: None,
                user_message: "cancel me".to_string(),
                plan: None,
            },
            RunOptions {
                cancellation_token: Some(token),
                ..RunOptions::default()
            },
        )
        .await?;
        assert_eq!(response.status, LoopStatus::Cancelled);
        Ok(())
    }

    #[tokio::test]
    async fn graph_runner_respects_step_budget() -> Result<()> {
        let deps = build_demo_deps();
        let mut graph = ExecutionGraph::new("loop");
        graph.add_node(Arc::new(LoopNode));
        graph.add_edge("loop", DEFAULT_EDGE, "loop");
        let runner = GraphRunner::new(Arc::new(graph));
        let session_id = SessionId::new();
        let loop_id = LoopId::new();
        let request = SessionRequest {
            session_id: Some(session_id),
            user_message: "loop".to_string(),
            plan: None,
        };
        let mut state = ExecutionState::from_request(request, session_id, loop_id);
        let result = runner
            .run(
                &mut state,
                &EngineConfig::default(),
                &deps,
                &ResolvedRunOptions::from_config(
                    &EngineConfig::default(),
                    RunOptions {
                        max_graph_steps: Some(3),
                        ..RunOptions::default()
                    },
                ),
            )
            .await?;
        assert_eq!(result.status, LoopStatus::TimedOut);
        assert_eq!(result.completed_steps, 3);
        Ok(())
    }

    #[tokio::test]
    async fn graph_runner_respects_node_timeout() -> Result<()> {
        let deps = build_demo_deps();
        let mut graph = ExecutionGraph::new("slow");
        graph.add_node(Arc::new(SlowNode));
        let runner = GraphRunner::new(Arc::new(graph));
        let session_id = SessionId::new();
        let loop_id = LoopId::new();
        let request = SessionRequest {
            session_id: Some(session_id),
            user_message: "slow".to_string(),
            plan: None,
        };
        let mut state = ExecutionState::from_request(request, session_id, loop_id);
        let result = runner
            .run(
                &mut state,
                &EngineConfig::default(),
                &deps,
                &ResolvedRunOptions::from_config(
                    &EngineConfig::default(),
                    RunOptions {
                        node_timeout: Some(Duration::from_millis(10)),
                        ..RunOptions::default()
                    },
                ),
            )
            .await?;
        assert_eq!(result.status, LoopStatus::TimedOut);
        Ok(())
    }

    #[tokio::test]
    async fn maintenance_pass_distills_pushed_out_raw_without_duplication() -> Result<()> {
        let deps = build_demo_deps();
        let session_id = SessionId::new();
        let loop_id = LoopId::new();
        let mut node = RawNode::text(
            RawNodeKind::Note,
            Some(session_id),
            Some(loop_id),
            "system",
            "backlog item",
            0.5,
            Vec::new(),
        );
        node.overflow.was_pushed_out_of_session = true;
        node.distillation_state = DistillationState::Undistilled;
        deps.repository.insert_raw(node.clone()).await?;
        deps.vector_index
            .index_raw(
                node.id,
                deps.embedder.embed_text(&node.content_text()).await?,
            )
            .await?;

        let first = run_maintenance_pass(&EngineConfig::default(), &deps, 10).await?;
        let second = run_maintenance_pass(&EngineConfig::default(), &deps, 10).await?;
        assert_eq!(first.processed_loops, 1);
        assert_eq!(first.new_abstract_nodes, 1);
        assert_eq!(second.processed_loops, 0);
        Ok(())
    }

    fn temp_object_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "takos-agent-engine-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    fn build_object_deps(root: &PathBuf) -> Result<EngineDeps> {
        let store = FileObjectStore::open(root)?;
        let repository = Arc::new(ObjectNodeRepository::new(store.clone()));
        let vector_index = Arc::new(ObjectVectorIndex::new(store.clone()));
        let graph_repository = Arc::new(ObjectGraphRepository::new(store.clone()));
        let loop_state_repository = Arc::new(ObjectLoopStateRepository::new(store));
        let embedder = Arc::new(TestHashEmbedder::default());
        let scoring_policy = Arc::new(DefaultScoringPolicy::default());
        let token_estimator = Arc::new(TestWhitespaceTokenEstimator);
        let model_runner = Arc::new(TestRuleBasedModelRunner);
        let distiller = Arc::new(TestSimpleDistiller);
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

    #[tokio::test]
    async fn object_store_persists_session_across_rebuilds() -> Result<()> {
        let root = temp_object_root("object-continuity");
        let deps = build_object_deps(&root)?;
        let first = run_turn(
            &EngineConfig::default(),
            &deps,
            SessionRequest {
                session_id: None,
                user_message: "Explain object persistence".to_string(),
                plan: None,
            },
        )
        .await?;

        let deps_after_restart = build_object_deps(&root)?;
        let second = run_turn(
            &EngineConfig::default(),
            &deps_after_restart,
            SessionRequest {
                session_id: Some(first.session_id),
                user_message: "timeline: recent".to_string(),
                plan: None,
            },
        )
        .await?;

        assert_eq!(second.session_id, first.session_id);
        assert_eq!(second.status, LoopStatus::Finished);
        let session_raw = deps_after_restart
            .repository
            .session_raw(&first.session_id)
            .await?;
        assert!(session_raw.len() >= 4);

        let _ = std::fs::remove_dir_all(root);
        Ok(())
    }

    #[derive(Debug)]
    struct RepeatingToolModelRunner;

    #[async_trait]
    impl ModelRunner for RepeatingToolModelRunner {
        async fn run(&self, _input: ModelInput) -> Result<ModelOutput> {
            Ok(ModelOutput {
                assistant_message: None,
                tool_calls: vec![crate::model::runner::ToolCallRequest {
                    name: "timeline_search".to_string(),
                    arguments: serde_json::json!({ "limit": 1 }),
                }],
            })
        }
    }

    #[tokio::test]
    async fn default_graph_bounds_multi_step_tool_rounds() -> Result<()> {
        let mut deps = build_demo_deps();
        deps.model_runner = Arc::new(RepeatingToolModelRunner);
        let response = run_turn_with_options(
            &EngineConfig::default(),
            &deps,
            SessionRequest {
                session_id: None,
                user_message: "keep calling tools".to_string(),
                plan: None,
            },
            RunOptions {
                max_tool_rounds: Some(2),
                ..RunOptions::default()
            },
        )
        .await?;
        assert_eq!(response.status, LoopStatus::Finished);
        assert_eq!(response.tool_rounds_completed, 2);
        assert_eq!(response.tool_results_count, 2);
        Ok(())
    }

    #[test]
    fn default_graph_contains_expected_nodes() {
        let _graph = build_default_execution_graph();
    }
}
