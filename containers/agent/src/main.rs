mod control_rpc;
mod engine_support;
mod hash;
mod model;
mod redaction;
mod skills;
mod tool_bridge;

use std::collections::{HashMap, HashSet};
use std::env;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use takos_agent_engine::domain::LoopStatus;
use takos_agent_engine::model::{ConversationMessage, ConversationRole};
use takos_agent_engine::storage::{InMemoryLoopStateRepository, LoopStateRepository};
use takos_agent_engine::{
    recover_interrupted_loop_with_options, run_turn_with_options, EngineError, ExecutionProfile,
    ExecutionState, RunOptions, SessionResponse,
};
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;
use tracing::{error, info, warn};

use crate::control_rpc::{
    is_run_authority_lost, ControlRpcClient, ControlRpcLoopStateRepository, StartPayload,
    UsagePayload,
};
use crate::engine_support::{
    build_engine_config, build_engine_deps, build_session_request, derive_engine_session_id,
    durable_history_before_current, last_user_message,
};
use crate::model::TakosModelRunner;
use crate::skills::{build_skill_catalog, render_available_skill_context};
use crate::tool_bridge::CompositeToolExecutor;

pub type AppResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

/// Marks a failure to confirm the already-selected terminal outcome.
///
/// This is deliberately distinct from an execution/model failure: retrying a
/// second `failed` completion after an ambiguous `completed` commit would
/// corrupt the run's outcome. The task boundary logs this error and leaves the
/// same atomic completion available for replay/recovery.
#[derive(Debug)]
struct FinalizationError {
    source: Box<dyn std::error::Error + Send + Sync>,
}

impl FinalizationError {
    fn new(source: Box<dyn std::error::Error + Send + Sync>) -> Self {
        Self { source }
    }
}

impl std::fmt::Display for FinalizationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "run finalization remained unconfirmed: {}",
            self.source
        )
    }
}

impl std::error::Error for FinalizationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.source.as_ref())
    }
}

