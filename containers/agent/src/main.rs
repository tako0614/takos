mod control_rpc;
mod engine_support;
mod hash;
mod internal_rpc;
mod managed_skills;
mod model;
mod prompt_assets;
mod prompts;
mod redaction;
mod skills;
mod tool_bridge;

use std::collections::HashSet;
use std::env;
use std::io;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use takos_agent_engine::domain::LoopStatus;
use takos_agent_engine::{run_turn_with_options, RunOptions, SessionResponse};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use tracing::{error, info, warn};

use crate::control_rpc::{is_lease_lost, ControlRpcClient, StartPayload, UsagePayload};
use crate::engine_support::{
    build_engine_config, build_engine_deps, build_session_request, derive_engine_session_id,
    last_user_message, resolve_embedding_backend_config, safe_run_store_path,
};
use crate::model::TakosModelRunner;
use crate::skills::build_skill_catalog;
use crate::tool_bridge::{CompositeToolExecutor, ToolExecutionRecord};

pub type AppResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const DEFAULT_MAX_CONCURRENT_RUNS: usize = 5;
const DEFAULT_HEARTBEAT_INTERVAL_SECS: u64 = 15;
/// Maximum request body size accepted on /start. The control plane sends a
/// small JSON envelope (run/worker/service ids, token, base URL). 64 KiB
/// covers every realistic payload while preventing slow-body resource
/// exhaustion. Applied via `tower_http::limit::RequestBodyLimitLayer`.
const START_REQUEST_BODY_LIMIT_BYTES: usize = 64 * 1024;
/// Per-request timeout applied to every axum handler. Keeps a stuck control
/// plane from holding a connection slot for the full process lifetime.
const REQUEST_HANDLER_TIMEOUT_SECS: u64 = 30;
const OPENAI_MAX_TOOL_DEFINITIONS: usize = 128;
const TOOLBOX_TOOL_NAME: &str = "toolbox";
const CORE_DIRECT_TOOL_NAMES: [&str; 30] = [
    TOOLBOX_TOOL_NAME,
    "container_start",
    "container_status",
    "container_commit",
    "container_stop",
    "create_repository",
    "repo_list",
    "repo_status",
    "repo_switch",
    "file_read",
    "file_write",
    "file_write_binary",
    "file_list",
    "file_delete",
    "file_mkdir",
    "file_rename",
    "file_copy",
    "runtime_exec",
    "runtime_status",
    "web_fetch",
    "create_artifact",
    "search",
    "remember",
    "recall",
    "set_reminder",
    "info_unit_search",
    "spawn_agent",
    "wait_agent",
    "memory_graph_recall",
    "store_search",
];
const FALLBACK_DISCOVERY_TOOL_NAMES: [&str; 4] = [
    "capability_search",
    "capability_families",
    "capability_describe",
    "capability_invoke",
];

#[derive(Clone)]
struct ServiceState {
    data_dir: PathBuf,
    active_runs: Arc<Mutex<HashSet<String>>>,
    max_concurrent_runs: usize,
}

impl ServiceState {
    fn new(data_dir: PathBuf, max_concurrent_runs: usize) -> Self {
        Self {
            data_dir,
            active_runs: Arc::new(Mutex::new(HashSet::new())),
            max_concurrent_runs,
        }
    }

    fn active_run_count(&self) -> usize {
        let guard = lock_active_runs(&self.active_runs);
        guard.len()
    }

    fn available_run_slots(&self) -> usize {
        self.max_concurrent_runs
            .saturating_sub(self.active_run_count())
    }

    fn try_register_run(&self, run_id: &str) -> RunAdmission {
        let mut guard = lock_active_runs(&self.active_runs);
        if guard.contains(run_id) {
            return RunAdmission::Duplicate;
        }
        if guard.len() >= self.max_concurrent_runs {
            return RunAdmission::AtCapacity {
                active: guard.len(),
                max: self.max_concurrent_runs,
            };
        }
        guard.insert(run_id.to_string());
        RunAdmission::Registered
    }

    fn finish_run(&self, run_id: &str) {
        let mut guard = lock_active_runs(&self.active_runs);
        guard.remove(run_id);
    }
}

/// RAII guard that releases a registered run slot on every exit path of the
/// spawned run task — success, error, and panic-unwind. `finish_run` uses
/// `HashSet::remove`, so it is idempotent and a double release is harmless.
struct RunSlotGuard {
    state: Arc<ServiceState>,
    run_id: String,
}

impl Drop for RunSlotGuard {
    fn drop(&mut self) {
        self.state.finish_run(&self.run_id);
    }
}

/// RAII guard that aborts a spawned task on drop, including on panic-unwind.
///
/// The heartbeat task renews the control-plane executor lease and is otherwise
/// only stopped via its `CancellationToken`. If the future it guards (the run)
/// unwinds, the explicit `cancel()`/`await` on the normal path is skipped, so
/// without this guard the heartbeat task is detached on `JoinHandle` drop and
/// keeps renewing the lease for a dead run. `Drop` aborts the task to reap it
/// deterministically; the normal path disarms the guard with `take()` and
/// awaits the handle instead.
struct AbortOnDrop(Option<tokio::task::JoinHandle<()>>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            handle.abort();
        }
    }
}

