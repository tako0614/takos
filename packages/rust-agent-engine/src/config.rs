use std::fs;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{EngineError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub system_prompt: String,
    pub memory: MemoryConfig,
    pub context_budget: ContextBudgetConfig,
    pub tools: ToolsConfig,
    pub runtime: RuntimeConfig,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            system_prompt: "You are the Rust-based Takos agent engine.".to_string(),
            memory: MemoryConfig::default(),
            context_budget: ContextBudgetConfig::default(),
            tools: ToolsConfig::default(),
            runtime: RuntimeConfig::default(),
        }
    }
}

impl EngineConfig {
    pub fn validate(&self) -> Result<()> {
        if self.system_prompt.trim().is_empty() {
            return Err(EngineError::Configuration(
                "system_prompt must not be empty".to_string(),
            ));
        }
        let split = self.context_budget.session_ratio + self.context_budget.memory_ratio;
        if !(0.0..=1.0).contains(&self.context_budget.session_ratio) {
            return Err(EngineError::Configuration(
                "context_budget.session_ratio must be between 0 and 1".to_string(),
            ));
        }
        if !(0.0..=1.0).contains(&self.context_budget.memory_ratio) {
            return Err(EngineError::Configuration(
                "context_budget.memory_ratio must be between 0 and 1".to_string(),
            ));
        }
        if (split - 1.0).abs() > 0.001 {
            return Err(EngineError::Configuration(
                "context_budget.session_ratio + memory_ratio must equal 1".to_string(),
            ));
        }
        if self.memory.activation.top_k_total == 0 {
            return Err(EngineError::Configuration(
                "memory.activation.top_k_total must be greater than 0".to_string(),
            ));
        }
        if self.runtime.max_graph_steps == 0 {
            return Err(EngineError::Configuration(
                "runtime.max_graph_steps must be greater than 0".to_string(),
            ));
        }
        if self.runtime.max_tool_rounds == 0 {
            return Err(EngineError::Configuration(
                "runtime.max_tool_rounds must be greater than 0".to_string(),
            ));
        }
        if self.runtime.maintenance_batch_size == 0 {
            return Err(EngineError::Configuration(
                "runtime.maintenance_batch_size must be greater than 0".to_string(),
            ));
        }
        Ok(())
    }

    pub fn from_toml_str(source: &str) -> Result<Self> {
        let config: Self = toml::from_str(source).map_err(|err| {
            EngineError::Configuration(format!("failed to parse engine config from TOML: {err}"))
        })?;
        config.validate()?;
        Ok(config)
    }

    pub fn from_toml_path(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let contents = fs::read_to_string(path).map_err(|err| {
            EngineError::Configuration(format!(
                "failed to read engine config {}: {err}",
                path.display()
            ))
        })?;
        Self::from_toml_str(&contents)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MemoryConfig {
    pub activation: ActivationConfig,
    pub retrieval: RetrievalConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationConfig {
    pub target_ratio: ActivationTargetRatio,
    pub top_k_total: usize,
    pub use_time_decay: bool,
    pub overflow_raw_threshold_relaxation: bool,
}

impl Default for ActivationConfig {
    fn default() -> Self {
        Self {
            target_ratio: ActivationTargetRatio::default(),
            top_k_total: 20,
            use_time_decay: true,
            overflow_raw_threshold_relaxation: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivationTargetRatio {
    pub raw: usize,
    #[serde(rename = "abstract")]
    pub abstract_nodes: usize,
}

impl Default for ActivationTargetRatio {
    fn default() -> Self {
        Self {
            raw: 1,
            abstract_nodes: 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalConfig {
    pub similarity_threshold: SimilarityThresholdConfig,
    pub relaxed_threshold_for_pushed_raw: f32,
}

impl Default for RetrievalConfig {
    fn default() -> Self {
        Self {
            similarity_threshold: SimilarityThresholdConfig::default(),
            relaxed_threshold_for_pushed_raw: 0.63,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimilarityThresholdConfig {
    pub raw: f32,
    #[serde(rename = "abstract")]
    pub abstract_nodes: f32,
}

impl Default for SimilarityThresholdConfig {
    fn default() -> Self {
        Self {
            raw: 0.72,
            abstract_nodes: 0.74,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextBudgetConfig {
    pub total_tokens: usize,
    pub reserve_system: usize,
    pub reserve_tools: usize,
    pub reserve_working: usize,
    pub session_ratio: f32,
    pub memory_ratio: f32,
}

impl Default for ContextBudgetConfig {
    fn default() -> Self {
        Self {
            total_tokens: 64_000,
            reserve_system: 4_000,
            reserve_tools: 12_000,
            reserve_working: 8_000,
            session_ratio: 0.5,
            memory_ratio: 0.5,
        }
    }
}

impl ContextBudgetConfig {
    pub fn remaining_tokens(&self) -> usize {
        self.total_tokens
            .saturating_sub(self.reserve_system)
            .saturating_sub(self.reserve_tools)
            .saturating_sub(self.reserve_working)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolsConfig {
    pub memory_search: bool,
    pub graph_search: bool,
    pub provenance_lookup: bool,
    pub timeline_search: bool,
}

impl Default for ToolsConfig {
    fn default() -> Self {
        Self {
            memory_search: true,
            graph_search: true,
            provenance_lookup: true,
            timeline_search: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub max_graph_steps: u32,
    pub max_tool_rounds: u32,
    pub node_timeout_ms: u64,
    pub tool_timeout_ms: u64,
    pub distillation_timeout_ms: u64,
    pub maintenance_batch_size: usize,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            max_graph_steps: 32,
            max_tool_rounds: 4,
            node_timeout_ms: 5_000,
            tool_timeout_ms: 8_000,
            distillation_timeout_ms: 8_000,
            maintenance_batch_size: 32,
        }
    }
}

impl RuntimeConfig {
    pub fn node_timeout(&self) -> Duration {
        Duration::from_millis(self.node_timeout_ms)
    }

    pub fn tool_timeout(&self) -> Duration {
        Duration::from_millis(self.tool_timeout_ms)
    }

    pub fn distillation_timeout(&self) -> Duration {
        Duration::from_millis(self.distillation_timeout_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::EngineConfig;

    #[test]
    fn default_config_is_valid() {
        let config = EngineConfig::default();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn config_can_be_parsed_from_toml() {
        let config = EngineConfig::from_toml_str(
            r#"
            system_prompt = "You are a configurable Takos engine."

            [memory.activation.target_ratio]
            raw = 1
            abstract = 1

            [memory.activation]
            top_k_total = 12
            use_time_decay = true
            overflow_raw_threshold_relaxation = true

            [memory.retrieval.similarity_threshold]
            raw = 0.72
            abstract = 0.74

            [memory.retrieval]
            relaxed_threshold_for_pushed_raw = 0.63

            [context_budget]
            total_tokens = 64000
            reserve_system = 4000
            reserve_tools = 12000
            reserve_working = 8000
            session_ratio = 0.5
            memory_ratio = 0.5

            [tools]
            memory_search = true
            graph_search = true
            provenance_lookup = true
            timeline_search = true

            [runtime]
            max_graph_steps = 32
            max_tool_rounds = 4
            node_timeout_ms = 5000
            tool_timeout_ms = 8000
            distillation_timeout_ms = 8000
            maintenance_batch_size = 32
            "#,
        );
        assert!(config.is_ok());
    }
}