fn is_finalization_error(error: &(dyn std::error::Error + 'static)) -> bool {
    let mut current = Some(error);
    while let Some(source) = current {
        if source.downcast_ref::<FinalizationError>().is_some() {
            return true;
        }
        current = source.source();
    }
    false
}

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
const RUNTIME_PROTOCOL_VERSION: u32 = 2;
const TOOLBOX_TOOL_NAME: &str = "toolbox";
const CORE_DIRECT_TOOL_NAMES: [&str; 10] = [
    TOOLBOX_TOOL_NAME,
    "web_fetch",
    "chat_attachment_read",
    "create_artifact",
    "remember",
    "recall",
    "set_reminder",
    "spawn_agent",
    "wait_agent",
    "store_search",
];

#[derive(Clone)]
struct ServiceState {
    active_runs: Arc<Mutex<HashMap<String, ActiveRun>>>,
    shutting_down: Arc<AtomicBool>,
    max_concurrent_runs: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RunLeaseIdentity {
    service_id: String,
    lease_version: Option<u32>,
}

impl RunLeaseIdentity {
    fn from_payload(payload: &StartPayload) -> Self {
        Self {
            service_id: payload.resolved_service_id().to_string(),
            lease_version: payload.lease_version,
        }
    }
}

#[derive(Clone)]
struct ActiveRun {
    identity: RunLeaseIdentity,
    cancellation_token: CancellationToken,
}

impl ServiceState {
    fn new(max_concurrent_runs: usize) -> Self {
        Self {
            active_runs: Arc::new(Mutex::new(HashMap::new())),
            shutting_down: Arc::new(AtomicBool::new(false)),
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

    fn try_register_run(&self, payload: &StartPayload) -> RunAdmission {
        if self.is_shutting_down() {
            return RunAdmission::ShuttingDown;
        }
        let run_id = &payload.run_id;
        let identity = RunLeaseIdentity::from_payload(payload);
        let mut guard = lock_active_runs(&self.active_runs);
        // Close the race where SIGTERM lands after the fast-path check but
        // before this request acquires the admission registry.
        if self.is_shutting_down() {
            return RunAdmission::ShuttingDown;
        }
        if let Some(existing) = guard.get(run_id) {
            if existing.identity == identity {
                return RunAdmission::Duplicate;
            }

            // Stale recovery can dispatch the same run to the same pooled
            // container under a fresh serviceId/leaseVersion. Cancel the old
            // task and replace its registry entry instead of incorrectly
            // returning a duplicate 202 that never starts the fresh lease.
            existing.cancellation_token.cancel();
            let cancellation_token = CancellationToken::new();
            guard.insert(
                run_id.clone(),
                ActiveRun {
                    identity: identity.clone(),
                    cancellation_token: cancellation_token.clone(),
                },
            );
            return RunAdmission::Registered {
                identity,
                cancellation_token,
                replaced: true,
            };
        }
        if guard.len() >= self.max_concurrent_runs {
            return RunAdmission::AtCapacity {
                active: guard.len(),
                max: self.max_concurrent_runs,
            };
        }
        let cancellation_token = CancellationToken::new();
        guard.insert(
            run_id.clone(),
            ActiveRun {
                identity: identity.clone(),
                cancellation_token: cancellation_token.clone(),
            },
        );
        RunAdmission::Registered {
            identity,
            cancellation_token,
            replaced: false,
        }
    }

    fn finish_run(&self, run_id: &str, identity: &RunLeaseIdentity) {
        let mut guard = lock_active_runs(&self.active_runs);
        if guard
            .get(run_id)
            .is_some_and(|active| &active.identity == identity)
        {
            guard.remove(run_id);
        }
    }

    fn begin_shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
    }

    fn is_shutting_down(&self) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
    }

    async fn wait_for_runs_to_drain(&self, timeout: Duration) {
        let drained = tokio::time::timeout(timeout, async {
            while self.active_run_count() > 0 {
                sleep(Duration::from_millis(100)).await;
            }
        })
        .await;
        if drained.is_err() {
            warn!(
                active_runs = self.active_run_count(),
                "timed out waiting for agent runs to drain during shutdown"
            );
        }
    }
}

/// RAII guard that releases a registered run slot on every exit path of the
/// spawned run task — success, error, and panic-unwind. `finish_run` uses
/// The registry removes only the matching task identity from its `HashMap`, so
/// a stale guard cannot release a replacement task for the same run.
struct RunSlotGuard {
    state: Arc<ServiceState>,
    run_id: String,
    identity: RunLeaseIdentity,
}

impl Drop for RunSlotGuard {
    fn drop(&mut self) {
        self.state.finish_run(&self.run_id, &self.identity);
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

fn lock_active_runs(
    active_runs: &Mutex<HashMap<String, ActiveRun>>,
) -> MutexGuard<'_, HashMap<String, ActiveRun>> {
    active_runs.lock().unwrap_or_else(|poisoned| {
        warn!("run registry lock poisoned; recovering current registry");
        poisoned.into_inner()
    })
}

#[derive(Debug)]
enum RunAdmission {
    Registered {
        identity: RunLeaseIdentity,
        cancellation_token: CancellationToken,
        replaced: bool,
    },
    Duplicate,
    AtCapacity {
        active: usize,
        max: usize,
    },
    ShuttingDown,
}

#[tokio::main]
async fn main() -> AppResult<()> {
    init_tracing();

    let max_concurrent_runs = parse_max_concurrent_runs(env::var("MAX_CONCURRENT_RUNS").ok());
    let state = Arc::new(ServiceState::new(max_concurrent_runs));
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
        .with_state(state.clone())
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
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(state.clone()))
        .await?;
    // Cloudflare sends SIGTERM before rollout/idle termination. Existing runs
    // keep executing and may finalize if a real result is already available;
    // if the platform later kills the process, their DB lease stays running and
    // stale recovery reclaims it. Platform interruption is not user cancel.
    state
        .wait_for_runs_to_drain(Duration::from_secs(14 * 60))
        .await;
    Ok(())
}

async fn shutdown_signal(state: Arc<ServiceState>) {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            warn!(%error, "failed to install ctrl-c shutdown handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => warn!(%error, "failed to install SIGTERM shutdown handler"),
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    info!(
        active_runs = state.active_run_count(),
        "agent shutdown requested"
    );
    state.begin_shutdown();
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

fn accepted_start_payload(
    run_id: &str,
    service_id: Option<&str>,
    duplicate: Option<bool>,
    replaced: Option<bool>,
) -> Value {
    let mut payload = json!({
        "accepted": true,
        "runId": run_id,
        "runtimeProtocolVersion": RUNTIME_PROTOCOL_VERSION,
    });
    if let Some(service_id) = service_id {
        payload["serviceId"] = json!(service_id);
    }
    if let Some(duplicate) = duplicate {
        payload["duplicate"] = json!(duplicate);
    }
    if let Some(replaced) = replaced {
        payload["replaced"] = json!(replaced);
    }
    payload
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
    let (run_identity, run_cancellation_token, replaced) = match state.try_register_run(&payload) {
        RunAdmission::Registered {
            identity,
            cancellation_token,
            replaced,
        } => (identity, cancellation_token, replaced),
        RunAdmission::Duplicate => {
            return (
                StatusCode::ACCEPTED,
                Json(accepted_start_payload(&run_id, None, Some(true), None)),
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
        RunAdmission::ShuttingDown => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "Agent is shutting down" })),
            );
        }
    };

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
            identity: run_identity,
        };
        if let Err(err) = execute_run(payload_for_task.clone(), run_cancellation_token).await {
            handle_run_task_error(&payload_for_task, err.as_ref()).await;
        }
        // `_slot` drops here, releasing the run slot.
    });

    (
        StatusCode::ACCEPTED,
        Json(accepted_start_payload(
            &run_id,
            Some(&service_id),
            None,
            Some(replaced),
        )),
    )
}