fn lock_active_runs(active_runs: &Mutex<HashSet<String>>) -> MutexGuard<'_, HashSet<String>> {
    active_runs.lock().unwrap_or_else(|poisoned| {
        warn!("run registry lock poisoned; recovering current registry");
        poisoned.into_inner()
    })
}

#[derive(Debug, PartialEq, Eq)]
enum RunAdmission {
    Registered,
    Duplicate,
    AtCapacity { active: usize, max: usize },
}

#[tokio::main]
async fn main() -> AppResult<()> {
    init_tracing();

    let data_dir = env::var("TAKOS_AGENT_DATA_DIR").map_or_else(
        |_| PathBuf::from("/var/lib/takos/containers/agent"),
        PathBuf::from,
    );
    std::fs::create_dir_all(&data_dir)?;

    let max_concurrent_runs = parse_max_concurrent_runs(env::var("MAX_CONCURRENT_RUNS").ok());
    let state = Arc::new(ServiceState::new(data_dir, max_concurrent_runs));
    // tower / tower-http middleware stack:
    //   * `ConcurrencyLimitLayer` caps the total number of in-flight HTTP
    //     handlers (separate from the run-admission counter) so a flood of
    //     /health / malformed /start requests cannot exhaust tokio tasks.
    //   * `RequestBodyLimitLayer` rejects bodies larger than 64 KiB on /start
    //     to keep the process out of slow-body memory pressure.
    //   * `TimeoutLayer` aborts handlers that exceed
    //     `REQUEST_HANDLER_TIMEOUT_SECS` so a stalled connection cannot keep
    //     a slot pinned forever.
    let app = Router::new()
        .route("/health", get(health))
        .route("/start", post(start))
        .with_state(state)
        .layer(RequestBodyLimitLayer::new(START_REQUEST_BODY_LIMIT_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(REQUEST_HANDLER_TIMEOUT_SECS),
        ))
        .layer(ConcurrencyLimitLayer::new(max_concurrent_runs.max(1) * 8));

    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8080);
    // Native execution stays loopback-only by default. Container images and
    // managed container hosts set this explicitly to 0.0.0.0 so the private
    // container network can reach the process on its declared port.
    let bind_host = resolve_bind_host(env::var("TAKOS_AGENT_BIND_HOST").ok());
    let listener = tokio::net::TcpListener::bind((bind_host.as_str(), port)).await?;
    info!(port, host = bind_host, "takos-agent listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<Arc<ServiceState>>) -> Json<Value> {
    // Concurrent-run counts are operator-only diagnostics. Hide them unless
    // `TAKOS_AGENT_HEALTH_INCLUDE_COUNTS=true` is explicitly set so an
    // unauthenticated probe cannot fingerprint capacity / load. The minimal
    // payload is sufficient for liveness checks.
    let include_counts = matches!(
        env::var("TAKOS_AGENT_HEALTH_INCLUDE_COUNTS")
            .ok()
            .map(|value| value.trim().to_ascii_lowercase())
            .as_deref(),
        Some("true") | Some("1") | Some("yes"),
    );
    let mut payload = json!({
        "status": "ok",
        "service": "takos-agent",
    });
    if include_counts {
        payload["runs"] = json!({
            "active": state.active_run_count(),
            "max": state.max_concurrent_runs,
            "available": state.available_run_slots(),
        });
    }
    Json(payload)
}

async fn start(
    State(state): State<Arc<ServiceState>>,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    if let Err(error) = authorize_start_request(&headers) {
        return error.into_response();
    }
    let Ok(payload) = serde_json::from_slice::<StartPayload>(&body) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid start payload" })),
        );
    };

    let run_id = payload.run_id.clone();
    let service_id = payload.resolved_service_id().to_string();
    match state.try_register_run(&run_id) {
        RunAdmission::Registered => {}
        RunAdmission::Duplicate => {
            return (
                StatusCode::ACCEPTED,
                Json(json!({
                    "accepted": true,
                    "runId": run_id,
                    "duplicate": true,
                })),
            );
        }
        RunAdmission::AtCapacity { active, max } => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "At capacity",
                    "active": active,
                    "max": max,
                })),
            );
        }
    }

    let payload_for_task = payload;
    let run_id_for_task = run_id.clone();
    let state_for_task = state;
    tokio::spawn(async move {
        // The guard releases the run slot on success, error, AND panic-unwind,
        // so a panic in execute_run (or anything it awaits) can no longer leak
        // a permanent run slot.
        let _slot = RunSlotGuard {
            state: state_for_task.clone(),
            run_id: run_id_for_task,
        };
        if let Err(err) = execute_run(payload_for_task.clone(), state_for_task).await {
            // Sanitize before logging: an upstream provider error body or decode
            // error embedded in `err` can carry a reflected credential.
            error!(
                error = %redaction::redact_secret_text(&err.to_string()),
                "run execution failed"
            );
            if let Ok(client) = ControlRpcClient::new(&payload_for_task) {
                let _ = client.tool_cleanup().await;
                let _ = handle_failure(&client, None, err.as_ref(), UsagePayload::default()).await;
            }
        }
        // `_slot` drops here, releasing the run slot.
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

#[derive(Debug, PartialEq, Eq)]
enum StartAuthError {
    NotConfigured,
    Unauthorized,
}

impl StartAuthError {
    fn into_response(self) -> (StatusCode, Json<Value>) {
        match self {
            Self::NotConfigured => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "start auth token is not configured" })),
            ),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "missing or invalid start authorization" })),
            ),
        }
    }
}

