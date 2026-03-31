use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::Result;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Embedding(pub Vec<f32>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct EmbeddingRef(pub String);

impl EmbeddingRef {
    pub fn for_node(prefix: &str, node_id: String) -> Self {
        Self(format!("{prefix}:{node_id}"))
    }
}

pub fn cosine_similarity(left: &Embedding, right: &Embedding) -> f32 {
    if left.0.len() != right.0.len() || left.0.is_empty() {
        return 0.0;
    }

    let dot = left
        .0
        .iter()
        .zip(right.0.iter())
        .map(|(a, b)| a * b)
        .sum::<f32>();
    let left_norm = left.0.iter().map(|v| v * v).sum::<f32>().sqrt();
    let right_norm = right.0.iter().map(|v| v * v).sum::<f32>().sqrt();

    if left_norm == 0.0 || right_norm == 0.0 {
        0.0
    } else {
        dot / (left_norm * right_norm)
    }
}

#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed_text(&self, text: &str) -> Result<Embedding>;
}
