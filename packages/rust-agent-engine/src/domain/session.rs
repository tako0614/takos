use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::ids::SessionId;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Session {
    pub id: SessionId,
    pub goal: String,
    pub created_at: DateTime<Utc>,
}

impl Session {
    #[allow(dead_code)]
    pub fn new(goal: impl Into<String>) -> Self {
        Self {
            id: SessionId::new(),
            goal: goal.into(),
            created_at: Utc::now(),
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionPlan {
    pub summary: String,
}
