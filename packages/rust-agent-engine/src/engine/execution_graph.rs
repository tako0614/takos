use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use crate::config::EngineConfig;
use crate::domain::{LoopState, LoopStatus, RawNode};
use crate::error::{EngineError, Result};
use crate::ids::{AbstractNodeId, LoopId, RawNodeId, SessionId};
use crate::memory::{ActivatedMemory, ActivationQuery};
use crate::model::{Embedding, ModelOutput, ToolCallRequest};
use crate::tools::executor::ToolCallResult;

use super::context_assembler::AssembledContext;
use super::session_engine::{EngineDeps, SessionRequest};

pub const DEFAULT_EDGE: &str = "__default__";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionState {
    pub session_id: SessionId,
    pub loop_id: LoopId,
    pub user_message: String,
    pub plan: Option<String>,
    pub recent_session: Vec<RawNode>,
    pub activation_query: Option<ActivationQuery>,
    pub query_embedding: Option<Embedding>,
    pub activated_memory: ActivatedMemory,
    pub assembled_context: Option<AssembledContext>,
    pub latest_model_output: Option<ModelOutput>,
    pub pending_tool_calls: Vec<ToolCallRequest>,
    pub tool_results: Vec<ToolCallResult>,
    pub persisted_raw_ids: Vec<RawNodeId>,
    pub tool_result_ids: Vec<RawNodeId>,
    pub new_abstract_ids: Vec<AbstractNodeId>,
    pub session_window_ids: Vec<RawNodeId>,
    pub pushed_out_raw_ids: Vec<RawNodeId>,
    pub assistant_message: Option<String>,
    pub iteration: u32,
    pub tool_rounds_completed: u32,
    pub model_invocations: u32,
    pub last_completed_node: Option<String>,
    pub last_effect_key: Option<String>,
}

impl ExecutionState {
    pub fn from_request(request: SessionRequest, session_id: SessionId, loop_id: LoopId) -> Self {
        Self {
            session_id,
            loop_id,
            user_message: request.user_message,
            plan: request.plan,
            recent_session: Vec::new(),
            activation_query: None,
            query_embedding: None,
            activated_memory: ActivatedMemory::default(),
            assembled_context: None,
            latest_model_output: None,
            pending_tool_calls: Vec::new(),
            tool_results: Vec::new(),
            persisted_raw_ids: Vec::new(),
            tool_result_ids: Vec::new(),
            new_abstract_ids: Vec::new(),
            session_window_ids: Vec::new(),
            pushed_out_raw_ids: Vec::new(),
            assistant_message: None,
            iteration: 0,
            tool_rounds_completed: 0,
            model_invocations: 0,
            last_completed_node: None,
            last_effect_key: None,
        }
    }

    pub fn checkpoint(&self, current_node: String, status: LoopStatus) -> Result<LoopState> {
        Ok(LoopState {
            session_id: self.session_id,
            loop_id: self.loop_id,
            user_goal: self.user_message.clone(),
            plan: self.plan.clone(),
            current_node,
            iteration: self.iteration,
            tool_rounds_completed: self.tool_rounds_completed,
            model_invocations: self.model_invocations,
            status,
            last_completed_node: self.last_completed_node.clone(),
            last_effect_key: self.last_effect_key.clone(),
            recent_events: self.persisted_raw_ids.clone(),
            activated_raw: self
                .activated_memory
                .raw_nodes
                .iter()
                .map(|entry| entry.node.id)
                .collect(),
            activated_abstract: self
                .activated_memory
                .abstract_nodes
                .iter()
                .map(|entry| entry.node.id)
                .collect(),
            session_window: self.session_window_ids.clone(),
            pushed_out_raw: self.pushed_out_raw_ids.clone(),
            tool_result_ids: self.tool_result_ids.clone(),
            assistant_message: self.assistant_message.clone(),
            state_json: serde_json::to_value(self).map_err(|err| {
                EngineError::Storage(format!("failed to serialize loop checkpoint state: {err}"))
            })?,
        })
    }

