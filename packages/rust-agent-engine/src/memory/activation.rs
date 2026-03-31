use std::cmp::Ordering;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::config::EngineConfig;
use crate::domain::{AbstractNode, DistillationState, RawNode};
use crate::error::Result;
use crate::model::embedding::Embedding;
use crate::storage::{NodeRepository, VectorIndex};

use super::scoring::ScoringPolicy;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RankedRawNode {
    pub node: RawNode,
    pub score: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RankedAbstractNode {
    pub node: AbstractNode,
    pub score: f32,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct ActivatedMemory {
    pub raw_nodes: Vec<RankedRawNode>,
    pub abstract_nodes: Vec<RankedAbstractNode>,
}

pub struct ActivationService {
    repository: Arc<dyn NodeRepository>,
    vector_index: Arc<dyn VectorIndex>,
    scoring_policy: Arc<dyn ScoringPolicy>,
}

impl ActivationService {
    pub fn new(
        repository: Arc<dyn NodeRepository>,
        vector_index: Arc<dyn VectorIndex>,
        scoring_policy: Arc<dyn ScoringPolicy>,
    ) -> Self {
        Self {
            repository,
            vector_index,
            scoring_policy,
        }
    }

    pub async fn activate(
        &self,
        config: &EngineConfig,
        query_embedding: &Embedding,
        now: DateTime<Utc>,
    ) -> Result<ActivatedMemory> {
        let raw_ratio = config.memory.activation.target_ratio.raw.max(1);
        let abstract_ratio = config.memory.activation.target_ratio.abstract_nodes.max(1);
        let total_ratio = raw_ratio + abstract_ratio;
        let top_k_total = config.memory.activation.top_k_total.max(2);
        let raw_budget = ((top_k_total * raw_ratio) / total_ratio).max(1);
        let abstract_budget = top_k_total.saturating_sub(raw_budget).max(1);
        let search_window = top_k_total * 2;

        let raw_candidates = self
            .vector_index
            .search_raw(query_embedding, search_window)
            .await?;
        let mut raw_nodes = Vec::new();
        for candidate in raw_candidates {
            if let Some(node) = self.repository.get_raw(&candidate.id).await? {
                let threshold = if node.overflow.was_pushed_out_of_session
                    && node.distillation_state != DistillationState::Distilled
                {
                    config.memory.retrieval.relaxed_threshold_for_pushed_raw
                } else {
                    config.memory.retrieval.similarity_threshold.raw
                };
                if candidate.score < threshold {
                    continue;
                }
                raw_nodes.push(RankedRawNode {
                    score: self.scoring_policy.score_raw(candidate.score, &node, now),
                    node,
                });
            }
        }
        raw_nodes.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
        });
        raw_nodes.truncate(raw_budget);

        let abstract_candidates = self
            .vector_index
            .search_abstract(query_embedding, search_window)
            .await?;
        let mut abstract_nodes = Vec::new();
        for candidate in abstract_candidates {
            if let Some(node) = self.repository.get_abstract(&candidate.id).await? {
                if candidate.score < config.memory.retrieval.similarity_threshold.abstract_nodes {
                    continue;
                }
                abstract_nodes.push(RankedAbstractNode {
                    score: self
                        .scoring_policy
                        .score_abstract(candidate.score, &node, now),
                    node,
                });
            }
        }
        abstract_nodes.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
        });
        abstract_nodes.truncate(abstract_budget);

        Ok(ActivatedMemory {
            raw_nodes,
            abstract_nodes,
        })
    }
}
