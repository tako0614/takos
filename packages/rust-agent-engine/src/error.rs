use thiserror::Error;

use crate::domain::LoopStatus;

pub type Result<T> = std::result::Result<T, EngineError>;

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum EngineError {
    #[error("configuration error: {0}")]
    Configuration(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("model error: {0}")]
    Model(String),
    #[error("tool error: {0}")]
    Tool(String),
    #[error("timeout while executing {0}")]
    Timeout(String),
    #[error("unsupported backend: {0}")]
    Unsupported(&'static str),
    #[error("operation cancelled")]
    Cancelled,
    #[error("loop checkpoint not found for session={session_id} loop={loop_id}")]
    CheckpointNotFound { session_id: String, loop_id: String },
    #[error("loop terminated with status {0:?}")]
    LoopTerminated(LoopStatus),
}