fn authorize_start_request(headers: &HeaderMap) -> Result<(), StartAuthError> {
    authorize_start_with_token(
        headers,
        env::var("TAKOS_AGENT_START_TOKEN")
            .ok()
            .filter(|value| !value.trim().is_empty()),
    )
}

fn authorize_start_with_token(
    headers: &HeaderMap,
    expected_token: Option<String>,
) -> Result<(), StartAuthError> {
    let expected_token = expected_token.ok_or(StartAuthError::NotConfigured)?;
    let Some(actual_token) = read_bearer_token(headers) else {
        return Err(StartAuthError::Unauthorized);
    };
    if constant_time_equal(actual_token, expected_token.trim()) {
        Ok(())
    } else {
        Err(StartAuthError::Unauthorized)
    }
}

fn read_bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let (scheme, token) = value.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("bearer") {
        let token = token.trim();
        if !token.is_empty() {
            return Some(token);
        }
    }
    None
}

fn constant_time_equal(actual: &str, expected: &str) -> bool {
    let actual = actual.as_bytes();
    let expected = expected.as_bytes();
    let len = actual.len().max(expected.len());
    let mut diff = actual.len() ^ expected.len();
    for index in 0..len {
        diff |= usize::from(*actual.get(index).unwrap_or(&0) ^ *expected.get(index).unwrap_or(&0));
    }
    diff == 0
}

struct RunContextBundle {
    bootstrap: crate::control_rpc::RunBootstrap,
    run_config: crate::control_rpc::RunConfigResponse,
    tool_catalog: crate::control_rpc::ToolCatalogResponse,
    manual_catalog: crate::control_rpc::SkillCatalogResponse,
    manual_count: usize,
    user_message: String,
}

async fn load_run_context(
    client: &ControlRpcClient,
    payload: &StartPayload,
) -> AppResult<RunContextBundle> {
    let bootstrap = client.run_bootstrap().await?;
    let run_context = client.run_context().await.ok();
    let run_config = client.run_config(bootstrap.agent_type.as_deref()).await?;
    let tool_catalog = client.tool_catalog().await?;
    let all_tool_names = tool_catalog
        .tools
        .iter()
        .map(|tool| tool.name.clone())
        .collect::<Vec<_>>();
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
            &all_tool_names,
        )
        .await
        .unwrap_or_default();
    let manual_catalog = build_skill_catalog(&skill_runtime_context, &all_tool_names);
    let manual_count = manual_catalog.skills.len();
    let user_message = last_user_message(
        &history,
        run_context
            .as_ref()
            .and_then(|context| context.last_user_message.as_deref()),
    )
    .ok_or_else(|| io::Error::other("failed to resolve the current user message for this run"))?;

    Ok(RunContextBundle {
        bootstrap,
        run_config,
        tool_catalog,
        manual_catalog,
        manual_count,
        user_message,
    })
}

