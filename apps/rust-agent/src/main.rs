mod control_rpc;
mod engine_support;
mod model;
mod official_skills;
mod prompts;
mod skills;
mod tool_bridge;

use std::collections::HashSet;
use std::env;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use takos_agent_engine::domain::LoopStatus;
use takos_agent_engine::{run_turn_with_options, RunOptions, SessionResponse};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::control_rpc::{is_lease_lost, ControlRpcClient, StartPayload, UsagePayload};
use crate::engine_support::{
    build_engine_config, build_engine_deps, build_session_request, derive_engine_session_id,
    last_user_message, safe_space_path,
};
use crate::model::TakosModelRunner;
use crate::skills::{build_skill_catalog, local_skill_tool_definitions, resolve_skill_plan};
use crate::tool_bridge::CompositeToolExecutor;

pub type AppResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[derive(Clone)]
struct ServiceState {
    data_dir: PathBuf,
    active_runs: Arc<Mutex<HashSet<String>>>,
}

impl ServiceState {
    fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            active_runs: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    fn try_register_run(&self, run_id: &str) -> bool {
        let mut guard = self.active_runs.lock().expect("run registry lock poisoned");
        guard.insert(run_id.to_string())
    }

    fn finish_run(&self, run_id: &str) {
        let mut guard = self.active_runs.lock().expect("run registry lock poisoned");
        guard.remove(run_id);
    }
}

#[tokio::main]
async fn main() -> AppResult<()> {
    init_tracing();

    let data_dir = env::var("TAKOS_RUST_AGENT_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/takos/rust-agent"));
    std::fs::create_dir_all(&data_dir)?;

    let state = Arc::new(ServiceState::new(data_dir));
    let app = Router::new()
        .route("/health", get(health))
        .route("/start", post(start))
        .with_state(state);

    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    info!(port, "takos-rust-agent listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "takos-rust-agent",
    }))
}

async fn start(
    State(state): State<Arc<ServiceState>>,
    Json(payload): Json<StartPayload>,
) -> (StatusCode, Json<Value>) {
    let run_id = payload.run_id.clone();
    let service_id = payload.resolved_service_id().to_string();
    if !state.try_register_run(&run_id) {
        return (
            StatusCode::ACCEPTED,
            Json(json!({
                "accepted": true,
                "runId": run_id,
                "duplicate": true,
            })),
        );
    }

    let payload_for_task = payload.clone();
    let run_id_for_task = run_id.clone();
    let state_for_task = state.clone();
    tokio::spawn(async move {
        if let Err(err) = execute_run(payload_for_task, state_for_task.clone()).await {
            error!(error = %err, "run execution failed");
        }
        state_for_task.finish_run(&run_id_for_task);
    });

    (
        StatusCode::ACCEPTED,
        Json(json!({
            "accepted": true,
            "runId": run_id,
            "serviceId": service_id,
        })),
    )
}

async fn execute_run(payload: StartPayload, state: Arc<ServiceState>) -> AppResult<()> {
    let client = ControlRpcClient::new(&payload)?;
    let bootstrap = client.run_bootstrap().await?;
    let run_context = client.run_context().await.ok();
    let run_config = client.run_config(bootstrap.agent_type.as_deref()).await?;
    let tool_catalog = client.tool_catalog().await?;
    let history = client
        .conversation_history(
            &bootstrap.thread_id,
            &bootstrap.space_id,
            payload.resolved_model(),
        )
        .await?
        .history;
    let skill_runtime_context = client
        .skill_runtime_context(
            &bootstrap.thread_id,
            &bootstrap.space_id,
            bootstrap
                .agent_type
                .as_deref()
                .filter(|value| !value.is_empty())
                .unwrap_or("default"),
            &history,
        )
        .await
        .unwrap_or_default();
    let all_tool_names = tool_catalog
        .tools
        .iter()
        .map(|tool| tool.name.clone())
        .chain(
            crate::tool_bridge::local_memory_tool_definitions()
                .into_iter()
                .map(|tool| tool.name),
        )
        .chain(
            local_skill_tool_definitions()
                .into_iter()
                .map(|tool| tool.name),
        )
        .collect::<Vec<_>>();
    let skill_catalog = build_skill_catalog(&skill_runtime_context, &all_tool_names);
    let skill_plan = resolve_skill_plan(&skill_catalog);
    let user_message = last_user_message(
        &history,
        run_context
            .as_ref()
            .and_then(|context| context.last_user_message.as_deref()),
    )
    .ok_or_else(|| io::Error::other("failed to resolve the current user message for this run"))?;

    let engine_config = build_engine_config(
        &run_config,
        bootstrap
            .agent_type
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or("default"),
        &skill_plan,
    );
    let engine_session_id =
        derive_engine_session_id(bootstrap.session_id.as_deref(), &bootstrap.thread_id);
    let store_root = safe_space_path(&state.data_dir, &bootstrap.space_id);
    std::fs::create_dir_all(&store_root)?;

    let api_keys = client.api_keys().await.unwrap_or_default();
    let usage_tracker = Arc::new(engine_support::UsageTracker::default());
    let composite_tool_executor = CompositeToolExecutor::new(
        client.clone(),
        tool_catalog.tools.clone(),
        skill_catalog.clone(),
    );
    let exposed_tools = composite_tool_executor.exposed_tools();
    let model_runner = TakosModelRunner::new(
        payload.resolved_model(),
        run_config.temperature,
        api_keys.openai.or_else(|| env::var("OPENAI_API_KEY").ok()),
        exposed_tools.clone(),
        usage_tracker,
    );
    let deps = build_engine_deps(&store_root, model_runner.clone(), composite_tool_executor)?;
    let request =
        build_session_request(engine_session_id, user_message, &skill_plan, &exposed_tools);

    client
        .emit_run_event(
            "started",
            json!({
                "message": "Rust agent execution started",
                "agent_type": bootstrap.agent_type,
                "space_id": bootstrap.space_id,
                "thread_id": bootstrap.thread_id,
                "skill_count": skill_plan.activated_skills.len(),
                "remote_tool_count": tool_catalog.tools.len(),
            }),
        )
        .await
        .ok();

    let cancellation_token = CancellationToken::new();
    let heartbeat_handle = tokio::spawn(heartbeat_loop(
        client.clone(),
        cancellation_token.clone(),
        Duration::from_secs(15),
    ));
    let run_result = run_turn_with_options(
        &engine_config,
        &deps,
        request,
        RunOptions {
            cancellation_token: Some(cancellation_token.clone()),
            ..RunOptions::default()
        },
    )
    .await;
    cancellation_token.cancel();
    let _ = heartbeat_handle.await;

    let usage = model_runner.usage_payload();
    let cleanup_result = client.tool_cleanup().await;

    match run_result {
        Ok(response) => {
            handle_success(&client, &bootstrap.thread_id, &response, usage).await?;
        }
        Err(err) => {
            handle_failure(&client, &err, usage).await?;
            cleanup_result.ok();
            return Err(Box::new(err));
        }
    }

    cleanup_result.ok();
    Ok(())
}