async fn handle_run_task_error(
    payload: &StartPayload,
    err: &(dyn std::error::Error + Send + Sync + 'static),
) {
    if is_run_authority_lost(err) {
        warn!(
            run_id = payload.run_id,
            error = %err,
            "run authority was revoked; stopping without stale finalization"
        );
        return;
    }
    if is_finalization_error(err) {
        // The selected completion may already be committed. Never translate a
        // transport/response failure here into a different `failed` model
        // outcome; bounded same-payload replay happens inside `complete_run`.
        error!(
            run_id = payload.run_id,
            error = %redaction::redact_secret_text(&err.to_string()),
            "atomic run finalization could not be confirmed"
        );
        return;
    }
    // Sanitize before logging: an upstream provider error body or decode error
    // embedded in `err` can carry a reflected credential.
    error!(
        run_id = payload.run_id,
        error = %redaction::redact_secret_text(&err.to_string()),
        "run execution failed"
    );
    if let Ok(client) = ControlRpcClient::new(payload) {
        let _ = client.tool_cleanup().await;
        let _ = handle_failure(&client, err, UsagePayload::default(), None).await;
    }
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
    manual_count: usize,
    user_message: String,
    conversation_history: Vec<ConversationMessage>,
}

async fn load_run_context(
    client: &ControlRpcClient,
    payload: &StartPayload,
) -> AppResult<RunContextBundle> {
    let bootstrap = client.run_bootstrap().await?;
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
    let manual_count = manual_catalog
        .skills
        .iter()
        .filter(|skill| skill.availability != "unavailable")
        .count();
    let user_message = last_user_message(&history, None).ok_or_else(|| {
        io::Error::other("failed to resolve the current user message for this run")
    })?;
    let mut conversation_history = durable_history_before_current(&history, &user_message);
    if let Some(skill_context) = render_available_skill_context(&manual_catalog) {
        conversation_history.push(ConversationMessage {
            role: ConversationRole::System,
            content: skill_context,
            tool_call_id: None,
            tool_calls: Vec::new(),
        });
    }

    Ok(RunContextBundle {
        bootstrap,
        run_config,
        tool_catalog,
        manual_count,
        user_message,
        conversation_history,
    })
}

// Orchestrates one run end-to-end: every block here is either a single
// build/emit call or the run/cleanup hand-off, so further splitting would
// fragment the lifecycle without isolating concerns.
#[allow(clippy::too_many_lines)]
async fn execute_run(
    payload: StartPayload,
    cancellation_token: CancellationToken,
) -> AppResult<()> {
    if cancellation_token.is_cancelled() {
        return Ok(());
    }
    // Defense-in-depth: a run MUST arrive with an explicit, real model. A
    // missing/empty model (or the literal `local-smoke` test affordance) would
    // otherwise enter the local-smoke engine, where a `tool:`-prefixed user
    // message is dispatched directly as a remote tool call with no LLM
    // mediation. The control plane always resolves a concrete model
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
    // Validate and renew the token-bound lease before loading conversation,
    // memory, skills, provider credentials, or model context. The periodic
    // heartbeat starts later, so without this synchronous fence an already
    // cancelled/replaced task could perform several expensive reads first.
    client.heartbeat().await?;
    let context = load_run_context(&client, &payload).await?;
    if cancellation_token.is_cancelled() {
        return Ok(());
    }
    let RunContextBundle {
        bootstrap,
        run_config,
        tool_catalog,
        manual_count,
        user_message,
        conversation_history,
    } = context;

    let engine_config = build_engine_config(&run_config)?;
    let engine_session_id = derive_engine_session_id(&bootstrap.thread_id);
    let api_keys = client.api_keys().await?;
    let usage_tracker = Arc::new(engine_support::UsageTracker::default());
    // The admission registry owns this token so a fresh lease for the same
    // run can cancel and replace an old in-container task. The heartbeat loop
    // also cancels it when the control-plane lease/status fence returns 409.
    let composite_tool_executor =
        CompositeToolExecutor::new(client.clone(), tool_catalog.tools.clone())
            .with_cancellation_token(cancellation_token.clone());
    let tool_execution_state = composite_tool_executor.clone();
    let exposed_tools = select_model_tools(&composite_tool_executor.exposed_tools());
    let model_runner = TakosModelRunner::new_with_openai_api_keys_and_endpoint(
        payload.resolved_model(),
        run_config.temperature,
        collect_openai_api_keys(api_keys.openai, env::var("OPENAI_API_KEY").ok()),
        exposed_tools.clone(),
        usage_tracker.clone(),
        api_keys.openai_endpoint,
    );
    let durable_checkpoint_repository = if payload.supports_durable_checkpoints() {
        Some(Arc::new(ControlRpcLoopStateRepository::new(
            client.clone(),
            usage_tracker,
            tool_execution_state.fatal_error_handle(),
        )))
    } else {
        None
    };
    let saved_checkpoint = match durable_checkpoint_repository.as_ref() {
        Some(repository) => repository.load_current().await?,
        None => None,
    };
    let checkpoint_repository: Arc<dyn LoopStateRepository> =
        match durable_checkpoint_repository.as_ref() {
            Some(repository) => repository.clone(),
            None => Arc::new(InMemoryLoopStateRepository::default()),
        };
    let deps = build_engine_deps(
        model_runner.clone(),
        composite_tool_executor,
        checkpoint_repository.clone(),
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
    let run_options = worker_context_run_options(cancellation_token.clone(), conversation_history);
    let mut run_result = if let Some(error) = tool_execution_state.fatal_error() {
        // A prior executor already crossed a commit-ambiguous side-effect
        // boundary. Do not recover the graph or invoke a model/tool again.
        Err(EngineError::Tool(error))
    } else if let Some(checkpoint) = saved_checkpoint {
        recover_interrupted_loop_with_options(&engine_config, &deps, checkpoint, run_options).await
    } else {
        run_turn_with_options(&engine_config, &deps, request, run_options).await
    };
    if let Some(error) = tool_execution_state.fatal_error() {
        run_result = Err(EngineError::Tool(error));
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
    let finalization_result = match run_result {
        Ok(response) => handle_success(&client, &response, usage).await,
        Err(err) => {
            // A model/engine failure is finalized once with its real usage.
            // `FinalizationError` keeps an unconfirmed terminal transport from
            // being rewritten as a second zero-usage failure at the task edge.
            let checkpoint_turn_messages = match durable_checkpoint_repository.as_ref() {
                Some(repository) => repository.load_current().await.ok().flatten(),
                None => None,
            }
            .and_then(|checkpoint| ExecutionState::from_checkpoint(checkpoint).ok())
            .map(|(state, _, _)| state.turn_messages);
            handle_failure(&client, &err, usage, checkpoint_turn_messages.as_deref()).await
        }
    };

    // Keep renewing the run lease through cleanup and the full bounded atomic
    // finalization retry window. Stopping earlier can let a valid completion
    // lose authority while its commit response is still in flight.
    cancellation_token.cancel();
    if let Some(handle) = heartbeat_guard.0.take() {
        let _ = handle.await;
    }
    cleanup_result.ok();
    finalization_result
}

fn worker_context_run_options(
    cancellation_token: CancellationToken,
    conversation_history: Vec<ConversationMessage>,
) -> RunOptions {
    RunOptions {
        cancellation_token: Some(cancellation_token),
        conversation_history,
        execution_profile: ExecutionProfile::ExternalContext,
        ..RunOptions::default()
    }
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
                    if is_run_authority_lost(err.as_ref()) {
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
    response: &SessionResponse,
    usage: UsagePayload,
) -> AppResult<()> {
    let status = run_status_for_loop(&response.status);
    let output = response.assistant_message.clone().unwrap_or_default();
    let terminal_error = match response.status {
        LoopStatus::TimedOut => Some("agent execution timed out"),
        LoopStatus::Failed => Some("agent execution failed"),
        LoopStatus::Cancelled => {
            Some("agent execution cancelled without control-plane cancellation")
        }
        _ => None,
    };
    let messages = build_terminal_transcript(response, terminal_error)?;
    if let Err(status_err) = client
        .complete_run(
            status,
            usage.clone(),
            Some(&output),
            terminal_error,
            messages,
        )
        .await
    {
        if is_run_authority_lost(status_err.as_ref()) {
            warn!(run_id = client.run_id(), error = %status_err, "executor lease lost during atomic run finalization; skipping stale outcome");
            return Ok(());
        }
        return Err(Box::new(FinalizationError::new(status_err)));
    }
    Ok(())
}

async fn handle_failure(
    client: &ControlRpcClient,
    err: &(impl std::fmt::Display + ?Sized),
    usage: UsagePayload,
    turn_messages: Option<&[ConversationMessage]>,
) -> AppResult<()> {
    let raw_error_message = err.to_string();
    if raw_error_message.contains("operation cancelled") {
        // Cancellation is a control-plane transition. The user/cancel path has
        // already revoked this lease and owns the terminal event; the container
        // must not manufacture a competing cancelled outcome.
        return Ok(());
    }
    let status = "failed";
    let error_message = sanitize_failure_error_message(&raw_error_message);
    let messages = build_terminal_transcript_messages(
        turn_messages.unwrap_or_default(),
        Some(user_visible_failure_message(&error_message)),
    )?;
    if let Err(update_err) = client
        .complete_run(status, usage.clone(), None, Some(&error_message), messages)
        .await
    {
        if is_run_authority_lost(update_err.as_ref()) {
            warn!(run_id = client.run_id(), error = %update_err, "executor lease lost during atomic failure finalization; skipping stale outcome");
            return Ok(());
        }
        return Err(Box::new(FinalizationError::new(update_err)));
    }
    Ok(())
}

fn build_terminal_transcript(
    response: &SessionResponse,
    terminal_error: Option<&str>,
) -> AppResult<Vec<Value>> {
    let final_message = response
        .assistant_message
        .clone()
        .or_else(|| terminal_error.map(user_visible_failure_message));
    build_terminal_transcript_messages(&response.turn_messages, final_message)
}

fn build_terminal_transcript_messages(
    turn_messages: &[ConversationMessage],
    final_message: Option<String>,
) -> AppResult<Vec<Value>> {
    let mut transcript = Vec::with_capacity(turn_messages.len() + 1);
    for message in turn_messages {
        let role = match message.role {
            ConversationRole::Assistant => "assistant",
            ConversationRole::Tool => "tool",
            ConversationRole::System | ConversationRole::User => {
                return Err(io::Error::other(
                    "engine returned a non-terminal role in turn_messages",
                )
                .into());
            }
        };
        let tool_calls = message
            .tool_calls
            .iter()
            .map(|call| {
                let id = call.id.as_deref().ok_or_else(|| {
                    io::Error::other("engine returned a tool call without a correlation id")
                })?;
                if !call.arguments.is_object() {
                    return Err(io::Error::other(
                        "engine returned non-object tool call arguments",
                    ));
                }
                Ok(json!({
                    "id": id,
                    "name": call.name,
                    "arguments": call.arguments,
                }))
            })
            .collect::<Result<Vec<_>, io::Error>>()?;
        let mut persisted = json!({
            "role": role,
            "content": message.content,
        });
        if role == "tool" {
            if !tool_calls.is_empty() {
                return Err(io::Error::other(
                    "engine returned tool calls on a tool-result message",
                )
                .into());
            }
            let tool_call_id = message.tool_call_id.as_deref().ok_or_else(|| {
                io::Error::other("engine returned a tool result without a correlation id")
            })?;
            persisted["tool_call_id"] = json!(tool_call_id);
        } else {
            if message.tool_call_id.is_some() {
                return Err(io::Error::other(
                    "engine returned a tool-result id on an assistant message",
                )
                .into());
            }
            if !tool_calls.is_empty() {
                persisted["tool_calls"] = json!(tool_calls);
            }
        }
        transcript.push(persisted);
    }

    if let Some(content) = final_message {
        let message = json!({
            "role": "assistant",
            "content": content,
        });
        transcript.push(message);
    }
    Ok(transcript)
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
    if normalized.contains("side-effect outcome is uncertain")
        || normalized.contains("automatic replay is blocked")
    {
        return "A remote side effect may already have completed, but Takos could not confirm its outcome. Verify the remote system before issuing any new operation; do not retry blindly."
            .to_string();
    }
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

    // Selective exposure depends on toolbox being callable. During a partial
    // rollout or a control-plane regression where toolbox is absent, expose
    // the bounded full catalog so installed MCP tools do not become
    // unreachable merely because the router is missing.
    if !remote_tools
        .iter()
        .any(|tool| tool.name == TOOLBOX_TOOL_NAME)
    {
        for tool in remote_tools {
            push_tool(tool, &mut selected, &mut seen);
            if selected.len() >= max_tool_definitions() {
                break;
            }
        }
        return selected;
    }

    for name in CORE_DIRECT_TOOL_NAMES {
        push_tool_by_name(remote_tools, name, &mut selected, &mut seen);
    }

    selected
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
        LoopStatus::Cancelled => "failed",
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
    use super::execute_run;
    use super::{
        accepted_start_payload, authorize_start_with_token, collect_openai_api_keys,
        handle_failure, handle_run_task_error, handle_success, heartbeat_loop,
        parse_max_concurrent_runs, resolve_bind_host, sanitize_failure_error_message,
        select_model_tools, user_visible_failure_message, worker_context_run_options, RunAdmission,
        ServiceState, StartAuthError, OPENAI_MAX_TOOL_DEFINITIONS, RUNTIME_PROTOCOL_VERSION,
    };
    use crate::control_rpc::{ControlRpcClient, StartPayload, ToolDefinition, UsagePayload};
    use axum::body::{to_bytes, Body};
    use axum::extract::State;
    use axum::http::Request;
    use axum::http::{header::AUTHORIZATION, HeaderMap, HeaderValue, StatusCode};
    use axum::response::{IntoResponse, Response};
    use axum::routing::post;
    use axum::{Json, Router};
    use std::sync::Arc;
    use std::time::Duration;
    use takos_agent_engine::domain::LoopStatus;
    use takos_agent_engine::ids::{LoopId, SessionId};
    use takos_agent_engine::model::{ConversationMessage, ConversationRole};
    use takos_agent_engine::{ExecutionProfile, SessionResponse};
    use tokio::sync::Mutex;
    use tokio_util::sync::CancellationToken;

    fn tool(name: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: format!("{name} description"),
            parameters: serde_json::json!({ "type": "object" }),
            risk_level: Some("low".to_string()),
            side_effects: Some(false),
        }
    }

    fn start_payload(run_id: &str, service_id: &str, lease_version: u32) -> StartPayload {
        StartPayload {
            run_id: run_id.to_string(),
            worker_id: service_id.to_string(),
            service_id: Some(service_id.to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(lease_version),
            executor_tier: Some(1),
            executor_container_id: Some("container-test".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: "http://127.0.0.1:1".to_string(),
            control_rpc_token: "test-token".to_string(),
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
    fn accepted_start_responses_negotiate_runtime_protocol_v2() {
        let started = accepted_start_payload("run-1", Some("service-1"), None, Some(false));
        let duplicate = accepted_start_payload("run-1", None, Some(true), None);

        assert_eq!(RUNTIME_PROTOCOL_VERSION, 2);
        assert_eq!(started["runtimeProtocolVersion"], 2);
        assert_eq!(duplicate["runtimeProtocolVersion"], 2);
        assert_eq!(started["serviceId"], "service-1");
        assert_eq!(duplicate["duplicate"], true);
    }

    #[test]
    fn wrapper_opts_into_external_context_execution() {
        let history = vec![ConversationMessage {
            role: ConversationRole::Assistant,
            content: "worker durable history".to_string(),
            tool_call_id: None,
            tool_calls: Vec::new(),
        }];
        let options = worker_context_run_options(CancellationToken::new(), history.clone());

        assert_eq!(options.execution_profile, ExecutionProfile::ExternalContext);
        assert_eq!(options.conversation_history, history);
        assert!(options.cancellation_token.is_some());
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

    #[test]
    fn failure_message_for_uncertain_side_effect_never_recommends_retry() {
        let message = user_visible_failure_message(
            "side-effect outcome is uncertain; verify remote state before issuing a new operation: timed out",
        );
        assert!(message.contains("may already have completed"));
        assert!(message.contains("Verify the remote system"));
        assert!(message.contains("do not retry blindly"));
    }

    #[tokio::test]
    async fn failure_message_and_terminal_status_use_one_complete_run_rpc() {
        type CapturedRequests = Arc<Mutex<Vec<(String, serde_json::Value)>>>;

        async fn record_request(
            State(requests): State<CapturedRequests>,
            request: Request<Body>,
        ) -> Json<serde_json::Value> {
            let path = request.uri().path().to_string();
            let body = to_bytes(request.into_body(), 1024 * 1024)
                .await
                .expect("complete-run body");
            let payload = serde_json::from_slice(&body).expect("complete-run JSON");
            requests.lock().await.push((path, payload));
            Json(serde_json::json!({}))
        }

        let requests = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .fallback(post(record_request))
            .with_state(requests.clone());
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
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");

        handle_failure(
            &client,
            &std::io::Error::other("model request failed"),
            UsagePayload::default(),
            None,
        )
        .await
        .expect("failure should be finalized");

        server.abort();
        let requests = requests.lock().await.clone();
        let completion = requests
            .iter()
            .find(|(path, _)| path.ends_with("/complete-run"))
            .map(|(_, payload)| payload)
            .expect("failure should use complete-run");
        assert_eq!(completion["status"], "failed");
        assert_eq!(completion["messages"][0]["role"], "assistant");
        assert!(completion["messages"][0]["content"]
            .as_str()
            .is_some_and(|content| content.contains("agent run failed")));
        assert!(!requests
            .iter()
            .any(|(path, _)| path.ends_with("/add-message")));
        assert!(!requests
            .iter()
            .any(|(path, _)| path.ends_with("/update-run-status")));
    }

    #[tokio::test]
    async fn task_failure_handler_does_not_rewrite_an_unconfirmed_finalization_as_failed() {
        type CapturedRequests = Arc<Mutex<Vec<(String, serde_json::Value)>>>;

        async fn record_request(
            State(requests): State<CapturedRequests>,
            request: Request<Body>,
        ) -> Response {
            let path = request.uri().path().to_string();
            let body = to_bytes(request.into_body(), 1024 * 1024)
                .await
                .expect("request body");
            let payload = serde_json::from_slice(&body).expect("request JSON");
            requests.lock().await.push((path, payload));
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "temporary" })),
            )
                .into_response()
        }

        let requests = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .fallback(post(record_request))
            .with_state(requests.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test listener should bind");
        let address = listener.local_addr().expect("test listener address");
        let server = tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("test server should serve");
        });
        let payload = StartPayload {
            run_id: "run-unconfirmed-finalization".to_string(),
            worker_id: "worker-unconfirmed-finalization".to_string(),
            service_id: Some("service-unconfirmed-finalization".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(1),
            executor_tier: Some(1),
            executor_container_id: Some("container-unconfirmed-finalization".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        };
        let response = SessionResponse {
            session_id: SessionId::new(),
            loop_id: LoopId::new(),
            status: LoopStatus::Finished,
            assistant_message: Some("completed answer".to_string()),
            turn_messages: Vec::new(),
            activated_raw_count: 0,
            activated_abstract_count: 0,
            tool_results_count: 0,
            completed_steps: 1,
            tool_rounds_completed: 0,
        };
        let error = handle_success(
            &ControlRpcClient::new(&payload).expect("control RPC client should build"),
            &response,
            UsagePayload::default(),
        )
        .await
        .expect_err("bounded finalization retries should remain unconfirmed");

        handle_run_task_error(&payload, error.as_ref()).await;

        server.abort();
        let requests = requests.lock().await;
        assert_eq!(
            requests.len(),
            3,
            "complete-run should retry at most three times"
        );
        assert!(requests.iter().all(|(path, body)| {
            path.ends_with("/complete-run") && body["status"] == "completed"
        }));
        assert!(requests
            .iter()
            .all(|(_, body)| body["output"] == "completed answer"));
    }

    #[tokio::test]
    async fn heartbeat_continues_while_atomic_finalization_is_unconfirmed() {
        type CapturedPaths = Arc<Mutex<Vec<String>>>;

        async fn handler(State(paths): State<CapturedPaths>, request: Request<Body>) -> Response {
            let path = request.uri().path().to_string();
            paths.lock().await.push(path.clone());
            if path.ends_with("/complete-run") {
                tokio::time::sleep(Duration::from_millis(80)).await;
            }
            Json(serde_json::json!({})).into_response()
        }

        let paths = Arc::new(Mutex::new(Vec::new()));
        let app = Router::new()
            .fallback(post(handler))
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
            run_id: "run-heartbeat-finalization".to_string(),
            worker_id: "worker-heartbeat-finalization".to_string(),
            service_id: Some("service-heartbeat-finalization".to_string()),
            model: Some("local-smoke".to_string()),
            lease_version: Some(1),
            executor_tier: Some(1),
            executor_container_id: Some("container-heartbeat-finalization".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: format!("http://{address}"),
            control_rpc_token: "test-token".to_string(),
        })
        .expect("control RPC client should build");
        let cancellation = CancellationToken::new();
        let heartbeat = tokio::spawn(heartbeat_loop(
            client.clone(),
            cancellation.clone(),
            Duration::from_millis(10),
        ));
        let response = SessionResponse {
            session_id: SessionId::new(),
            loop_id: LoopId::new(),
            status: LoopStatus::Finished,
            assistant_message: Some("done".to_string()),
            turn_messages: Vec::new(),
            activated_raw_count: 0,
            activated_abstract_count: 0,
            tool_results_count: 0,
            completed_steps: 1,
            tool_rounds_completed: 0,
        };

        let observe_pending_finalization = async {
            tokio::time::sleep(Duration::from_millis(40)).await;
            let paths = paths.lock().await;
            assert!(
                paths.iter().any(|path| path.ends_with("/complete-run")),
                "complete-run must be in flight during the observation window"
            );
            assert!(
                paths.iter().any(|path| path.ends_with("/heartbeat")),
                "heartbeat must renew the lease while complete-run is pending"
            );
        };
        let (finalization_result, ()) = tokio::join!(
            handle_success(&client, &response, UsagePayload::default(),),
            observe_pending_finalization,
        );
        finalization_result.expect("atomic finalization should succeed");
        cancellation.cancel();
        heartbeat.await.expect("heartbeat task should stop");
        server.abort();
    }

    #[derive(Clone)]
    struct AgentE2eState {
        base_url: String,
        requests: Arc<Mutex<Vec<(String, serde_json::Value)>>>,
        checkpoint_fatal_error: bool,
    }

    async fn agent_e2e_handler(
        State(state): State<AgentE2eState>,
        request: Request<Body>,
    ) -> Json<serde_json::Value> {
        let path = request.uri().path().to_string();
        let body = to_bytes(request.into_body(), 1024 * 1024)
            .await
            .expect("e2e request body");
        let payload = serde_json::from_slice::<serde_json::Value>(&body)
            .unwrap_or_else(|_| serde_json::json!({}));
        state.requests.lock().await.push((path.clone(), payload));

        let response = match path.as_str() {
            "/api/internal/v1/agent-control/run-bootstrap" => serde_json::json!({
                "status": "running",
                "spaceId": "workspace-e2e",
                "threadId": "thread-e2e",
                "userId": "user-e2e",
                "agentType": "assistant"
            }),
            "/api/internal/v1/agent-control/run-config" => serde_json::json!({
                "systemPrompt": "You are the e2e agent.",
                "maxGraphSteps": 32,
                "maxToolRounds": 2,
                "temperature": 0
            }),
            "/api/internal/v1/agent-control/tool-catalog" => {
                serde_json::json!({ "tools": [] })
            }
            "/api/internal/v1/agent-control/conversation-history" => serde_json::json!({
                "history": [
                    { "role": "system", "content": "thread summary" },
                    { "role": "user", "content": "earlier question" },
                    { "role": "assistant", "content": "earlier answer" },
                    { "role": "user", "content": "current question" }
                ]
            }),
            "/api/internal/v1/agent-control/skill-runtime-context" => serde_json::json!({
                "skills": [],
                "managedSkills": [],
                "customSkills": []
            }),
            "/api/internal/v1/agent-control/api-keys" => serde_json::json!({
                "openai": "sk-e2e",
                "openaiEndpoint": format!("{}/v1/chat/completions", state.base_url)
            }),
            "/api/internal/v1/agent-control/engine-checkpoint-load" => serde_json::json!({
                "checkpoint": null,
                "usage": {
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "cachedInputTokens": 0
                },
                "fatalError": state.checkpoint_fatal_error.then_some(
                    crate::tool_bridge::UNCERTAIN_SIDE_EFFECT_FATAL_ERROR
                )
            }),
            "/v1/chat/completions" => serde_json::json!({
                "choices": [{
                    "message": { "content": "e2e completed", "tool_calls": [] }
                }],
                "usage": {
                    "prompt_tokens": 12,
                    "completion_tokens": 3,
                    "prompt_tokens_details": { "cached_tokens": 2 }
                }
            }),
            _ => serde_json::json!({}),
        };
        Json(response)
    }

    #[tokio::test]
    async fn execute_run_crosses_control_history_model_and_terminal_status() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("e2e listener");
        let address = listener.local_addr().expect("e2e address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = AgentE2eState {
            base_url: format!("http://{address}"),
            requests: requests.clone(),
            checkpoint_fatal_error: false,
        };
        let app = Router::new()
            .fallback(post(agent_e2e_handler))
            .with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("e2e server");
        });
        let payload = StartPayload {
            run_id: "run-e2e".to_string(),
            worker_id: "service-e2e".to_string(),
            service_id: Some("service-e2e".to_string()),
            model: Some("gpt-e2e".to_string()),
            lease_version: Some(1),
            executor_tier: Some(1),
            executor_container_id: Some("container-e2e".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: state.base_url,
            control_rpc_token: "token-e2e".to_string(),
        };

        execute_run(payload, CancellationToken::new())
            .await
            .expect("full execute_run path");
        server.abort();
        let requests = requests.lock().await.clone();
        let model_request = requests
            .iter()
            .find(|(path, _)| path == "/v1/chat/completions")
            .map(|(_, body)| body)
            .expect("model request");
        let messages = model_request["messages"]
            .as_array()
            .expect("model messages");
        assert!(messages
            .iter()
            .any(|message| message["content"] == "earlier answer"));
        assert!(messages.iter().any(|message| {
            message["role"] == "user"
                && message["content"]
                    .as_str()
                    .is_some_and(|content| content.contains("current question"))
        }));
        let checkpoint_saves = requests
            .iter()
            .filter(|(path, _)| path.ends_with("/engine-checkpoint-save"))
            .map(|(_, body)| body)
            .collect::<Vec<_>>();
        assert!(checkpoint_saves.iter().any(|body| {
            body["usage"]
                == serde_json::json!({
                    "inputTokens": 12,
                    "outputTokens": 3,
                    "cachedInputTokens": 2
                })
        }));

        let completion = requests
            .iter()
            .find(|(path, _)| path.ends_with("/complete-run"))
            .map(|(_, body)| body)
            .expect("atomic complete-run request");
        assert_eq!(completion["status"], "completed");
        assert_eq!(completion["output"], "e2e completed");
        assert_eq!(completion["usage"]["inputTokens"], 12);
        assert_eq!(completion["usage"]["cachedInputTokens"], 2);
        assert_eq!(completion["messages"][0]["content"], "e2e completed");
        assert!(!requests
            .iter()
            .any(|(path, _)| path.ends_with("/add-message")));
        assert!(!requests
            .iter()
            .any(|(path, _)| path.ends_with("/update-run-status")));
    }

    #[tokio::test]
    async fn recovered_uncertain_side_effect_terminalizes_without_model_or_tool_replay() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("e2e listener");
        let address = listener.local_addr().expect("e2e address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let state = AgentE2eState {
            base_url: format!("http://{address}"),
            requests: requests.clone(),
            checkpoint_fatal_error: true,
        };
        let app = Router::new()
            .fallback(post(agent_e2e_handler))
            .with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.expect("e2e server");
        });
        let payload = StartPayload {
            run_id: "run-uncertain-recovery".to_string(),
            worker_id: "service-uncertain-recovery".to_string(),
            service_id: Some("service-uncertain-recovery".to_string()),
            model: Some("gpt-e2e".to_string()),
            lease_version: Some(2),
            executor_tier: Some(1),
            executor_container_id: Some("container-uncertain-recovery".to_string()),
            checkpoint_protocol_version: Some(1),
            control_rpc_base_url: state.base_url,
            control_rpc_token: "token-e2e".to_string(),
        };

        execute_run(payload, CancellationToken::new())
            .await
            .expect("uncertain recovery should terminalize safely");
        server.abort();
        let requests = requests.lock().await.clone();
        assert!(
            !requests
                .iter()
                .any(|(path, _)| path == "/v1/chat/completions"),
            "recovery must not invoke the model"
        );
        assert!(
            !requests
                .iter()
                .any(|(path, _)| path.ends_with("/tool-execute")),
            "recovery must not replay a tool"
        );
        let completion = requests
            .iter()
            .find(|(path, _)| path.ends_with("/complete-run"))
            .map(|(_, body)| body)
            .expect("uncertain recovery must use atomic terminal completion");
        assert_eq!(completion["status"], "failed");
        assert!(completion["error"]
            .as_str()
            .is_some_and(|error| error.contains("side-effect outcome is uncertain")));
        assert!(completion["messages"]
            .as_array()
            .and_then(|messages| messages.last())
            .and_then(|message| message["content"].as_str())
            .is_some_and(|content| content.contains("do not retry blindly")));
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
            tool("web_fetch"),
            tool("create_artifact"),
            tool("skill_list"),
        ]);

        let selected = select_model_tools(&tools);
        let names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(names, vec!["toolbox", "web_fetch", "create_artifact"]);
    }

    #[test]
    fn select_model_tools_uses_full_catalog_when_toolbox_is_missing() {
        let tools = vec![
            tool("web_fetch"),
            tool("create_artifact"),
            tool("info_unit_search"),
            tool("skill_list"),
        ];

        let selected = select_model_tools(&tools);
        let names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            vec![
                "web_fetch",
                "create_artifact",
                "info_unit_search",
                "skill_list"
            ]
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
        let state = ServiceState::new(1);
        let run_1 = start_payload("run-1", "service-1", 1);
        let run_2 = start_payload("run-2", "service-2", 1);

        assert!(matches!(
            state.try_register_run(&run_1),
            RunAdmission::Registered {
                replaced: false,
                ..
            }
        ));
        assert!(matches!(
            state.try_register_run(&run_1),
            RunAdmission::Duplicate
        ));
        assert!(matches!(
            state.try_register_run(&run_2),
            RunAdmission::AtCapacity { active: 1, max: 1 }
        ));
    }

    #[test]
    fn run_admission_replaces_a_stale_lease_and_fences_old_slot_cleanup() {
        let state = ServiceState::new(1);
        let old_payload = start_payload("run-1", "service-old", 1);
        let new_payload = start_payload("run-1", "service-new", 2);

        let (old_identity, old_token) = match state.try_register_run(&old_payload) {
            RunAdmission::Registered {
                identity,
                cancellation_token,
                replaced: false,
            } => (identity, cancellation_token),
            other => panic!("unexpected admission: {other:?}"),
        };
        let (new_identity, new_token) = match state.try_register_run(&new_payload) {
            RunAdmission::Registered {
                identity,
                cancellation_token,
                replaced: true,
            } => (identity, cancellation_token),
            other => panic!("unexpected replacement admission: {other:?}"),
        };

        assert!(old_token.is_cancelled());
        assert!(!new_token.is_cancelled());
        assert_eq!(state.active_run_count(), 1);

        // The old task can finish after the replacement started. Its guard
        // must not remove the fresh lease's registry entry.
        state.finish_run("run-1", &old_identity);
        assert_eq!(state.active_run_count(), 1);
        state.finish_run("run-1", &new_identity);
        assert_eq!(state.active_run_count(), 0);
    }

    #[test]
    fn shutdown_rejects_new_starts_without_user_cancelling_active_runs() {
        let state = ServiceState::new(2);
        let first = start_payload("run-1", "service-1", 1);
        let replacement = start_payload("run-1", "service-2", 2);
        let second = start_payload("run-2", "service-3", 1);
        let first_token = match state.try_register_run(&first) {
            RunAdmission::Registered {
                cancellation_token, ..
            } => cancellation_token,
            other => panic!("unexpected first admission: {other:?}"),
        };

        state.begin_shutdown();

        assert!(state.is_shutting_down());
        assert!(!first_token.is_cancelled());
        assert!(matches!(
            state.try_register_run(&replacement),
            RunAdmission::ShuttingDown
        ));
        assert!(matches!(
            state.try_register_run(&second),
            RunAdmission::ShuttingDown
        ));
        assert_eq!(state.active_run_count(), 1);
    }
}