// Orchestrates one run end-to-end: every block here is either a single
// build/emit call or the run/cleanup hand-off, so further splitting would
// fragment the lifecycle without isolating concerns.
#[allow(clippy::too_many_lines)]
async fn execute_run(payload: StartPayload, state: Arc<ServiceState>) -> AppResult<()> {
    // Defense-in-depth: a run MUST arrive with an explicit, real model. A
    // missing/empty model (or the literal `local-smoke` test affordance) would
    // otherwise enter the local-smoke engine, where a `tool:`/`memory:`/
    // `timeline:`-prefixed user message is dispatched DIRECTLY as a tool call
    // with no LLM mediation. The control plane always resolves a concrete model
    // (run creation + cron re-enqueue), so this only fires on a control-plane
    // bug — fail closed unless the smoke engine is explicitly opted into.
    let has_real_model = payload
        .model
        .as_deref()
        .map(str::trim)
        .is_some_and(|model| !model.is_empty() && model != "local-smoke");
    if !has_real_model && !local_smoke_opt_in() {
        return Err(io::Error::other(
            "run started without a concrete model; refusing to default to the \
             local-smoke engine (set TAKOS_AGENT_ALLOW_LOCAL_SMOKE=true to enable \
             the smoke engine in dev/test)",
        )
        .into());
    }

    let client = ControlRpcClient::new(&payload)?;
    let context = load_run_context(&client, &payload).await?;
    let RunContextBundle {
        bootstrap,
        run_config,
        tool_catalog,
        manual_catalog,
        manual_count,
        user_message,
    } = context;

    let engine_config = build_engine_config(
        &run_config,
        bootstrap
            .agent_type
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or("default"),
    );
    let engine_session_id =
        derive_engine_session_id(bootstrap.session_id.as_deref(), &bootstrap.thread_id);
    let store_root = safe_run_store_path(
        &state.data_dir,
        &bootstrap.space_id,
        bootstrap.installation_id.as_deref(),
    );
    std::fs::create_dir_all(&store_root)?;

    let api_keys = client.api_keys().await?;
    let embedding_config =
        resolve_embedding_backend_config(&run_config, api_keys.openai.as_deref())?;
    let usage_tracker = Arc::new(engine_support::UsageTracker::default());
    // The cancellation token is created here (before the executor) so the
    // tool bridge can abort in-flight remote tool calls when the run is
    // cancelled or the executor lease is lost downstream.
    let cancellation_token = CancellationToken::new();
    let composite_tool_executor = CompositeToolExecutor::new(
        client.clone(),
        tool_catalog.tools.clone(),
        manual_catalog.clone(),
    )
    .with_cancellation_token(cancellation_token.clone());
    let exposed_tools = select_model_tools(&composite_tool_executor.exposed_tools());
    let model_runner = TakosModelRunner::new_with_openai_api_keys_and_endpoint(
        payload.resolved_model(),
        run_config.temperature,
        collect_openai_api_keys(api_keys.openai, env::var("OPENAI_API_KEY").ok()),
        exposed_tools.clone(),
        usage_tracker,
        api_keys.openai_endpoint,
    );
    let deps = build_engine_deps(
        &store_root,
        model_runner.clone(),
        composite_tool_executor.clone(),
        embedding_config,
    )?;
    let request = build_session_request(engine_session_id, user_message, &exposed_tools);

    client
        .emit_run_event(
            "thinking",
            json!({
                "message": "Loaded context and configuration for this run.",
            }),
        )
        .await
        .ok();
    client
        .emit_run_event(
            "started",
            json!({
                "message": "Rust agent execution started",
                "agent_type": bootstrap.agent_type,
                "space_id": bootstrap.space_id,
                "installation_id": bootstrap.installation_id,
                "runtime_namespace": bootstrap.runtime_namespace,
                "thread_id": bootstrap.thread_id,
                "manual_count": manual_count,
                "remote_tool_count": tool_catalog.tools.len(),
                "model_tool_count": exposed_tools.len(),
            }),
        )
        .await
        .ok();

    let heartbeat_handle = tokio::spawn(heartbeat_loop(
        client.clone(),
        cancellation_token.clone(),
        Duration::from_secs(parse_heartbeat_interval_secs(
            env::var("TAKOS_AGENT_HEARTBEAT_INTERVAL_SECS").ok(),
        )),
    ));
    // Cancel the heartbeat loop on EVERY exit path, including a panic-unwind in
    // `run_turn_with_options`. On the normal/Err paths the explicit
    // `cancellation_token.cancel()` below already fired and `cancel` is
    // idempotent, so this guard's drop is a harmless no-op; on unwind it is the
    // only thing that signals the loop to break instead of renewing the lease
    // for a dead run forever.
    let _cancel_on_unwind = cancellation_token.clone().drop_guard();
    // Reap the detached heartbeat task on unwind. The normal path below disarms
    // this guard (takes the handle out) and awaits the handle explicitly.
    let mut heartbeat_guard = AbortOnDrop(Some(heartbeat_handle));
    client
        .emit_run_event(
            "thinking",
            json!({
                "message": "Starting model execution.",
            }),
        )
        .await
        .ok();
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
    if let Some(handle) = heartbeat_guard.0.take() {
        let _ = handle.await;
    }

    let usage = model_runner.usage_payload();
    client
        .emit_run_event(
            "progress",
            json!({
                "message": "Cleaning up tool state.",
            }),
        )
        .await
        .ok();
    let cleanup_result = client.tool_cleanup().await;
    client
        .emit_run_event(
            "progress",
            json!({
                "message": if cleanup_result.is_ok() {
                    "Tool cleanup completed."
                } else {
                    "Tool cleanup encountered an error."
                },
            }),
        )
        .await
        .ok();
    let tool_executions = composite_tool_executor.take_tool_executions();

    match run_result {
        Ok(response) => {
            handle_success(
                &client,
                &bootstrap.thread_id,
                &response,
                usage,
                tool_executions,
            )
            .await?;
        }
        Err(err) => {
            // The failure is now finalized with the correct usage and the error
            // run-event has already been emitted. Returning Ok keeps the outer
            // fallback from re-reporting it with zeroed usage. If reporting
            // itself fails, `?` above still propagates Err so the outer
            // last-resort net fires.
            handle_failure(&client, Some(&bootstrap.thread_id), &err, usage).await?;
            cleanup_result.ok();
            return Ok(());
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
            () = cancellation_token.cancelled() => break,
            () = sleep(interval) => {
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
    tool_executions: Vec<ToolExecutionRecord>,
) -> AppResult<()> {
    let status = run_status_for_loop(&response.status);
    if let Some(message) = &response.assistant_message {
        let metadata = if tool_executions.is_empty() {
            None
        } else {
            Some(json!({
                "tool_executions": tool_executions,
            }))
        };
        client
            .add_assistant_message(thread_id, message, metadata)
            .await?;
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
    if let Err(status_err) = client
        .update_run_status(status, usage.clone(), Some(&output), None)
        .await
    {
        // The control plane fences the terminal status write to the run lease.
        // A 409 lease-lost here means stale-recovery reclaimed this run under a
        // new lease while we were finishing; the fresh lease owns the outcome,
        // so the superseded container exits cleanly instead of letting the outer
        // last-resort net re-report a failure with zeroed usage.
        if is_lease_lost(status_err.as_ref()) {
            warn!(run_id = client.run_id(), error = %status_err, "executor lease lost during run finalization; skipping terminal status write");
            return Ok(());
        }
        return Err(status_err);
    }
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
                    "cachedInputTokens": usage.cached_input_tokens,
                }
            }),
        )
        .await
        .ok();
    Ok(())
}

