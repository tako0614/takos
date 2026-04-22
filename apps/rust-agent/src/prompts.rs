pub use crate::prompt_assets::{
    CORE_PROMPT, GENERAL_WORKFLOW, MODE_ASSISTANT, MODE_DEFAULT, MODE_IMPLEMENTER, MODE_PLANNER,
    MODE_RESEARCHER, MODE_REVIEWER, RESPONSE_GUIDELINES, TOOL_RUNTIME_RULES,
};

pub fn system_prompt_for_agent_type(agent_type: &str) -> String {
    let default_core = [
        CORE_PROMPT.trim(),
        TOOL_RUNTIME_RULES.trim(),
        RESPONSE_GUIDELINES.trim(),
    ]
    .join("\n\n");
    match agent_type {
        "researcher" => [
            default_core.as_str(),
            MODE_RESEARCHER.trim(),
            GENERAL_WORKFLOW.trim(),
        ]
        .join("\n\n"),
        "implementer" => [
            default_core.as_str(),
            MODE_IMPLEMENTER.trim(),
            GENERAL_WORKFLOW.trim(),
        ]
        .join("\n\n"),
        "reviewer" => [
            default_core.as_str(),
            MODE_REVIEWER.trim(),
            GENERAL_WORKFLOW.trim(),
        ]
        .join("\n\n"),
        "assistant" => [default_core.as_str(), MODE_ASSISTANT.trim()].join("\n\n"),
        "planner" => [default_core.as_str(), MODE_PLANNER.trim()].join("\n\n"),
        _ => [
            default_core.as_str(),
            MODE_DEFAULT.trim(),
            GENERAL_WORKFLOW.trim(),
        ]
        .join("\n\n"),
    }
}
