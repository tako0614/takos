use std::path::PathBuf;

use takos_agent_engine::engine::session_engine::SessionRequest;
use takos_agent_engine::run_turn;
use takos_agent_engine::Result;

#[path = "common/support.rs"]
mod support;

fn demo_root() -> PathBuf {
    std::env::temp_dir().join(format!(
        "takos-agent-engine-object-demo-{}",
        uuid::Uuid::new_v4()
    ))
}

#[tokio::main]
async fn main() -> Result<()> {
    let _ = tracing_subscriber::fmt::try_init();

    let root = demo_root();
    let deps = support::build_object_deps(&root)?;
    let first = run_turn(
        &support::default_demo_config(),
        &deps,
        SessionRequest {
            session_id: None,
            user_message: "Explain how object-backed persistence survives agent restarts."
                .to_string(),
            plan: Some("Focus on unified session and memory storage.".to_string()),
        },
    )
    .await?;

    let deps_after_restart = support::build_object_deps(&root)?;
    let second = run_turn(
        &support::default_demo_config(),
        &deps_after_restart,
        SessionRequest {
            session_id: Some(first.session_id),
            user_message: "timeline: recent".to_string(),
            plan: None,
        },
    )
    .await?;

    println!("root={}", root.display());
    println!("session={}", first.session_id);
    println!(
        "turn1 status={:?}\n{}\n",
        first.status,
        first
            .assistant_message
            .as_deref()
            .unwrap_or("<no assistant message>")
    );
    println!(
        "turn2 status={:?}\n{}",
        second.status,
        second
            .assistant_message
            .as_deref()
            .unwrap_or("<no assistant message>")
    );

    Ok(())
}