async fn heartbeat_loop(
    client: ControlRpcClient,
    cancellation_token: CancellationToken,
    interval: Duration,
) {
    loop {
        tokio::select! {
            _ = cancellation_token.cancelled() => break,
            _ = sleep(interval) => {
                if let Err(err) = client.heartbeat().await {
                    if is_lease_lost(err.as_ref()) {
                        warn!(run_id = client.run_id(), error = %err, "executor lease lost; cancelling run");
                        cancellation_token.cancel();
                        break;
                    }
                    warn!(run_id = client.run_id(), error = %err, "heartbeat failed");
                }
            }
        }
    }
}

async fn handle_success(
    client: &ControlRpcClient,
    thread_id: &str,
    response: &SessionResponse,
    usage: UsagePayload,
) -> AppResult<()> {
    let status = run_status_for_loop(response.status.clone());
    if let Some(message) = &response.assistant_message {
        client.add_assistant_message(thread_id, message).await?;
        client
            .emit_run_event(
                "message",
                json!({
                    "content": message,
                }),
            )
            .await
            .ok();
    }

    let output = response.assistant_message.clone().unwrap_or_default();
    client
        .update_run_status(status, usage.clone(), Some(&output), None)
        .await?;
    client
        .emit_run_event(
            if status == "completed" {
                "completed"
            } else {
                "cancelled"
            },
            json!({
                "status": status,
                "loop_status": response.status,
                "session_id": response.session_id.to_string(),
                "loop_id": response.loop_id.to_string(),
                "tool_rounds": response.tool_rounds_completed,
                "activated_raw_count": response.activated_raw_count,
                "activated_abstract_count": response.activated_abstract_count,
                "usage": {
                    "inputTokens": usage.input_tokens,
                    "outputTokens": usage.output_tokens,
                }
            }),
        )
        .await
        .ok();
    Ok(())
}

async fn handle_failure(
    client: &ControlRpcClient,
    err: &impl std::fmt::Display,
    usage: UsagePayload,
) -> AppResult<()> {
    let status = if err.to_string().contains("operation cancelled") {
        "cancelled"
    } else {
        "failed"
    };
    client
        .update_run_status(status, usage.clone(), None, Some(&err.to_string()))
        .await?;
    client
        .emit_run_event(
            if status == "cancelled" {
                "cancelled"
            } else {
                "error"
            },
            json!({
                "message": err.to_string(),
                "usage": {
                    "inputTokens": usage.input_tokens,
                    "outputTokens": usage.output_tokens,
                }
            }),
        )
        .await
        .ok();
    Ok(())
}

fn run_status_for_loop(status: LoopStatus) -> &'static str {
    match status {
        LoopStatus::Finished => "completed",
        LoopStatus::Cancelled => "cancelled",
        LoopStatus::Paused | LoopStatus::Running => "running",
        LoopStatus::TimedOut | LoopStatus::Failed => "failed",
    }
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}
