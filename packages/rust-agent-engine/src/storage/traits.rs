use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::{AbstractNode, DistillationState, LoopState, OverflowPolicy, RawNode};
use crate::error::Result;
use crate::ids::{AbstractNodeId, LoopId, RawNodeId, SessionId};
use crate::model::embedding::Embedding;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoredRawRef {
    pub id: RawNodeId,
    pub score: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScoredAbstractRef {
    pub id: AbstractNodeId,
    pub score: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphTraversalHit {
    pub node_id: AbstractNodeId,
    pub depth: usize,
    pub via_predicate: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RawLifecyclePatch {
    pub distillation_state: Option<DistillationState>,
    pub overflow: Option<OverflowPolicy>,
}

#[async_trait]
pub trait NodeRepository: Send + Sync {
    async fn insert_raw(&self, node: RawNode) -> Result<()>;
    async fn insert_abstract(&self, node: AbstractNode) -> Result<()>;
    async fn get_raw(&self, id: &RawNodeId) -> Result<Option<RawNode>>;
    async fn get_abstract(&self, id: &AbstractNodeId) -> Result<Option<AbstractNode>>;
    async fn get_raw_by_operation_key(&self, operation_key: &str) -> Result<Option<RawNode>>;
    async fn get_abstract_by_operation_key(
        &self,
        operation_key: &str,
    ) -> Result<Option<AbstractNode>>;
    async fn list_raw(&self, ids: &[RawNodeId]) -> Result<Vec<RawNode>>;
    async fn list_abstract(&self, ids: &[AbstractNodeId]) -> Result<Vec<AbstractNode>>;
    async fn recent_session_raw(
        &self,
        session_id: &SessionId,
        limit: usize,
    ) -> Result<Vec<RawNode>>;
    async fn session_raw(&self, session_id: &SessionId) -> Result<Vec<RawNode>>;
    async fn raw_for_loop(&self, loop_id: &LoopId) -> Result<Vec<RawNode>>;
    async fn timeline_raw(
        &self,
        session_id: Option<&SessionId>,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<RawNode>>;
    async fn update_raw_lifecycle(
        &self,
        ids: &[RawNodeId],
        patch: &RawLifecyclePatch,
    ) -> Result<()>;
    async fn undistilled_raw(&self, limit: usize, only_pushed_out: bool) -> Result<Vec<RawNode>>;
}

#[async_trait]
pub trait VectorIndex: Send + Sync {
    async fn index_raw(&self, id: RawNodeId, embedding: Embedding) -> Result<()>;
    async fn index_abstract(&self, id: AbstractNodeId, embedding: Embedding) -> Result<()>;
    async fn search_raw(&self, query: &Embedding, top_k: usize) -> Result<Vec<ScoredRawRef>>;
    async fn search_abstract(
        &self,
        query: &Embedding,
        top_k: usize,
    ) -> Result<Vec<ScoredAbstractRef>>;
}

#[async_trait]
pub trait GraphRepository: Send + Sync {
    async fn index_abstract(&self, node: &AbstractNode) -> Result<()>;
    async fn traverse(
        &self,
        start: &AbstractNodeId,
        max_depth: usize,
        relation_types: Option<&[String]>,
    ) -> Result<Vec<GraphTraversalHit>>;
}

#[async_trait]
pub trait LoopStateRepository: Send + Sync {
    async fn save_checkpoint(&self, state: LoopState) -> Result<()>;
    async fn load_checkpoint(
        &self,
        session_id: &SessionId,
        loop_id: &LoopId,
    ) -> Result<Option<LoopState>>;
    async fn clear_checkpoint(&self, session_id: &SessionId, loop_id: &LoopId) -> Result<()>;
}
