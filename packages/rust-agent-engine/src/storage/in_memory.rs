use std::collections::HashMap;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use tokio::sync::RwLock;

use crate::domain::{AbstractNode, DistillationState, LoopState, RawNode};
use crate::error::Result;
use crate::ids::{AbstractNodeId, LoopId, RawNodeId, SessionId};

use super::traits::{LoopStateRepository, NodeRepository, RawLifecyclePatch};

#[derive(Debug, Default)]
pub struct InMemoryNodeRepository {
    raw_nodes: RwLock<HashMap<RawNodeId, RawNode>>,
    abstract_nodes: RwLock<HashMap<AbstractNodeId, AbstractNode>>,
    session_index: RwLock<HashMap<SessionId, Vec<RawNodeId>>>,
    loop_index: RwLock<HashMap<LoopId, Vec<RawNodeId>>>,
    raw_operation_index: RwLock<HashMap<String, RawNodeId>>,
    abstract_operation_index: RwLock<HashMap<String, AbstractNodeId>>,
}

#[async_trait]
impl NodeRepository for InMemoryNodeRepository {
    async fn insert_raw(&self, node: RawNode) -> Result<()> {
        if let Some(session_id) = node.session_id {
            let mut session_index = self.session_index.write().await;
            session_index.entry(session_id).or_default().push(node.id);
        }
        if let Some(loop_id) = node.loop_id {
            let mut loop_index = self.loop_index.write().await;
            loop_index.entry(loop_id).or_default().push(node.id);
        }
        if let Some(operation_key) = &node.operation_key {
            self.raw_operation_index
                .write()
                .await
                .insert(operation_key.clone(), node.id);
        }
        self.raw_nodes.write().await.insert(node.id, node);
        Ok(())
    }

    async fn insert_abstract(&self, node: AbstractNode) -> Result<()> {
        if let Some(operation_key) = &node.operation_key {
            self.abstract_operation_index
                .write()
                .await
                .insert(operation_key.clone(), node.id);
        }
        self.abstract_nodes.write().await.insert(node.id, node);
        Ok(())
    }

    async fn get_raw(&self, id: &RawNodeId) -> Result<Option<RawNode>> {
        Ok(self.raw_nodes.read().await.get(id).cloned())
    }

    async fn get_abstract(&self, id: &AbstractNodeId) -> Result<Option<AbstractNode>> {
        Ok(self.abstract_nodes.read().await.get(id).cloned())
    }

    async fn get_raw_by_operation_key(&self, operation_key: &str) -> Result<Option<RawNode>> {
        let raw_id = self
            .raw_operation_index
            .read()
            .await
            .get(operation_key)
            .copied();
        match raw_id {
            Some(raw_id) => self.get_raw(&raw_id).await,
            None => Ok(None),
        }
    }

    async fn get_abstract_by_operation_key(
        &self,
        operation_key: &str,
    ) -> Result<Option<AbstractNode>> {
        let abstract_id = self
            .abstract_operation_index
            .read()
            .await
            .get(operation_key)
            .copied();
        match abstract_id {
            Some(abstract_id) => self.get_abstract(&abstract_id).await,
            None => Ok(None),
        }
    }

    async fn list_raw(&self, ids: &[RawNodeId]) -> Result<Vec<RawNode>> {
        let guard = self.raw_nodes.read().await;
        Ok(ids.iter().filter_map(|id| guard.get(id).cloned()).collect())
    }

    async fn list_abstract(&self, ids: &[AbstractNodeId]) -> Result<Vec<AbstractNode>> {
        let guard = self.abstract_nodes.read().await;
        Ok(ids.iter().filter_map(|id| guard.get(id).cloned()).collect())
    }

    async fn recent_session_raw(
        &self,
        session_id: &SessionId,
        limit: usize,
    ) -> Result<Vec<RawNode>> {
        let mut nodes = self.session_raw(session_id).await?;
        nodes.reverse();
        nodes.truncate(limit);
        nodes.reverse();
        Ok(nodes)
    }

    async fn session_raw(&self, session_id: &SessionId) -> Result<Vec<RawNode>> {
        let ids = {
            let index = self.session_index.read().await;
            index.get(session_id).cloned().unwrap_or_default()
        };
        let guard = self.raw_nodes.read().await;
        let mut nodes: Vec<_> = ids.iter().filter_map(|id| guard.get(id).cloned()).collect();
        nodes.sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
        Ok(nodes)
    }

    async fn raw_for_loop(&self, loop_id: &LoopId) -> Result<Vec<RawNode>> {
        let ids = {
            let index = self.loop_index.read().await;
            index.get(loop_id).cloned().unwrap_or_default()
        };
        let guard = self.raw_nodes.read().await;
        let mut nodes: Vec<_> = ids.iter().filter_map(|id| guard.get(id).cloned()).collect();
        nodes.sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
        Ok(nodes)
    }

    async fn timeline_raw(
        &self,
        session_id: Option<&SessionId>,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<RawNode>> {
        let mut nodes: Vec<_> = if let Some(session_id) = session_id {
            self.session_raw(session_id).await?
        } else {
            self.raw_nodes.read().await.values().cloned().collect()
        };
        nodes.retain(|node| {
            let lower_ok = from.map(|value| node.timestamp >= value).unwrap_or(true);
            let upper_ok = to.map(|value| node.timestamp <= value).unwrap_or(true);
            lower_ok && upper_ok
        });
        nodes.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
        nodes.truncate(limit);
        Ok(nodes)
    }

    async fn update_raw_lifecycle(
        &self,
        ids: &[RawNodeId],
        patch: &RawLifecyclePatch,
    ) -> Result<()> {
        let mut guard = self.raw_nodes.write().await;
        for id in ids {
            if let Some(node) = guard.get_mut(id) {
                if let Some(distillation_state) = &patch.distillation_state {
                    node.distillation_state = distillation_state.clone();
                }
                if let Some(overflow) = &patch.overflow {
                    node.overflow = overflow.clone();
                }
            }
        }
        Ok(())
    }

    async fn undistilled_raw(&self, limit: usize, only_pushed_out: bool) -> Result<Vec<RawNode>> {
        let mut nodes: Vec<_> = self
            .raw_nodes
            .read()
            .await
            .values()
            .filter(|node| node.distillation_state != DistillationState::Distilled)
            .filter(|node| !only_pushed_out || node.overflow.was_pushed_out_of_session)
            .cloned()
            .collect();
        nodes.sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
        nodes.truncate(limit);
        Ok(nodes)
    }
}

#[derive(Debug, Default)]
pub struct InMemoryLoopStateRepository {
    checkpoints: RwLock<HashMap<(SessionId, LoopId), LoopState>>,
}

#[async_trait]
impl LoopStateRepository for InMemoryLoopStateRepository {
    async fn save_checkpoint(&self, state: LoopState) -> Result<()> {
        self.checkpoints
            .write()
            .await
            .insert((state.session_id, state.loop_id), state);
        Ok(())
    }

    async fn load_checkpoint(
        &self,
        session_id: &SessionId,
        loop_id: &LoopId,
    ) -> Result<Option<LoopState>> {
        Ok(self
            .checkpoints
            .read()
            .await
            .get(&(*session_id, *loop_id))
            .cloned())
    }

    async fn clear_checkpoint(&self, session_id: &SessionId, loop_id: &LoopId) -> Result<()> {
        self.checkpoints
            .write()
            .await
            .remove(&(*session_id, *loop_id));
        Ok(())
    }
}
