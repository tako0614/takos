mod control_rpc;
mod engine_support;
mod managed_skills;
mod model;
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
use crate::skills::{build_skill_catalog, resolve_skill_plan};
use crate::tool_bridge::{CompositeToolExecutor, ToolExecutionRecord};

pub type AppResult<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

const DEFAULT_MAX_CONCURRENT_RUNS: usize = 5;
const OPENAI_MAX_TOOL_DEFINITIONS: usize = 128;
const TOOLBOX_TOOL_NAME: &str = "toolbox";
const DEFAULT_PRIORITY_TOOL_NAMES: [&str; 10] = [
    TOOLBOX_TOOL_NAME,
    "capability_search",
    "capability_families",
    "capability_describe",
    "capability_invoke",
    "skill_context",
    "skill_catalog",
    "skill_describe",
    "skill_list",
    "skill_get",
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
        let guard = self.active_runs.lock().expect("run registry lock poisoned");
        guard.len()
    }

    fn available_run_slots(&self) -> usize {
        self.max_concurrent_runs
            .saturating_sub(self.active_run_count())
    }

    fn try_register_run(&self, run_id: &str) -> RunAdmission {
        let mut guard = self.active_runs.lock().expect("run registry lock poisoned");
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
        let mut guard = self.active_runs.lock().expect("run registry lock poisoned");
        guard.remove(run_id);
    }
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

    let data_dir = env::var("TAKOS_RUST_AGENT_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/var/lib/takos/rust-agent"));
    std::fs::create_dir_all(&data_dir)?;

    let max_concurrent_runs = parse_max_concurrent_runs(env::var("MAX_CONCURRENT_RUNS").ok());
    let state = Arc::new(ServiceState::new(data_dir, max_concurrent_runs));
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

async fn health(State(state): State<Arc<ServiceState>>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "takos-rust-agent",
        "runs": {
            "active": state.active_run_count(),
            "max": state.max_concurrent_runs,
            "available": state.available_run_slots(),
        },
    }))
}

async fn start(
    State(state): State<Arc<ServiceState>>,
    Json(payload): Json<StartPayload>,
) -> (StatusCode, Json<Value>) {
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
    let exposed_tools = select_model_tools(&composite_tool_executor.exposed_tools(), &skill_plan);
    let model_runner = TakosModelRunner::new_with_openai_api_keys(
        payload.resolved_model(),
        run_config.temperature,
        collect_openai_api_keys(api_keys.openai, env::var("OPENAI_API_KEY").ok()),
        exposed_tools.clone(),
        usage_tracker,
    );
    let deps = build_engine_deps(
        &store_root,
        model_runner.clone(),
        composite_tool_executor.clone(),
    )?;
    let request =
        build_session_request(engine_session_id, user_message, &skill_plan, &exposed_tools);

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
                "thread_id": bootstrap.thread_id,
                "skill_count": skill_plan.activated_skills.len(),
                "remote_tool_count": tool_catalog.tools.len(),
                "model_tool_count": exposed_tools.len(),
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
    let _ = heartbeat_handle.await;

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
            handle_failure(&client, Some(&bootstrap.thread_id), &err, usage).await?;
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
    tool_executions: Vec<ToolExecutionRecord>,
) -> AppResult<()> {
    let status = run_status_for_loop(response.status.clone());
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
    thread_id: Option<&str>,
    err: &impl std::fmt::Display,
    usage: UsagePayload,
) -> AppResult<()> {
    let error_message = err.to_string();
    let status = if error_message.contains("operation cancelled") {
        "cancelled"
    } else {
        "failed"
    };
    client
        .update_run_status(status, usage.clone(), None, Some(&error_message))
        .await?;

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
                }
            }),
        )
        .await
        .ok();
    Ok(())
}