async fn handle_failure(
    client: &ControlRpcClient,
    thread_id: Option<&str>,
    err: &(impl std::fmt::Display + ?Sized),
    usage: UsagePayload,
) -> AppResult<()> {
    let raw_error_message = err.to_string();
    let status = if raw_error_message.contains("operation cancelled") {
        "cancelled"
    } else {
        "failed"
    };
    let error_message = sanitize_failure_error_message(&raw_error_message);

    // add-message is lease-fenced. Persist the user-visible explanation before
    // the terminal status write releases that lease; otherwise every normal
    // failure reaches the UI as an empty thread. A reclaimed executor still
    // cannot write here, and the run-scoped idempotency key prevents duplicate
    // messages when the same lease retries.
    if status == "failed" {
        if let Some(thread_id) = thread_id {
            let user_message = user_visible_failure_message(&error_message);
            match client
                .add_assistant_message(thread_id, &user_message, None)
                .await
            {
                Ok(()) => {
                    client
                        .emit_run_event(
                            "message",
                            json!({
                                "content": user_message,
                            }),
                        )
                        .await
                        .ok();
                }
                Err(add_err) => {
                    warn!(run_id = client.run_id(), error = %add_err, "failed to persist user-visible run failure message");
                }
            }
        }
    }

    if let Err(update_err) = client
        .update_run_status(status, usage.clone(), None, Some(&error_message))
        .await
    {
        // See handle_success: a lease-lost terminal write means the run was
        // reclaimed under a new lease, so this superseded container stops here.
        if is_lease_lost(update_err.as_ref()) {
            warn!(run_id = client.run_id(), error = %update_err, "executor lease lost during failure finalization; skipping terminal status write");
            return Ok(());
        }
        return Err(update_err);
    }

    client
        .emit_run_event(
            if status == "cancelled" {
                "cancelled"
            } else {
                "error"
            },
            json!({
                "message": error_message,
                "usage": {
                    "inputTokens": usage.input_tokens,
                    "outputTokens": usage.output_tokens,
                    "cachedInputTokens": usage.cached_input_tokens,
                }
            }),
        )
        .await
        .ok();
    Ok(())
}

fn sanitize_failure_error_message(message: &str) -> String {
    redaction::redact_secret_text(message)
}

/// Whether the local-smoke engine (a dev/test affordance that turns a
/// `tool:`-prefixed user message into a direct tool call) is explicitly enabled.
/// It is OFF by default so a missing/empty model can never silently activate it
/// in production.
fn local_smoke_opt_in() -> bool {
    env::var("TAKOS_AGENT_ALLOW_LOCAL_SMOKE")
        .map(|value| value == "true" || value == "1")
        .unwrap_or(false)
}

fn user_visible_failure_message(error: &str) -> String {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("takosumi accounts workspace authorization must be renewed")
        || normalized.contains("takosumi accounts authorization must be renewed")
        || normalized.contains("takosumi ai gateway authorization is unavailable")
    {
        return "The agent needs renewed Takosumi authorization before it can call the language model. Sign in to this Takos app again, then retry.".to_string();
    }
    if normalized.contains("incorrect api key")
        || normalized.contains("invalid_api_key")
        || (normalized.contains("401 unauthorized") && normalized.contains("openai"))
    {
        return "The agent could not call the language model because the configured OpenAI-compatible API key is invalid. Update OPENAI_API_KEY for this environment and retry.".to_string();
    }
    if normalized.contains("api key is not configured")
        || normalized.contains("api key not configured")
    {
        return "The agent could not call the language model because no OpenAI-compatible API key is configured for this environment. Set OPENAI_API_KEY and retry.".to_string();
    }
    if normalized.contains("rate limit") || normalized.contains("429") {
        return "The agent could not call the language model because the provider rate limit was reached. Wait a bit and retry.".to_string();
    }
    if normalized.contains("model error") || normalized.contains("openai chat completions failed") {
        return "The agent failed while calling the language model. Check the run details, fix the model configuration, and retry.".to_string();
    }
    "The agent run failed before it could produce a response. Check the run details and retry."
        .to_string()
}

