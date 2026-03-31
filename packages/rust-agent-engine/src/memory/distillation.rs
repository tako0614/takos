use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::domain::{AbstractNode, RawNode};
use crate::error::Result;
use crate::ids::{AbstractNodeId, LoopId, RawNodeId, SessionId};
use crate::storage::RawLifecyclePatch;

#[derive(Debug, Clone)]
pub struct DistillationInput {
    pub session_id: SessionId,
    pub loop_id: LoopId,
    pub raw_nodes: Vec<RawNode>,
    pub activated_abstract_ids: Vec<AbstractNodeId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RawLifecycleUpdate {
    pub raw_node_id: RawNodeId,
    pub patch: RawLifecyclePatch,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct DistillationOutput {
    pub new_nodes: Vec<AbstractNode>,
    pub raw_updates: Vec<RawLifecycleUpdate>,
}

#[async_trait]
pub trait Distiller: Send + Sync {
    async fn distill(&self, input: DistillationInput) -> Result<DistillationOutput>;
}
