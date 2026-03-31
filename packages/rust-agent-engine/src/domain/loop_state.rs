use serde::{Deserialize, Serialize};

use crate::ids::{AbstractNodeId, LoopId, RawNodeId, SessionId};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LoopStatus {
    Running,
    Paused,
    Finished,
    Cancelled,
    TimedOut,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoopState {
    pub session_id: SessionId,
    pub loop_id: LoopId,
    pub user_goal: String,
    pub plan: Option<String>,
    pub current_node: String,
    pub iteration: u32,
    pub tool_rounds_completed: u32,
    pub model_invocations: u32,
    pub status: LoopStatus,
    pub last_completed_node: Option<String>,
    pub last_effect_key: Option<String>,
    pub recent_events: Vec<RawNodeId>,
    pub activated_raw: Vec<RawNodeId>,
    pub activated_abstract: Vec<AbstractNodeId>,
    pub session_window: Vec<RawNodeId>,
    pub pushed_out_raw: Vec<RawNodeId>,
    pub tool_result_ids: Vec<RawNodeId>,
    pub assistant_message: Option<String>,
    pub state_json: serde_json::Value,
}
