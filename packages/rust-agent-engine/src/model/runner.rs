use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::ids::{LoopId, SessionId};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCallRequest {
    pub name: String,
    #[serde(default)]
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct ModelInput {
    pub session_id: SessionId,
    pub loop_id: LoopId,
    pub system_prompt: String,
    pub session_context: Vec<String>,
    pub memory_context: Vec<String>,
    pub tool_context: Vec<String>,
    pub user_message: String,
    pub plan: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelOutput {
    pub assistant_message: Option<String>,
    pub tool_calls: Vec<ToolCallRequest>,
}

#[async_trait]
pub trait ModelRunner: Send + Sync {
    async fn run(&self, input: ModelInput) -> Result<ModelOutput>;
}
