use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::config::ContextBudgetConfig;
use crate::domain::RawNode;
use crate::ids::RawNodeId;
use crate::memory::activation::ActivatedMemory;
use crate::tools::executor::ToolCallResult;

pub trait TokenEstimator: Send + Sync {
    fn estimate_text(&self, text: &str) -> usize;
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct SessionWindowDecision {
    pub included_raw_ids: Vec<RawNodeId>,
    pub pushed_out_raw_ids: Vec<RawNodeId>,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct AssembledContext {
    pub system_prompt: String,
    pub session_context: Vec<String>,
    pub memory_context: Vec<String>,
    pub tool_context: Vec<String>,
    pub session_window: SessionWindowDecision,
    pub total_estimated_tokens: usize,
}

pub struct ContextAssembler {
    estimator: Arc<dyn TokenEstimator>,
}

impl ContextAssembler {
    pub fn new(estimator: Arc<dyn TokenEstimator>) -> Self {
        Self { estimator }
    }

    pub fn assemble(
        &self,
        budget: &ContextBudgetConfig,
        system_prompt: &str,
        session_raw: &[RawNode],
        activated_memory: &ActivatedMemory,
        tool_results: &[ToolCallResult],
    ) -> AssembledContext {
        let mut total_tokens = self.estimator.estimate_text(system_prompt);
        let remaining = budget.remaining_tokens();
        let session_budget = ((remaining as f32) * budget.session_ratio) as usize;
        let memory_budget = remaining.saturating_sub(session_budget);

        let (session_context, session_window) =
            self.collect_session_context(session_raw, session_budget);
        total_tokens += session_context
            .iter()
            .map(|line| self.estimator.estimate_text(line))
            .sum::<usize>();

        let memory_context = self.collect_memory_context(activated_memory, memory_budget);
        total_tokens += memory_context
            .iter()
            .map(|line| self.estimator.estimate_text(line))
            .sum::<usize>();

        let tool_context = self.collect_tool_context(tool_results, budget.reserve_tools);
        total_tokens += tool_context
            .iter()
            .map(|line| self.estimator.estimate_text(line))
            .sum::<usize>();

        AssembledContext {
            system_prompt: system_prompt.to_string(),
            session_context,
            memory_context,
            tool_context,
            session_window,
            total_estimated_tokens: total_tokens,
        }
    }

    fn collect_session_context(
        &self,
        session_raw: &[RawNode],
        budget: usize,
    ) -> (Vec<String>, SessionWindowDecision) {
        let mut tokens = 0usize;
        let mut context = Vec::new();
        let mut included_ids = Vec::new();
        let mut pushed_out_ids = Vec::new();

        for (index, node) in session_raw.iter().enumerate().rev() {
            let text = node.context_text();
            let estimated = self.estimator.estimate_text(&text);
            if tokens + estimated > budget {
                pushed_out_ids.extend(session_raw[..=index].iter().map(|entry| entry.id));
                break;
            }
            tokens += estimated;
            context.push(text);
            included_ids.push(node.id);
        }

        context.reverse();
        included_ids.reverse();

        (
            context,
            SessionWindowDecision {
                included_raw_ids: included_ids,
                pushed_out_raw_ids: pushed_out_ids,
            },
        )
    }

    fn collect_memory_context(
        &self,
        activated_memory: &ActivatedMemory,
        budget: usize,
    ) -> Vec<String> {
        let mut tokens = 0usize;
        let mut context = Vec::new();

        for node in &activated_memory.abstract_nodes {
            let text = format!("abstract: {}", node.node.context_text());
            let estimated = self.estimator.estimate_text(&text);
            if tokens + estimated > budget {
                break;
            }
            tokens += estimated;
            context.push(text);
        }

        for node in &activated_memory.raw_nodes {
            let text = format!("raw: {}", node.node.context_text());
            let estimated = self.estimator.estimate_text(&text);
            if tokens + estimated > budget {
                break;
            }
            tokens += estimated;
            context.push(text);
        }

        context
    }

    fn collect_tool_context(&self, tool_results: &[ToolCallResult], budget: usize) -> Vec<String> {
        let mut tokens = 0usize;
        let mut context = Vec::new();
        for result in tool_results {
            let estimated = self.estimator.estimate_text(&result.summary);
            if tokens + estimated > budget {
                break;
            }
            tokens += estimated;
            context.push(result.summary.clone());
        }
        context
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::config::ContextBudgetConfig;
    use crate::domain::{RawNode, RawNodeKind};
    use crate::memory::activation::ActivatedMemory;

    use super::{ContextAssembler, TokenEstimator};

    #[derive(Debug, Clone, Copy)]
    struct TestTokenEstimator;

    impl TokenEstimator for TestTokenEstimator {
        fn estimate_text(&self, text: &str) -> usize {
            text.split_whitespace().count().max(1)
        }
    }

    #[test]
    fn assembler_keeps_context_within_budget() {
        let assembler =
            ContextAssembler::new(Arc::new(TestTokenEstimator) as Arc<dyn TokenEstimator>);
        let session = vec![
            RawNode::text(
                RawNodeKind::UserUtterance,
                None,
                None,
                "user",
                "one two three",
                0.5,
                Vec::new(),
            ),
            RawNode::text(
                RawNodeKind::AssistantUtterance,
                None,
                None,
                "assistant",
                "four five six",
                0.5,
                Vec::new(),
            ),
        ];
        let budget = ContextBudgetConfig {
            total_tokens: 32,
            reserve_system: 2,
            reserve_tools: 2,
            reserve_working: 2,
            session_ratio: 0.5,
            memory_ratio: 0.5,
        };

        let context = assembler.assemble(
            &budget,
            "system",
            &session,
            &ActivatedMemory::default(),
            &[],
        );
        assert!(context.total_estimated_tokens <= budget.total_tokens);
    }
}