fn user_visible_failure_message(error: &str) -> String {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("incorrect api key")
        || normalized.contains("invalid_api_key")
        || (normalized.contains("401 unauthorized") && normalized.contains("openai"))
    {
        return "The agent could not call the language model because the configured OpenAI API key is invalid. Update OPENAI_API_KEY for this environment and retry.".to_string();
    }
    if normalized.contains("api key is not configured")
        || normalized.contains("api key not configured")
    {
        return "The agent could not call the language model because no OpenAI API key is configured for this environment. Set OPENAI_API_KEY and retry.".to_string();
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
    skill_plan: &crate::control_rpc::SkillPlanResponse,
) -> Vec<crate::control_rpc::ToolDefinition> {
    if let Some(toolbox) = remote_tools
        .iter()
        .find(|tool| tool.name == TOOLBOX_TOOL_NAME)
    {
        return vec![toolbox.clone()];
    }

    let mut selected = Vec::new();
    let mut seen = HashSet::new();

    for name in DEFAULT_PRIORITY_TOOL_NAMES {
        push_tool_by_name(remote_tools, name, &mut selected, &mut seen);
    }
    for skill in &skill_plan.activated_skills {
        for name in &skill.execution_contract.preferred_tools {
            push_tool_by_name(remote_tools, name, &mut selected, &mut seen);
        }
    }
    for tool in remote_tools {
        push_tool(tool, &mut selected, &mut seen);
        if selected.len() >= OPENAI_MAX_TOOL_DEFINITIONS {
            break;
        }
    }

    selected
}

fn push_tool_by_name(
    tools: &[crate::control_rpc::ToolDefinition],
    name: &str,
    selected: &mut Vec<crate::control_rpc::ToolDefinition>,
    seen: &mut HashSet<String>,
) {
    if selected.len() >= OPENAI_MAX_TOOL_DEFINITIONS {
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
    if selected.len() >= OPENAI_MAX_TOOL_DEFINITIONS || !seen.insert(tool.name.clone()) {
        return false;
    }
    selected.push(tool.clone());
    true
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

#[cfg(test)]
mod tests {
    use super::{
        collect_openai_api_keys, parse_max_concurrent_runs, select_model_tools,
        user_visible_failure_message, RunAdmission, ServiceState, OPENAI_MAX_TOOL_DEFINITIONS,
    };
    use crate::control_rpc::{
        ActivatedSkill, SkillExecutionContract, SkillPlanResponse, ToolDefinition,
    };
    use std::path::PathBuf;

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
        assert_eq!(parse_max_concurrent_runs(Some("".to_string())), 5);
        assert_eq!(parse_max_concurrent_runs(Some("0".to_string())), 5);
        assert_eq!(parse_max_concurrent_runs(Some("invalid".to_string())), 5);
    }

    #[test]
    fn failure_message_for_invalid_openai_key_is_user_visible_and_sanitized() {
        let message = user_visible_failure_message(
            "model error: OpenAI chat completions failed: 401 Unauthorized {\"error\":{\"message\":\"Incorrect API key provided: sk-secret\"}}",
        );
        assert!(message.contains("OpenAI API key is invalid"));
        assert!(!message.contains("sk-secret"));
        assert!(!message.contains("401"));
    }

    #[test]
    fn failure_message_for_missing_openai_key_is_actionable() {
        let message = user_visible_failure_message("OpenAI API key is not configured");
        assert!(message.contains("no OpenAI API key is configured"));
        assert!(message.contains("OPENAI_API_KEY"));
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
    fn select_model_tools_caps_openai_tool_count_and_deduplicates_names() {
        let mut tools = (0..150)
            .map(|index| tool(&format!("tool_{index}")))
            .collect::<Vec<_>>();
        tools.push(tool("tool_1"));

        let selected = select_model_tools(&tools, &SkillPlanResponse::default());
        let unique_names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<std::collections::HashSet<_>>();

        assert_eq!(selected.len(), OPENAI_MAX_TOOL_DEFINITIONS);
        assert_eq!(unique_names.len(), OPENAI_MAX_TOOL_DEFINITIONS);
    }

    #[test]
    fn select_model_tools_uses_toolbox_as_single_router() {
        let mut tools = (0..300)
            .map(|index| tool(&format!("tool_{index}")))
            .collect::<Vec<_>>();
        tools.push(tool("toolbox"));
        let plan = SkillPlanResponse {
            activated_skills: vec![ActivatedSkill {
                id: "skill-1".to_string(),
                name: "Skill".to_string(),
                execution_contract: SkillExecutionContract {
                    preferred_tools: vec!["tool_299".to_string()],
                    ..SkillExecutionContract::default()
                },
                ..ActivatedSkill::default()
            }],
            ..SkillPlanResponse::default()
        };

        let selected = select_model_tools(&tools, &plan);

        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].name, "toolbox");
    }

    #[test]
    fn select_model_tools_prioritizes_skill_preferred_tools() {
        let tools = (0..150)
            .map(|index| tool(&format!("tool_{index}")))
            .collect::<Vec<_>>();
        let plan = SkillPlanResponse {
            activated_skills: vec![ActivatedSkill {
                id: "skill-1".to_string(),
                name: "Skill".to_string(),
                execution_contract: SkillExecutionContract {
                    preferred_tools: vec!["tool_149".to_string()],
                    ..SkillExecutionContract::default()
                },
                ..ActivatedSkill::default()
            }],
            ..SkillPlanResponse::default()
        };

        let selected = select_model_tools(&tools, &plan);

        assert_eq!(selected[0].name, "tool_149");
        assert_eq!(selected.len(), OPENAI_MAX_TOOL_DEFINITIONS);
    }

    #[test]
    fn select_model_tools_prioritizes_discovery_tools() {
        let mut tools = (0..150)
            .map(|index| tool(&format!("tool_{index}")))
            .collect::<Vec<_>>();
        tools.extend([
            tool("capability_search"),
            tool("capability_families"),
            tool("capability_describe"),
            tool("capability_invoke"),
        ]);

        let selected = select_model_tools(&tools, &SkillPlanResponse::default());
        let selected_names = selected
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();

        assert!(selected_names.contains(&"capability_search"));
        assert!(selected_names.contains(&"capability_families"));
        assert!(selected_names.contains(&"capability_describe"));
        assert!(selected_names.contains(&"capability_invoke"));
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