fn collect_openai_api_keys(
    control_key: Option<String>,
    container_key: Option<String>,
) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    for value in [control_key, container_key].into_iter().flatten() {
        let trimmed = value.trim();
        if trimmed.is_empty() || keys.iter().any(|existing| existing == trimmed) {
            continue;
        }
        keys.push(trimmed.to_string());
    }
    keys
}

fn select_model_tools(
    remote_tools: &[crate::control_rpc::ToolDefinition],
) -> Vec<crate::control_rpc::ToolDefinition> {
    let mut selected = Vec::new();
    let mut seen = HashSet::new();

    let has_toolbox = remote_tools
        .iter()
        .any(|tool| tool.name == TOOLBOX_TOOL_NAME);

    for name in CORE_DIRECT_TOOL_NAMES {
        push_tool_by_name(remote_tools, name, &mut selected, &mut seen);
    }

    if !has_toolbox {
        for name in FALLBACK_DISCOVERY_TOOL_NAMES {
            push_tool_by_name(remote_tools, name, &mut selected, &mut seen);
        }
    }

    if selected.is_empty() {
        for tool in remote_tools {
            if is_hidden_model_tool(&tool.name) {
                continue;
            }
            push_tool(tool, &mut selected, &mut seen);
            if selected.len() >= max_tool_definitions() {
                break;
            }
        }
    }

    selected
}

fn is_hidden_model_tool(name: &str) -> bool {
    matches!(name, "skill_context" | "skill_catalog" | "skill_describe")
}

fn push_tool_by_name(
    tools: &[crate::control_rpc::ToolDefinition],
    name: &str,
    selected: &mut Vec<crate::control_rpc::ToolDefinition>,
    seen: &mut HashSet<String>,
) {
    if selected.len() >= max_tool_definitions() {
        return;
    }
    if let Some(tool) = tools.iter().find(|tool| tool.name == name) {
        push_tool(tool, selected, seen);
    }
}

fn push_tool(
    tool: &crate::control_rpc::ToolDefinition,
    selected: &mut Vec<crate::control_rpc::ToolDefinition>,
    seen: &mut HashSet<String>,
) -> bool {
    if selected.len() >= max_tool_definitions() || !seen.insert(tool.name.clone()) {
        return false;
    }
    selected.push(tool.clone());
    true
}

const fn run_status_for_loop(status: &LoopStatus) -> &'static str {
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

fn parse_max_concurrent_runs(raw: Option<String>) -> usize {
    let Some(raw) = raw else {
        return DEFAULT_MAX_CONCURRENT_RUNS;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_MAX_CONCURRENT_RUNS;
    }
    trimmed
        .parse::<usize>()
        .ok()
        .filter(|value| *value >= 1)
        .unwrap_or(DEFAULT_MAX_CONCURRENT_RUNS)
}

fn resolve_bind_host(raw: Option<String>) -> String {
    raw.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn parse_heartbeat_interval_secs(raw: Option<String>) -> u64 {
    let Some(raw) = raw else {
        return DEFAULT_HEARTBEAT_INTERVAL_SECS;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_HEARTBEAT_INTERVAL_SECS;
    }
    trimmed
        .parse::<u64>()
        .ok()
        .filter(|v| *v >= 1)
        .unwrap_or(DEFAULT_HEARTBEAT_INTERVAL_SECS)
}

fn max_tool_definitions() -> usize {
    env::var("TAKOS_AGENT_MAX_TOOL_DEFINITIONS")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|v| *v >= 1)
        .unwrap_or(OPENAI_MAX_TOOL_DEFINITIONS)
}

