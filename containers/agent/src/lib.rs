//! Phase 20E: integration-test surface for the takos-agent crate.
//!
//! The agent binary lives in `src/main.rs` and is the canonical entry point.
//! `lib.rs` exists solely to make a small subset of internal modules
//! reachable from `tests/agent_mock_llm_test.rs` so the mock-LLM e2e flow
//! (model runner + `OpenAI` Chat Completions stub server) can be exercised
//! without spinning up the full axum service.
//!
//! The library is feature-gated on `mock-llm` so production builds never
//! emit the lib target — the binary continues to use `mod` declarations as
//! before.

#![cfg(feature = "mock-llm")]

pub mod control_rpc;
pub mod engine_support;
pub mod internal_rpc;
pub mod managed_skills;
pub mod model;
pub mod prompt_assets;
pub mod prompts;
pub mod skills;
pub mod tool_bridge;

pub type AppResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;
