use std::cmp::Ordering;
use std::collections::HashMap;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::error::Result;
use crate::ids::{AbstractNodeId, RawNodeId};
use crate::model::embedding::{cosine_similarity, Embedding};
use crate::storage::traits::{ScoredAbstractRef, ScoredRawRef, VectorIndex};

#[derive(Debug, Default)]
pub struct InMemoryVectorIndex {
    raw_embeddings: RwLock<HashMap<RawNodeId, Embedding>>,
    abstract_embeddings: RwLock<HashMap<AbstractNodeId, Embedding>>,
}

#[async_trait]
impl VectorIndex for InMemoryVectorIndex {
    async fn index_raw(&self, id: RawNodeId, embedding: Embedding) -> Result<()> {
        self.raw_embeddings.write().await.insert(id, embedding);
        Ok(())
    }

    async fn index_abstract(&self, id: AbstractNodeId, embedding: Embedding) -> Result<()> {
        self.abstract_embeddings.write().await.insert(id, embedding);
        Ok(())
    }

    async fn search_raw(&self, query: &Embedding, top_k: usize) -> Result<Vec<ScoredRawRef>> {
        let guard = self.raw_embeddings.read().await;
        let mut scored: Vec<_> = guard
            .iter()
            .map(|(id, embedding)| ScoredRawRef {
                id: *id,
                score: cosine_similarity(query, embedding),
            })
            .collect();
        scored.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.id.to_string().cmp(&right.id.to_string()))
        });
        scored.truncate(top_k);
        Ok(scored)
    }

    async fn search_abstract(
        &self,
        query: &Embedding,
        top_k: usize,
    ) -> Result<Vec<ScoredAbstractRef>> {
        let guard = self.abstract_embeddings.read().await;
        let mut scored: Vec<_> = guard
            .iter()
            .map(|(id, embedding)| ScoredAbstractRef {
                id: *id,
                score: cosine_similarity(query, embedding),
            })
            .collect();
        scored.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.id.to_string().cmp(&right.id.to_string()))
        });
        scored.truncate(top_k);
        Ok(scored)
    }
}
