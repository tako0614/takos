use std::path::PathBuf;

use takos_agent_engine::engine::session_engine::{run_turn, SessionRequest};
use takos_agent_engine::Result;
use tracing::info;

#[path = "common/support.rs"]
mod support;

fn demo_root() -> PathBuf {
    std::env::temp_dir().join(format!("takos-agent-engine-demo-{}", uuid::Uuid::new_v4()))
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = tracing_subscriber::fmt::try_init();
    let root = demo_root();
    let deps = support::build_object_deps(&root)?;

    let response = run_turn(
        &support::default_demo_config(),
        &deps,
        SessionRequest {
            session_id: None,
            user_message:
                "Explain how short-term session context and long-term memory work together."
                    .to_string(),
            plan: Some("Describe the two-layer memory model succinctly.".to_string()),
        },
    )
    .await?;

    info!(
        session_id = %response.session_id,
        loop_id = %response.loop_id,
        status = ?response.status,
        raw_activated = response.activated_raw_count,
        abstract_activated = response.activated_abstract_count,
        tool_results = response.tool_results_count,
        "demo loop completed"
    );
    println!(
        "status={:?}\n{}",
        response.status,
        response
            .assistant_message
            .as_deref()
            .unwrap_or("<no assistant message>")
    );

    let _ = std::fs::remove_dir_all(root);
    Ok(())
}
