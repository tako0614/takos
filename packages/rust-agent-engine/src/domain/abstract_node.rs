use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::Relation;
use crate::ids::{AbstractNodeId, RawNodeId};
use crate::model::embedding::EmbeddingRef;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EntityRef {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct GraphFragment {
    pub entities: Vec<EntityRef>,
    pub relations: Vec<Relation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct References {
    pub abstract_node_ids: Vec<AbstractNodeId>,
    pub raw_node_ids: Vec<RawNodeId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AbstractNodeMetadata {
    pub abstraction_level: u8,
    pub confidence: f32,
    pub importance: f32,
    pub tags: Vec<String>,
}

impl Default for AbstractNodeMetadata {
    fn default() -> Self {
        Self {
            abstraction_level: 1,
            confidence: 0.5,
            importance: 0.5,
            tags: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AbstractNode {
    pub id: AbstractNodeId,
    pub operation_key: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub title: String,
    pub summary: String,
    pub embedding_ref: EmbeddingRef,
    pub graph: GraphFragment,
    pub references: References,
    pub metadata: AbstractNodeMetadata,
    pub version: u32,
}

impl AbstractNode {
    pub fn new(
        title: impl Into<String>,
        summary: impl Into<String>,
        references: References,
        graph: GraphFragment,
        metadata: AbstractNodeMetadata,
    ) -> Self {
        let id = AbstractNodeId::new();
        Self {
            id,
            operation_key: None,
            timestamp: Utc::now(),
            title: title.into(),
            summary: summary.into(),
            embedding_ref: EmbeddingRef::for_node("abstract", id.to_string()),
            graph,
            references,
            metadata,
            version: 1,
        }
    }

    pub fn context_text(&self) -> String {
        format!("{}: {}", self.title, self.summary)
    }

    pub fn with_operation_key(mut self, operation_key: impl Into<String>) -> Self {
        self.operation_key = Some(operation_key.into());
        self
    }
}