#[cfg(test)]
mod tests {
    use super::{
        authorize_start_with_token, collect_openai_api_keys, handle_failure,
        parse_max_concurrent_runs, resolve_bind_host, sanitize_failure_error_message,
        select_model_tools, user_visible_failure_message, RunAdmission, ServiceState,
        StartAuthError, OPENAI_MAX_TOOL_DEFINITIONS,
    };
    use crate::control_rpc::{ControlRpcClient, StartPayload, ToolDefinition, UsagePayload};
    use crate::engine_support::safe_space_path;
    use axum::body::Body;
    use axum::extract::State;
    use axum::http::Request;
    use axum::http::{header::AUTHORIZATION, HeaderMap, HeaderValue};
    use axum::routing::post;
    use axum::{Json, Router};
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn tool(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: format!("{name} description"),
            parameters: serde_json::json!({ "type": "object" }),
        }
    }

    #[test]
    fn parse_max_concurrent_runs_defaults_to_five() {
        assert_eq!(parse_max_concurrent_runs(None), 5);
        assert_eq!(parse_max_concurrent_runs(Some(String::new())), 5);
        assert_eq!(parse_max_concurrent_runs(Some("0".to_string())), 5);
        assert_eq!(parse_max_concurrent_runs(Some("invalid".to_string())), 5);
    }

    #[test]
    fn bind_host_defaults_to_loopback_and_honors_container_contract() {
        assert_eq!(resolve_bind_host(None), "127.0.0.1");
        assert_eq!(resolve_bind_host(Some(String::new())), "127.0.0.1");
        assert_eq!(resolve_bind_host(Some(" 0.0.0.0 ".to_string())), "0.0.0.0");
    }

    #[test]
    fn failure_message_for_invalid_openai_key_is_user_visible_and_sanitized() {
        let message = user_visible_failure_message(
            "model error: OpenAI chat completions failed: 401 Unauthorized {\"error\":{\"message\":\"Incorrect API key provided: sk-secret\"}}",
        );
        assert!(message.contains("OpenAI-compatible API key is invalid"));
        assert!(!message.contains("sk-secret"));
        assert!(!message.contains("401"));
    }

    #[test]
    fn failure_message_for_missing_openai_key_is_actionable() {
        let message = user_visible_failure_message("OpenAI-compatible API key is not configured");
        assert!(message.contains("no OpenAI-compatible API key is configured"));
        assert!(message.contains("OPENAI_API_KEY"));
    }

    #[test]
    fn failure_message_for_expired_takosumi_authorization_does_not_blame_model_config() {
        let message = user_visible_failure_message(
            "model error: AuthenticationError: Takosumi Accounts Workspace authorization must be renewed",
        );
        assert!(message.contains("renewed Takosumi authorization"));
        assert!(message.contains("Sign in to this Takos app again"));
        assert!(!message.contains("model configuration"));
    }

    #[tokio::test]
    async fn failure_message_is_persisted_before_terminal_status() {
        async fn record_request(
            State(paths): State<Arc<Mutex<Vec<String>>>>,
            request: Request<Body>,
        ) -> Json<serde_json::Value> {
            paths.lock().await.push(request.uri().path().to_string());
            Json(serde_json::json!({}))
        }

        let paths = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .fallback(post(record_request))
            .with_state(paths.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener should bind");
        let address = listener.local_addr().expect("test listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test server should serve");
        });
        let client = ControlRpcClient::new(&StartPayload {
            run_id: "run-failure-order".to_string(),
            worker_id: "worker-failure-order".to_string(),
            service_id: Some("service-failure-order".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(1),
            executor_tier: Some(1),
            executor_container_id: Some("container-failure-order".to_string()),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");

        handle_failure(
            &client,
            Some("thread-failure-order"),
            &std::io::Error::other("model request failed"),
            UsagePayload::default(),
        )
        .await
        .expect("failure should be finalized");

        server.abort();
        let paths = paths.lock().await.clone();
        let message_index = paths
            .iter()
            .position(|path| path.ends_with("/add-message"))
            .expect("failure should persist an assistant message");
        let status_index = paths
            .iter()
            .position(|path| path.ends_with("/update-run-status"))
            .expect("failure should update run status");
        assert!(
            message_index < status_index,
            "assistant message must be persisted before terminal status: {paths:?}",
        );
    }

    #[test]
    fn persisted_failure_message_redacts_secret_like_tokens() {
        let message = sanitize_failure_error_message(
            "OpenAI chat completions failed: 401 {\"message\":\"sk-secret\"}",
        );
        assert!(!message.contains("sk-secret"));
        assert!(message.contains("<redacted>"));
    }

    #[test]
    fn sanitizer_redacts_bearer_provider_aws_jwt_and_email_tokens() {
        let fake_aws_key_id = concat!("AKIA", "ABCDEFGHIJKLMNOP");
        let message = sanitize_failure_error_message(&format!(
            "request denied Authorization: Bearer eyJabc.def Bearer plain-token openai \
             sk_live_AAA1 stripe sk_test_BBB github ghp_CCCCCCCC aws \
             {fake_aws_key_id} jwt eyJhbGciOi.JIUzI1.NiJ9 user user@example.com",
        ));

        // Bearer-prefixed tokens are scrubbed.
        assert!(!message.contains("eyJabc.def"));
        assert!(!message.contains("plain-token"));
        // Provider key prefixes.
        assert!(!message.contains("sk_live_AAA1"));
        assert!(!message.contains("sk_test_BBB"));
        assert!(!message.contains("ghp_CCCCCCCC"));
        // AWS access key id.
        assert!(!message.contains(fake_aws_key_id));
        // JWT-shaped token outside Bearer header.
        assert!(!message.contains("eyJhbGciOi.JIUzI1.NiJ9"));
        // Email pattern.
        assert!(!message.contains("user@example.com"));
        // Bearer scheme word is preserved (only the token is scrubbed).
        assert!(message.contains("Bearer <redacted>"));
    }

    #[test]
    fn sanitizer_keeps_innocuous_text_intact() {
        let message =
            sanitize_failure_error_message("request failed because of network timeout, http 503");
        assert_eq!(
            message,
            "request failed because of network timeout, http 503",
        );
    }

    #[test]
    fn safe_space_path_rejects_reserved_dot_segments() {
        let root = PathBuf::from("/tmp/takos-agent-test");

        assert_eq!(
            safe_space_path(&root, ".").strip_prefix(&root).unwrap(),
            Path::new("spaces/_"),
        );
        assert_eq!(
            safe_space_path(&root, "..").strip_prefix(&root).unwrap(),
            Path::new("spaces/_"),
        );
        assert_eq!(
            safe_space_path(&root, "../space")
                .strip_prefix(&root)
                .unwrap(),
            Path::new("spaces/.._space"),
        );
    }

    #[test]
    fn collect_openai_api_keys_keeps_control_then_container_fallback() {
        let keys = collect_openai_api_keys(
            Some(" sk-control ".to_string()),
            Some("sk-container".to_string()),
        );

        assert_eq!(keys, vec!["sk-control", "sk-container"]);
    }

    #[test]
    fn collect_openai_api_keys_filters_empty_and_duplicate_values() {
        let keys =
            collect_openai_api_keys(Some("sk-same".to_string()), Some(" sk-same ".to_string()));

        assert_eq!(keys, vec!["sk-same"]);
        assert!(collect_openai_api_keys(Some("   ".to_string()), None).is_empty());
    }

    #[test]
    fn start_auth_requires_configured_bearer_token() {
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer start-secret"),
        );

        assert_eq!(
            authorize_start_with_token(&headers, Some("start-secret".to_string())),
            Ok(())
        );
        assert_eq!(
            authorize_start_with_token(&headers, Some("other-secret".to_string())),
            Err(StartAuthError::Unauthorized)
        );
        assert_eq!(
            authorize_start_with_token(&HeaderMap::new(), Some("start-secret".to_string())),
            Err(StartAuthError::Unauthorized)
        );
        assert_eq!(
            authorize_start_with_token(&headers, None),
            Err(StartAuthError::NotConfigured)
        );
    }

    #[test]
    fn select_model_tools_caps_openai_tool_count_and_deduplicates_names() {
        let mut tools = (0..150)
            .map(|index| tool(&format!("tool_{index}")))
            .collect::<Vec<_>>();
        tools.push(tool("tool_1"));

        let selected = select_model_tools(&tools);
        let unique_names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<std::collections::HashSet<_>>();

        assert_eq!(selected.len(), OPENAI_MAX_TOOL_DEFINITIONS);
        assert_eq!(unique_names.len(), OPENAI_MAX_TOOL_DEFINITIONS);
    }

    #[test]
    fn select_model_tools_keeps_toolbox_plus_core_direct_tools() {
        let mut tools = (0..20)
            .map(|index| tool(&format!("tool_{index}")))
            .collect::<Vec<_>>();
        tools.extend([
            tool("toolbox"),
            tool("file_read"),
            tool("runtime_exec"),
            tool("capability_search"),
            tool("skill_catalog"),
        ]);

        let selected = select_model_tools(&tools);
        let names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["toolbox", "file_read", "runtime_exec"]);
    }

    #[test]
    fn select_model_tools_falls_back_to_discovery_when_toolbox_is_missing() {
        let tools = vec![
            tool("capability_search"),
            tool("capability_families"),
            tool("capability_describe"),
            tool("capability_invoke"),
            tool("skill_context"),
        ];

        let selected = select_model_tools(&tools);
        let names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "capability_search",
                "capability_families",
                "capability_describe",
                "capability_invoke",
            ],
        );
    }

    #[test]
    fn select_model_tools_uses_full_catalog_only_when_no_core_path_exists() {
        let tools = (0..150)
            .map(|index| tool(&format!("tool_{index}")))
            .collect::<Vec<_>>();

        let selected = select_model_tools(&tools);
        let selected_names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(selected_names[0], "tool_0");
        assert_eq!(selected.len(), OPENAI_MAX_TOOL_DEFINITIONS);
    }

    #[test]
    fn run_admission_accepts_duplicates_before_capacity_check() {
        let state = ServiceState::new(PathBuf::from("/tmp/takos-test"), 1);

        assert_eq!(state.try_register_run("run-1"), RunAdmission::Registered);
        assert_eq!(state.try_register_run("run-1"), RunAdmission::Duplicate);
        assert_eq!(
            state.try_register_run("run-2"),
            RunAdmission::AtCapacity { active: 1, max: 1 },
        );
    }
}
