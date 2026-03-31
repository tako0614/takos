use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::{EngineError, Result};
use crate::model::runner::ToolCallRequest;

use super::memory_tools::{
    GraphSearchParams, MemorySearchParams, MemoryTools, ProvenanceLookupParams,
    TimelineSearchParams,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub name: String,
    pub content: serde_json::Value,
    pub summary: String,
}

#[async_trait]
pub trait ToolExecutor: Send + Sync {
    async fn execute(&self, call: ToolCallRequest) -> Result<ToolCallResult>;
}

pub struct DefaultToolExecutor {
    memory_tools: MemoryTools,
}

impl DefaultToolExecutor {
    pub fn new(memory_tools: MemoryTools) -> Self {
        Self { memory_tools }
    }
}

#[async_trait]
impl ToolExecutor for DefaultToolExecutor {
    async fn execute(&self, call: ToolCallRequest) -> Result<ToolCallResult> {
        match call.name.as_str() {
            "semantic_search_memory" => {
                let params: MemorySearchParams =
                    serde_json::from_value(call.arguments).map_err(|err| {
                        EngineError::Tool(format!("invalid semantic search args: {err}"))
                    })?;
                let result = self.memory_tools.semantic_search(params).await?;
                let summary = format!(
                    "semantic_search_memory raw_hits={} abstract_hits={}",
                    result.raw_hits.len(),
                    result.abstract_hits.len()
                );
                Ok(ToolCallResult {
                    name: call.name,
                    content: serde_json::to_value(&result).map_err(|err| {
                        EngineError::Tool(format!("failed to serialize result: {err}"))
                    })?,
                    summary,
                })
            }
            "graph_search_memory" => {
                let params: GraphSearchParams =
                    serde_json::from_value(call.arguments).map_err(|err| {
                        EngineError::Tool(format!("invalid graph search args: {err}"))
                    })?;
                let result = self.memory_tools.graph_search(params).await?;
                let summary = format!("graph_search_memory hits={}", result.hits.len());
                Ok(ToolCallResult {
                    name: call.name,
                    content: serde_json::to_value(&result).map_err(|err| {
                        EngineError::Tool(format!("failed to serialize result: {err}"))
                    })?,
                    summary,
                })
            }
            "provenance_lookup" => {
                let params: ProvenanceLookupParams = serde_json::from_value(call.arguments)
                    .map_err(|err| EngineError::Tool(format!("invalid provenance args: {err}")))?;
                let result = self.memory_tools.provenance_lookup(params).await?;
                let summary = format!("provenance_lookup raw_nodes={}", result.raw_nodes.len());
                Ok(ToolCallResult {
                    name: call.name,
                    content: serde_json::to_value(&result).map_err(|err| {
                        EngineError::Tool(format!("failed to serialize result: {err}"))
                    })?,
                    summary,
                })
            }
            "timeline_search" => {
                let params: TimelineSearchParams = serde_json::from_value(call.arguments)
                    .map_err(|err| EngineError::Tool(format!("invalid timeline args: {err}")))?;
                let result = self.memory_tools.timeline_search(params).await?;
                let summary = format!("timeline_search raw_nodes={}", result.raw_nodes.len());
                Ok(ToolCallResult {
                    name: call.name,
                    content: serde_json::to_value(&result).map_err(|err| {
                        EngineError::Tool(format!("failed to serialize result: {err}"))
                    })?,
                    summary,
                })
            }
            other => Err(EngineError::Tool(format!("unknown tool: {other}"))),
        }
    }
}