    pub fn from_checkpoint(checkpoint: LoopState) -> Result<(Self, String, LoopStatus)> {
        let state: ExecutionState =
            serde_json::from_value(checkpoint.state_json).map_err(|err| {
                EngineError::Storage(format!(
                    "failed to deserialize loop checkpoint state: {err}"
                ))
            })?;
        Ok((state, checkpoint.current_node, checkpoint.status))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NodeOutcome {
    Continue,
    Branch(String),
    Finish,
    Pause,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeRuntimeClass {
    Standard,
    ToolExecution,
    Distillation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphRunResult {
    pub status: LoopStatus,
    pub completed_steps: u32,
    pub tool_rounds_completed: u32,
    pub last_node: Option<String>,
}

#[derive(Clone, Default)]
pub struct RunOptions {
    pub max_graph_steps: Option<u32>,
    pub max_tool_rounds: Option<u32>,
    pub node_timeout: Option<Duration>,
    pub tool_timeout: Option<Duration>,
    pub distillation_timeout: Option<Duration>,
    pub maintenance_batch_size: Option<usize>,
    pub cancellation_token: Option<CancellationToken>,
}

#[derive(Clone)]
pub struct ResolvedRunOptions {
    pub max_graph_steps: u32,
    pub max_tool_rounds: u32,
    pub node_timeout: Duration,
    pub tool_timeout: Duration,
    pub distillation_timeout: Duration,
    pub maintenance_batch_size: usize,
    pub cancellation_token: Option<CancellationToken>,
}

impl ResolvedRunOptions {
    pub fn from_config(config: &EngineConfig, options: RunOptions) -> Self {
        Self {
            max_graph_steps: options
                .max_graph_steps
                .unwrap_or(config.runtime.max_graph_steps),
            max_tool_rounds: options
                .max_tool_rounds
                .unwrap_or(config.runtime.max_tool_rounds),
            node_timeout: options
                .node_timeout
                .unwrap_or_else(|| config.runtime.node_timeout()),
            tool_timeout: options
                .tool_timeout
                .unwrap_or_else(|| config.runtime.tool_timeout()),
            distillation_timeout: options
                .distillation_timeout
                .unwrap_or_else(|| config.runtime.distillation_timeout()),
            maintenance_batch_size: options
                .maintenance_batch_size
                .unwrap_or(config.runtime.maintenance_batch_size),
            cancellation_token: options.cancellation_token,
        }
    }

    pub fn timeout_for_class(&self, class: NodeRuntimeClass) -> Duration {
        match class {
            NodeRuntimeClass::Standard => self.node_timeout,
            NodeRuntimeClass::ToolExecution => self.tool_timeout,
            NodeRuntimeClass::Distillation => self.distillation_timeout,
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancellation_token
            .as_ref()
            .map(CancellationToken::is_cancelled)
            .unwrap_or(false)
    }
}

#[async_trait]
pub trait GraphNode: Send + Sync {
    fn id(&self) -> &'static str;

    fn runtime_class(&self) -> NodeRuntimeClass {
        NodeRuntimeClass::Standard
    }

    async fn run(
        &self,
        state: &mut ExecutionState,
        config: &EngineConfig,
        deps: &EngineDeps,
        options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome>;
}

#[derive(Default)]
pub struct ExecutionGraph {
    start: String,
    nodes: HashMap<String, Arc<dyn GraphNode>>,
    edges: HashMap<(String, String), String>,
}

impl ExecutionGraph {
    pub fn new(start: impl Into<String>) -> Self {
        Self {
            start: start.into(),
            nodes: HashMap::new(),
            edges: HashMap::new(),
        }
    }

    pub fn add_node(&mut self, node: Arc<dyn GraphNode>) {
        self.nodes.insert(node.id().to_string(), node);
    }

    pub fn add_edge(
        &mut self,
        from: impl Into<String>,
        branch: impl Into<String>,
        to: impl Into<String>,
    ) {
        self.edges.insert((from.into(), branch.into()), to.into());
    }

    pub fn start_node(&self) -> &str {
        &self.start
    }

    fn resolve_next(&self, current_node: &str, outcome: &NodeOutcome) -> Result<Option<String>> {
        match outcome {
            NodeOutcome::Finish | NodeOutcome::Pause => Ok(None),
            NodeOutcome::Continue => self
                .edges
                .get(&(current_node.to_string(), DEFAULT_EDGE.to_string()))
                .cloned()
                .map(Some)
                .ok_or_else(|| {
                    EngineError::Configuration(format!(
                        "missing default edge from execution node {current_node}"
                    ))
                }),
            NodeOutcome::Branch(branch) => self
                .edges
                .get(&(current_node.to_string(), branch.clone()))
                .cloned()
                .map(Some)
                .ok_or_else(|| {
                    EngineError::Configuration(format!(
                        "missing branch edge {branch} from execution node {current_node}"
                    ))
                }),
        }
    }

    fn node(&self, id: &str) -> Result<&Arc<dyn GraphNode>> {
        self.nodes.get(id).ok_or_else(|| {
            EngineError::Configuration(format!("execution graph node {id} is not registered"))
        })
    }
}

pub struct GraphRunner {
    graph: Arc<ExecutionGraph>,
}

impl GraphRunner {
    pub fn new(graph: Arc<ExecutionGraph>) -> Self {
        Self { graph }
    }

    pub async fn run(
        &self,
        state: &mut ExecutionState,
        config: &EngineConfig,
        deps: &EngineDeps,
        options: &ResolvedRunOptions,
    ) -> Result<GraphRunResult> {
        self.run_from_node(
            self.graph.start_node().to_string(),
            state,
            config,
            deps,
            options,
        )
        .await
    }

    pub async fn resume(
        &self,
        checkpoint: LoopState,
        config: &EngineConfig,
        deps: &EngineDeps,
        options: &ResolvedRunOptions,
    ) -> Result<(ExecutionState, GraphRunResult)> {
        let (mut state, current_node, _status) = ExecutionState::from_checkpoint(checkpoint)?;
        let result = self
            .run_from_node(current_node, &mut state, config, deps, options)
            .await?;
        Ok((state, result))
    }

    async fn run_from_node(
        &self,
        mut current_node: String,
        state: &mut ExecutionState,
        config: &EngineConfig,
        deps: &EngineDeps,
        options: &ResolvedRunOptions,
    ) -> Result<GraphRunResult> {
        loop {
            if options.is_cancelled() {
                warn!(session_id = %state.session_id, loop_id = %state.loop_id, node = %current_node, "graph execution cancelled");
                let cancelled = state.checkpoint(current_node.clone(), LoopStatus::Cancelled)?;
                deps.loop_state_repository
                    .save_checkpoint(cancelled)
                    .await?;
                return Ok(GraphRunResult {
                    status: LoopStatus::Cancelled,
                    completed_steps: state.iteration,
                    tool_rounds_completed: state.tool_rounds_completed,
                    last_node: Some(current_node),
                });
            }

            if state.iteration >= options.max_graph_steps {
                warn!(session_id = %state.session_id, loop_id = %state.loop_id, node = %current_node, "graph execution hit max step budget");
                let timed_out = state.checkpoint(current_node.clone(), LoopStatus::TimedOut)?;
                deps.loop_state_repository
                    .save_checkpoint(timed_out)
                    .await?;
                return Ok(GraphRunResult {
                    status: LoopStatus::TimedOut,
                    completed_steps: state.iteration,
                    tool_rounds_completed: state.tool_rounds_completed,
                    last_node: Some(current_node),
                });
            }

            state.iteration = state.iteration.saturating_add(1);
            let running = state.checkpoint(current_node.clone(), LoopStatus::Running)?;
            deps.loop_state_repository.save_checkpoint(running).await?;

            let node = self.graph.node(&current_node)?.clone();
            debug!(
                session_id = %state.session_id,
                loop_id = %state.loop_id,
                node = %current_node,
                step = state.iteration,
                "running execution node"
            );
            let outcome = match timeout(
                options.timeout_for_class(node.runtime_class()),
                node.run(state, config, deps, options),
            )
            .await
            {
                Ok(Ok(outcome)) => outcome,
                Ok(Err(error)) => {
                    let failed = state.checkpoint(current_node.clone(), LoopStatus::Failed)?;
                    deps.loop_state_repository.save_checkpoint(failed).await?;
                    return Err(error);
                }
                Err(_) => {
                    warn!(
                        session_id = %state.session_id,
                        loop_id = %state.loop_id,
                        node = %current_node,
                        "execution node timed out"
                    );
                    let timed_out = state.checkpoint(current_node.clone(), LoopStatus::TimedOut)?;
                    deps.loop_state_repository
                        .save_checkpoint(timed_out)
                        .await?;
                    return Ok(GraphRunResult {
                        status: LoopStatus::TimedOut,
                        completed_steps: state.iteration,
                        tool_rounds_completed: state.tool_rounds_completed,
                        last_node: Some(current_node),
                    });
                }
            };

            state.last_completed_node = Some(current_node.clone());
            match outcome {
                NodeOutcome::Finish => {
                    info!(
                        session_id = %state.session_id,
                        loop_id = %state.loop_id,
                        steps = state.iteration,
                        tool_rounds = state.tool_rounds_completed,
                        "graph execution finished"
                    );
                    deps.loop_state_repository
                        .clear_checkpoint(&state.session_id, &state.loop_id)
                        .await?;
                    return Ok(GraphRunResult {
                        status: LoopStatus::Finished,
                        completed_steps: state.iteration,
                        tool_rounds_completed: state.tool_rounds_completed,
                        last_node: state.last_completed_node.clone(),
                    });
                }
                NodeOutcome::Pause => {
                    let paused = state.checkpoint(current_node.clone(), LoopStatus::Paused)?;
                    deps.loop_state_repository.save_checkpoint(paused).await?;
                    return Ok(GraphRunResult {
                        status: LoopStatus::Paused,
                        completed_steps: state.iteration,
                        tool_rounds_completed: state.tool_rounds_completed,
                        last_node: Some(current_node),
                    });
                }
                NodeOutcome::Continue | NodeOutcome::Branch(_) => {
                    let next_node = self
                        .graph
                        .resolve_next(&current_node, &outcome)?
                        .ok_or_else(|| {
                            EngineError::Configuration(format!(
                                "execution graph node {current_node} did not resolve to a next node"
                            ))
                        })?;
                    current_node = next_node;
                }
            }
        }
    }
}
