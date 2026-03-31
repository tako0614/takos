use std::str::FromStr;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::{AbstractNode, RawNode};
use crate::error::{EngineError, Result};
use crate::ids::{AbstractNodeId, SessionId};
use crate::model::{Embedder, Embedding};
use crate::storage::{GraphRepository, NodeRepository, VectorIndex};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemorySearchTarget {
    Raw,
    Abstract,
    Both,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySearchParams {
    pub query: String,
    #[serde(default = "default_memory_search_target")]
    pub target: MemorySearchTarget,
    #[serde(default = "default_memory_search_top_k")]
    pub top_k: usize,
    pub threshold: Option<f32>,
}

fn default_memory_search_target() -> MemorySearchTarget {
    MemorySearchTarget::Both
}

fn default_memory_search_top_k() -> usize {
    8
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSearchParams {
    pub start_node_id: String,
    #[serde(default = "default_graph_depth")]
    pub max_depth: usize,
    pub relation_types: Option<Vec<String>>,
}

fn default_graph_depth() -> usize {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceLookupParams {
    pub abstract_node_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineSearchParams {
    pub session_id: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    #[serde(default = "default_timeline_limit")]
    pub limit: usize,
}

fn default_timeline_limit() -> usize {
    10
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredRawHit {
    pub node: RawNode,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoredAbstractHit {
    pub node: AbstractNode,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySearchResult {
    pub raw_hits: Vec<ScoredRawHit>,
    pub abstract_hits: Vec<ScoredAbstractHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSearchHit {
    pub node: AbstractNode,
    pub depth: usize,
    pub via_predicate: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphSearchResult {
    pub hits: Vec<GraphSearchHit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvenanceLookupResult {
    pub abstract_node: AbstractNode,
    pub raw_nodes: Vec<RawNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineSearchResult {
    pub raw_nodes: Vec<RawNode>,
}

pub struct MemoryTools {
    repository: Arc<dyn NodeRepository>,
    vector_index: Arc<dyn VectorIndex>,
    graph_repository: Arc<dyn GraphRepository>,
    embedder: Arc<dyn Embedder>,
}

impl MemoryTools {
    pub fn new(
        repository: Arc<dyn NodeRepository>,
        vector_index: Arc<dyn VectorIndex>,
        graph_repository: Arc<dyn GraphRepository>,
        embedder: Arc<dyn Embedder>,
    ) -> Self {
        Self {
            repository,
            vector_index,
            graph_repository,
            embedder,
        }
    }

    pub async fn semantic_search(&self, params: MemorySearchParams) -> Result<MemorySearchResult> {
        let top_k = params.top_k.max(1);
        let query_embedding = self.embedder.embed_text(&params.query).await?;
        let threshold = params.threshold.unwrap_or(0.0);

        let raw_hits = if matches!(
            params.target,
            MemorySearchTarget::Raw | MemorySearchTarget::Both
        ) {
            self.search_raw(&query_embedding, top_k, threshold).await?
        } else {
            Vec::new()
        };

        let abstract_hits = if matches!(
            params.target,
            MemorySearchTarget::Abstract | MemorySearchTarget::Both
        ) {
            self.search_abstract(&query_embedding, top_k, threshold)
                .await?
        } else {
            Vec::new()
        };

        Ok(MemorySearchResult {
            raw_hits,
            abstract_hits,
        })
    }

    pub async fn graph_search(&self, params: GraphSearchParams) -> Result<GraphSearchResult> {
        let start = AbstractNodeId::from_str(&params.start_node_id)
            .map_err(|err| EngineError::Tool(format!("invalid abstract node id: {err}")))?;
        let hits = self
            .graph_repository
            .traverse(&start, params.max_depth, params.relation_types.as_deref())
            .await?;

        let ids: Vec<_> = hits.iter().map(|hit| hit.node_id).collect();
        let mut nodes_by_id = self
            .repository
            .list_abstract(&ids)
            .await?
            .into_iter()
            .map(|node| (node.id, node))
            .collect::<std::collections::HashMap<_, _>>();

        let mut ordered_hits = Vec::new();
        for hit in hits {
            if let Some(node) = nodes_by_id.remove(&hit.node_id) {
                ordered_hits.push(GraphSearchHit {
                    node,
                    depth: hit.depth,
                    via_predicate: hit.via_predicate,
                });
            }
        }

        Ok(GraphSearchResult { hits: ordered_hits })
    }

    pub async fn provenance_lookup(
        &self,
        params: ProvenanceLookupParams,
    ) -> Result<ProvenanceLookupResult> {
        let node_id = AbstractNodeId::from_str(&params.abstract_node_id)
            .map_err(|err| EngineError::Tool(format!("invalid abstract node id: {err}")))?;
        let abstract_node = self
            .repository
            .get_abstract(&node_id)
            .await?
            .ok_or_else(|| EngineError::Tool("abstract node not found".to_string()))?;
        let raw_nodes = self
            .repository
            .list_raw(&abstract_node.references.raw_node_ids)
            .await?;
        Ok(ProvenanceLookupResult {
            abstract_node,
            raw_nodes,
        })
    }

    pub async fn timeline_search(
        &self,
        params: TimelineSearchParams,
    ) -> Result<TimelineSearchResult> {
        let session_id = params
            .session_id
            .as_deref()
            .map(SessionId::from_str)
            .transpose()
            .map_err(|err| EngineError::Tool(format!("invalid session id: {err}")))?;
        let raw_nodes = self
            .repository
            .timeline_raw(
                session_id.as_ref(),
                params.from,
                params.to,
                params.limit.max(1),
            )
            .await?;
        Ok(TimelineSearchResult { raw_nodes })
    }

    async fn search_raw(
        &self,
        query_embedding: &Embedding,
        top_k: usize,
        threshold: f32,
    ) -> Result<Vec<ScoredRawHit>> {
        let refs = self.vector_index.search_raw(query_embedding, top_k).await?;
        let mut hits = Vec::new();
        for candidate in refs {
            if candidate.score < threshold {
                continue;
            }
            if let Some(node) = self.repository.get_raw(&candidate.id).await? {
                hits.push(ScoredRawHit {
                    node,
                    score: candidate.score,
                });
            }
        }
        Ok(hits)
    }

    async fn search_abstract(
        &self,
        query_embedding: &Embedding,
        top_k: usize,
        threshold: f32,
    ) -> Result<Vec<ScoredAbstractHit>> {
        let refs = self
            .vector_index
            .search_abstract(query_embedding, top_k)
            .await?;
        let mut hits = Vec::new();
        for candidate in refs {
            if candidate.score < threshold {
                continue;
            }
            if let Some(node) = self.repository.get_abstract(&candidate.id).await? {
                hits.push(ScoredAbstractHit {
                    node,
                    score: candidate.score,
                });
            }
        }
        Ok(hits)
    }
}
