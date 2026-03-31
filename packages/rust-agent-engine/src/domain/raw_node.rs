use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::{LoopId, RawNodeId, SessionId};
use crate::model::embedding::EmbeddingRef;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RawNodeKind {
    UserUtterance,
    AssistantUtterance,
    ToolResult,
    Note,
    Event,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum RawContent {
    Text(String),
    Json(serde_json::Value),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Normal,
    Hidden,
    Internal,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DistillationState {
    Undistilled,
    Distilled,
    PartiallyDistilled,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct OverflowPolicy {
    pub was_pushed_out_of_session: bool,
    pub relax_retrieval_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RawNodeMetadata {
    pub source: String,
    pub tags: Vec<String>,
    pub importance: f32,
    pub visibility: Visibility,
}

impl Default for RawNodeMetadata {
    fn default() -> Self {
        Self {
            source: "system".to_string(),
            tags: Vec::new(),
            importance: 0.5,
            visibility: Visibility::Normal,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RawNode {
    pub id: RawNodeId,
    pub operation_key: Option<String>,
    pub session_id: Option<SessionId>,
    pub loop_id: Option<LoopId>,
    pub timestamp: DateTime<Utc>,
    pub kind: RawNodeKind,
    pub content: RawContent,
    pub embedding_ref: EmbeddingRef,
    pub metadata: RawNodeMetadata,
    pub distillation_state: DistillationState,
    pub overflow: OverflowPolicy,
}

impl RawNode {
    pub fn text(
        kind: RawNodeKind,
        session_id: Option<SessionId>,
        loop_id: Option<LoopId>,
        source: impl Into<String>,
        text: impl Into<String>,
        importance: f32,
        tags: Vec<String>,
    ) -> Self {
        let id = RawNodeId::new();
        Self {
            id,
            operation_key: None,
            session_id,
            loop_id,
            timestamp: Utc::now(),
            kind,
            content: RawContent::Text(text.into()),
            embedding_ref: EmbeddingRef::for_node("raw", id.to_string()),
            metadata: RawNodeMetadata {
                source: source.into(),
                tags,
                importance,
                visibility: Visibility::Normal,
            },
            distillation_state: DistillationState::Undistilled,
            overflow: OverflowPolicy::default(),
        }
    }

    pub fn json(
        kind: RawNodeKind,
        session_id: Option<SessionId>,
        loop_id: Option<LoopId>,
        source: impl Into<String>,
        value: serde_json::Value,
        importance: f32,
        tags: Vec<String>,
    ) -> Self {
        let id = RawNodeId::new();
        Self {
            id,
            operation_key: None,
            session_id,
            loop_id,
            timestamp: Utc::now(),
            kind,
            content: RawContent::Json(value),
            embedding_ref: EmbeddingRef::for_node("raw", id.to_string()),
            metadata: RawNodeMetadata {
                source: source.into(),
                tags,
                importance,
                visibility: Visibility::Normal,
            },
            distillation_state: DistillationState::Undistilled,
            overflow: OverflowPolicy::default(),
        }
    }

    pub fn content_text(&self) -> String {
        match &self.content {
            RawContent::Text(text) => text.clone(),
            RawContent::Json(value) => value.to_string(),
        }
    }

    pub fn with_operation_key(mut self, operation_key: impl Into<String>) -> Self {
        self.operation_key = Some(operation_key.into());
        self
    }

    pub fn context_text(&self) -> String {
        format!("{:?}: {}", self.kind, self.content_text())
    }
}
