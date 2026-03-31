use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivationQuery {
    pub user_message: String,
    pub recent_context: Vec<String>,
    pub plan: Option<String>,
    pub tool_hints: Vec<String>,
}

impl ActivationQuery {
    pub fn new(
        user_message: impl Into<String>,
        recent_context: Vec<String>,
        plan: Option<String>,
        tool_hints: Vec<String>,
    ) -> Self {
        Self {
            user_message: user_message.into(),
            recent_context,
            plan,
            tool_hints,
        }
    }

    pub fn as_embedding_input(&self) -> String {
        let mut sections = vec![format!("user: {}", self.user_message)];
        if let Some(plan) = &self.plan {
            sections.push(format!("plan: {plan}"));
        }
        if !self.recent_context.is_empty() {
            sections.push(format!("recent: {}", self.recent_context.join(" | ")));
        }
        if !self.tool_hints.is_empty() {
            sections.push(format!("tools: {}", self.tool_hints.join(" | ")));
        }
        sections.join("\n")
    }
}
