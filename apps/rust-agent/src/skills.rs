use std::collections::HashSet;

use serde_json::{json, Value};

use crate::control_rpc::{
    ActivatedSkill, SkillCatalogResponse, SkillPlanResponse, SkillResolutionContext,
    SkillRuntimeContextResponse, ToolDefinition,
};
use crate::official_skills::localized_official_skills;

const CONVERSATION_WINDOW: usize = 8;
const MESSAGE_RECENCY_WEIGHTS: [f32; CONVERSATION_WINDOW] =
    [1.3, 1.1, 0.95, 0.8, 0.6, 0.45, 0.35, 0.25];
const MAX_SELECTED_SKILLS_PER_RUN: usize = 8;
const MAX_TOTAL_INSTRUCTION_BYTES: usize = 1_000_000;
const MAX_PER_SKILL_INSTRUCTION_BYTES: usize = 50_000;

pub const LOCAL_SKILL_TOOL_NAMES: [&str; 5] = [
    "skill_list",
    "skill_get",
    "skill_context",
    "skill_catalog",
    "skill_describe",
];

#[derive(Debug, Clone)]
struct ContextSegment {
    text: String,
    weight: f32,
}

#[derive(Debug, Clone)]
struct SkillSelection {
    skill: ActivatedSkill,
    score: f32,
}

#[derive(Debug, Clone)]
struct DelegationPacket {
    task: String,
    goal: Option<String>,
    deliverable: Option<String>,
    context: Vec<String>,
    acceptance_criteria: Vec<String>,
    product_hint: Option<String>,
}

pub fn build_skill_catalog(
    runtime_context: &SkillRuntimeContextResponse,
    available_tool_names: &[String],
) -> SkillCatalogResponse {
    let locale = resolve_skill_locale(&runtime_context.resolution_context);
    let available_tools = available_tool_names
        .iter()
        .map(|tool| tool.as_str())
        .collect::<HashSet<_>>();
    let available_mcp_servers = runtime_context
        .available_mcp_server_names
        .iter()
        .map(|name| name.as_str())
        .collect::<HashSet<_>>();
    let available_template_ids = runtime_context
        .available_template_ids
        .iter()
        .map(|id| id.as_str())
        .collect::<HashSet<_>>();

    let mut skills = localized_official_skills(&locale);
    skills.extend(runtime_context.custom_skills.clone());

    let skills = skills
        .into_iter()
        .map(|skill| {
            let (availability, availability_reasons) = evaluate_skill_availability(
                &skill,
                &available_tools,
                &available_mcp_servers,
                &available_template_ids,
            );
            ActivatedSkill {
                availability,
                availability_reasons,
                ..skill
            }
        })
        .collect();

    SkillCatalogResponse {
        locale,
        skills,
        resolution_context: runtime_context.resolution_context.clone(),
    }
}

pub fn resolve_skill_plan(catalog: &SkillCatalogResponse) -> SkillPlanResponse {
    let selected_skills = select_relevant_skills(&catalog.skills, &catalog.resolution_context);
    let activated_skills = activate_selected_skills(selected_skills);

    SkillPlanResponse {
        locale: catalog.locale.clone(),
        activated_skills,
    }
}

pub fn local_skill_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "skill_list".to_string(),
            description: "List custom skills configured for this workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "skill_get".to_string(),
            description:
                "Get a custom workspace skill by id. skill_name remains as a compatibility alias."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "skill_id": { "type": "string", "description": "Skill id" },
                    "skill_name": { "type": "string", "description": "Deprecated alias for skill name" }
                }
            }),
        },
        ToolDefinition {
            name: "skill_context".to_string(),
            description:
                "List the agent-visible skill catalog, including official skills and enabled custom skills."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "locale": {
                        "type": "string",
                        "description": "Optional locale for localized official skill text (ja or en).",
                        "enum": ["ja", "en"]
                    }
                }
            }),
        },
        ToolDefinition {
            name: "skill_catalog".to_string(),
            description:
                "List the full agent-visible skill catalog, including official and enabled custom skills."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "locale": {
                        "type": "string",
                        "description": "Optional locale for localized official skill text (ja or en).",
                        "enum": ["ja", "en"]
                    }
                }
            }),
        },
        ToolDefinition {
            name: "skill_describe".to_string(),
            description: "Describe one official or custom skill in detail.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "skill_ref": {
                        "type": "string",
                        "description": "Skill reference. Official skills use the official skill id; custom skills should use the skill id. When source is omitted, Takos resolves official first, then custom by id, then custom by name."
                    },
                    "source": {
                        "type": "string",
                        "description": "Optional skill source hint.",
                        "enum": ["official", "custom"]
                    },
                    "skill_id": {
                        "type": "string",
                        "description": "Deprecated alias for official skill id."
                    },
                    "skill_name": {
                        "type": "string",
                        "description": "Deprecated alias for custom skill name."
                    },
                    "locale": {
                        "type": "string",
                        "description": "Optional locale for localized official skill text (ja or en).",
                        "enum": ["ja", "en"]
                    }
                }
            }),
        },
    ]
}

pub fn execute_local_skill_tool(
    name: &str,
    arguments: &Value,
    catalog: &SkillCatalogResponse,
) -> Option<String> {
    match name {
        "skill_list" => Some(
            json!({
                "skills": catalog.skills.iter().filter(|skill| skill.source == "custom").map(format_skill).collect::<Vec<_>>(),
                "count": catalog.skills.iter().filter(|skill| skill.source == "custom").count(),
            })
            .to_string(),
        ),
        "skill_get" => {
            let skill_id = string_arg(arguments, "skill_id");
            let skill_name = string_arg(arguments, "skill_name");
            let skill = catalog
                .skills
                .iter()
                .filter(|skill| skill.source == "custom")
                .find(|skill| {
                    skill_id.as_deref().is_some_and(|id| skill.id == id)
                        || skill_name.as_deref().is_some_and(|name| skill.name == name)
                })?;
            Some(json!({ "skill": format_skill(skill) }).to_string())
        }
        "skill_context" => {
            let locale = string_arg(arguments, "locale").unwrap_or_else(|| catalog.locale.clone());
            let summary = summarize_catalog(catalog, &locale);
            Some(
                json!({
                    "locale": summary.locale,
                    "available_skills": summary.entries,
                    "context": summary.entries,
                    "count": summary.count,
                })
                .to_string(),
            )
        }
        "skill_catalog" => {
            let locale = string_arg(arguments, "locale").unwrap_or_else(|| catalog.locale.clone());
            let summary = summarize_catalog(catalog, &locale);
            Some(
                json!({
                    "locale": summary.locale,
                    "available_skills": summary.entries,
                    "count": summary.count,
                })
                .to_string(),
            )
        }
        "skill_describe" => {
            let locale = string_arg(arguments, "locale").unwrap_or_else(|| catalog.locale.clone());
            let skill_ref = string_arg(arguments, "skill_ref")
                .or_else(|| string_arg(arguments, "skill_id"))
                .or_else(|| string_arg(arguments, "skill_name"))?;
            let source_hint = string_arg(arguments, "source");
            let localized_catalog = if locale == catalog.locale {
                catalog.clone()
            } else {
                let runtime_context = SkillRuntimeContextResponse {
                    custom_skills: catalog
                        .skills
                        .iter()
                        .filter(|skill| skill.source == "custom")
                        .cloned()
                        .collect(),
                    resolution_context: catalog.resolution_context.clone(),
                    available_mcp_server_names: Vec::new(),
                    available_template_ids: Vec::new(),
                };
                build_skill_catalog(&runtime_context, &[])
            };
            let skill = describe_skill(&localized_catalog, &skill_ref, source_hint.as_deref())?;
            Some(json!({ "skill": format_skill(skill) }).to_string())
        }
        _ => None,
    }
}

fn resolve_skill_locale(input: &SkillResolutionContext) -> String {
    if let Some(locale) = locale_candidate(input.run_input.as_object(), &["skill_locale", "locale"])
    {
        return locale;
    }
    if let Some(locale) = normalized_locale(input.preferred_locale.as_deref()) {
        return locale;
    }
    if let Some(locale) = normalized_locale(input.space_locale.as_deref()) {
        return locale;
    }
    if let Some(locale) = locale_candidate(
        input.run_input.as_object(),
        &["accept_language", "acceptLanguage"],
    ) {
        return locale;
    }
    if let Some(locale) = normalized_locale(input.accept_language.as_deref()) {
        return locale;
    }

    let combined_samples = input
        .conversation
        .iter()
        .cloned()
        .chain(input.thread_title.clone())
        .chain(input.thread_summary.clone())
        .chain(input.thread_key_points.iter().cloned())
        .collect::<Vec<_>>()
        .join("\n");

    if contains_japanese(&combined_samples) {
        "ja".to_string()
    } else {
        "en".to_string()
    }
}

fn locale_candidate(
    source: Option<&serde_json::Map<String, Value>>,
    keys: &[&str],
) -> Option<String> {
    for key in keys {
        if let Some(locale) = source
            .and_then(|object| object.get(*key))
            .and_then(Value::as_str)
            .and_then(|value| normalized_locale(Some(value)))
        {
            return Some(locale);
        }
    }
    None
}

fn normalized_locale(value: Option<&str>) -> Option<String> {
    let value = value?.trim().to_lowercase();
    if value == "ja" || value.starts_with("ja-") {
        Some("ja".to_string())
    } else if value == "en" || value.starts_with("en-") {
        Some("en".to_string())
    } else {
        None
    }
}

fn contains_japanese(text: &str) -> bool {
    text.chars().any(|ch| {
        ('\u{3040}'..='\u{30ff}').contains(&ch) || ('\u{3400}'..='\u{9fff}').contains(&ch)
    })
}

fn evaluate_skill_availability(
    skill: &ActivatedSkill,
    available_tool_names: &HashSet<&str>,
    available_mcp_server_names: &HashSet<&str>,
    available_template_ids: &HashSet<&str>,
) -> (String, Vec<String>) {
    let mut reasons = Vec::new();

    let missing_required_mcp_servers = skill
        .execution_contract
        .required_mcp_servers
        .iter()
        .filter(|name| !available_mcp_server_names.contains(name.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_required_mcp_servers.is_empty() {
        reasons.push(format!(
            "missing required MCP servers: {}",
            missing_required_mcp_servers.join(", ")
        ));
    }

    let missing_templates = skill
        .execution_contract
        .template_ids
        .iter()
        .filter(|template_id| !available_template_ids.contains(template_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_templates.is_empty() {
        reasons.push(format!(
            "missing required templates: {}",
            missing_templates.join(", ")
        ));
    }

    let missing_preferred_tools = skill
        .execution_contract
        .preferred_tools
        .iter()
        .filter(|tool_name| !available_tool_names.contains(tool_name.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_preferred_tools.is_empty() {
        reasons.push(format!(
            "preferred tools not currently available: {}",
            missing_preferred_tools.join(", ")
        ));
    }

    if !missing_required_mcp_servers.is_empty() || !missing_templates.is_empty() {
        ("unavailable".to_string(), reasons)
    } else if !missing_preferred_tools.is_empty() {
        ("warning".to_string(), reasons)
    } else {
        ("available".to_string(), Vec::new())
    }
}

fn activate_selected_skills(selected_skills: Vec<SkillSelection>) -> Vec<ActivatedSkill> {
    let mut total_instruction_bytes = 0_usize;
    let mut activated = Vec::new();

    for selected in selected_skills {
        let instruction_bytes = selected.skill.instructions.len();
        if instruction_bytes > MAX_PER_SKILL_INSTRUCTION_BYTES {
            continue;
        }
        if total_instruction_bytes + instruction_bytes > MAX_TOTAL_INSTRUCTION_BYTES {
            break;
        }
        total_instruction_bytes += instruction_bytes;
        activated.push(selected.skill);
    }

    activated
}

fn select_relevant_skills(
    skills: &[ActivatedSkill],
    input: &SkillResolutionContext,
) -> Vec<SkillSelection> {
    let mut selected = skills
        .iter()
        .filter(|skill| skill.availability != "unavailable")
        .filter_map(|skill| score_skill(skill, input))
        .collect::<Vec<_>>();

    selected.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                right
                    .skill
                    .priority
                    .unwrap_or(0)
                    .cmp(&left.skill.priority.unwrap_or(0))
            })
    });
    selected.truncate(input.max_selected.unwrap_or(MAX_SELECTED_SKILLS_PER_RUN));
    selected
}

fn score_skill(skill: &ActivatedSkill, input: &SkillResolutionContext) -> Option<SkillSelection> {
    let segments = get_context_segments(input);
    if segments.is_empty() {
        return None;
    }

    let mut score = 0.0_f32;

    for segment in &segments {
        for trigger in &skill.triggers {
            if matches_phrase(&segment.text, trigger) {
                score += 12.0 * segment.weight;
            }
        }

        if matches_phrase(&segment.text, &skill.name) {
            score += 8.0 * segment.weight;
        }

        for tag in &skill.activation_tags {
            if matches_phrase(&segment.text, tag) {
                score += 5.0 * segment.weight;
            }
        }

        for tool_name in skill.execution_contract.preferred_tools.iter().take(8) {
            if matches_phrase(&segment.text, tool_name) {
                score += 3.0 * segment.weight;
            }
        }
    }

    if let Some(category) = skill.category.as_deref() {
        let category_keywords = category_keywords(category);
        if !category_keywords.is_empty()
            && segments.iter().any(|segment| {
                category_keywords
                    .iter()
                    .any(|term| matches_phrase(&segment.text, term))
            })
        {
            score += 6.0;
        }
    }

    for output_mode in &skill.execution_contract.output_modes {
        let output_keywords = output_mode_keywords(output_mode);
        if !output_keywords.is_empty()
            && segments.iter().any(|segment| {
                output_keywords
                    .iter()
                    .any(|term| matches_phrase(&segment.text, term))
            })
        {
            score += 4.0;
        }
    }

    let agent_type = input.agent_type.as_deref().unwrap_or("default");
    if let Some(category) = skill.category.as_deref() {
        if boosted_categories(agent_type).contains(&category) {
            score += 2.5;
        }
    }

    if score <= 0.0 {
        return None;
    }

    Some(SkillSelection {
        skill: skill.clone(),
        score,
    })
}

fn get_context_segments(input: &SkillResolutionContext) -> Vec<ContextSegment> {
    let mut segments = Vec::new();
    let recent_messages = input
        .conversation
        .iter()
        .map(|message| message.trim())
        .filter(|message| !message.is_empty())
        .rev()
        .take(CONVERSATION_WINDOW)
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    for (index, message) in recent_messages.iter().enumerate() {
        segments.push(ContextSegment {
            text: message.clone(),
            weight: *MESSAGE_RECENCY_WEIGHTS.get(index).unwrap_or(&0.15),
        });
    }

    if let Some(thread_title) = input
        .thread_title
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        segments.push(ContextSegment {
            text: thread_title.to_string(),
            weight: 1.15,
        });
    }

    if let Some(thread_summary) = input
        .thread_summary
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        segments.push(ContextSegment {
            text: thread_summary.to_string(),
            weight: 0.9,
        });
    }

    for key_point in input
        .thread_key_points
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .take(8)
    {
        segments.push(ContextSegment {
            text: key_point.to_string(),
            weight: 0.7,
        });
    }

    for field_name in ["task", "goal", "prompt", "title", "description"] {
        if let Some(value) = string_field(&input.run_input, field_name) {
            segments.push(ContextSegment {
                text: value,
                weight: 1.2,
            });
        }
    }

    if let Some(packet) = get_delegation_packet_from_run_input(&input.run_input) {
        segments.push(ContextSegment {
            text: packet.task,
            weight: 1.35,
        });
        if let Some(goal) = packet.goal {
            segments.push(ContextSegment {
                text: goal,
                weight: 1.15,
            });
        }
        if let Some(deliverable) = packet.deliverable {
            segments.push(ContextSegment {
                text: deliverable,
                weight: 1.0,
            });
        }
        if let Some(product_hint) = packet.product_hint {
            segments.push(ContextSegment {
                text: product_hint,
                weight: 0.95,
            });
        }
        for item in packet.context.into_iter().take(6) {
            segments.push(ContextSegment {
                text: item,
                weight: 0.9,
            });
        }
        for item in packet.acceptance_criteria.into_iter().take(4) {
            segments.push(ContextSegment {
                text: item,
                weight: 0.85,
            });
        }
    }

    segments
}

fn get_delegation_packet_from_run_input(run_input: &Value) -> Option<DelegationPacket> {
    let source = flatten_delegation_source(run_input)?;
    let task = map_string_field(source, "task")?;
    let _parent_run_id = map_string_field(source, "parent_run_id")?;
    let _parent_thread_id = map_string_field(source, "parent_thread_id")?;
    let _root_thread_id = map_string_field(source, "root_thread_id")?;

    Some(DelegationPacket {
        task,
        goal: map_string_field(source, "goal"),
        deliverable: map_string_field(source, "deliverable"),
        context: string_array_field(source, "context"),
        acceptance_criteria: string_array_field(source, "acceptance_criteria"),
        product_hint: map_string_field(source, "product_hint"),
    })
}

fn flatten_delegation_source(value: &Value) -> Option<&serde_json::Map<String, Value>> {
    let object = value.as_object()?;
    if let Some(delegation) = object.get("delegation").and_then(Value::as_object) {
        return Some(delegation);
    }
    Some(object)
}

fn string_field(source: &Value, key: &str) -> Option<String> {
    source
        .as_object()
        .and_then(|object| map_string_field(object, key))
}

fn map_string_field(source: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    source
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn string_array_field(source: &serde_json::Map<String, Value>, key: &str) -> Vec<String> {
    source
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    for ch in text.chars().flat_map(|ch| ch.to_lowercase()) {
        if ch.is_alphanumeric() || is_japanese(ch) {
            current.push(ch);
        } else if current.chars().count() >= 2 {
            tokens.push(std::mem::take(&mut current));
        } else {
            current.clear();
        }
    }
    if current.chars().count() >= 2 {
        tokens.push(current);
    }
    tokens
}

fn is_japanese(ch: char) -> bool {
    ('\u{3040}'..='\u{30ff}').contains(&ch) || ('\u{3400}'..='\u{9fff}').contains(&ch)
}

fn matches_phrase(text: &str, phrase: &str) -> bool {
    let normalized_text = text.to_lowercase();
    let normalized_phrase = phrase.trim().to_lowercase();
    if normalized_phrase.is_empty() {
        return false;
    }
    if normalized_text.contains(&normalized_phrase) {
        return true;
    }

    let text_tokens = tokenize(&normalized_text)
        .into_iter()
        .collect::<HashSet<_>>();
    let phrase_tokens = tokenize(&normalized_phrase);
    if phrase_tokens.is_empty() {
        return false;
    }
    phrase_tokens
        .into_iter()
        .all(|token| text_tokens.contains(&token))
}

fn category_keywords(category: &str) -> &'static [&'static str] {
    match category {
        "research" => &[
            "research",
            "investigate",
            "compare",
            "analysis",
            "sources",
            "latest",
            "調査",
            "比較",
            "分析",
            "根拠",
            "出典",
        ],
        "writing" => &[
            "write",
            "draft",
            "rewrite",
            "email",
            "report",
            "article",
            "文章",
            "下書き",
            "書き直し",
            "メール",
            "レポート",
        ],
        "planning" => &[
            "plan",
            "roadmap",
            "milestone",
            "organize",
            "next steps",
            "計画",
            "ロードマップ",
            "段取り",
            "進め方",
        ],
        "slides" => &[
            "slides",
            "deck",
            "presentation",
            "pptx",
            "スライド",
            "プレゼン",
            "資料",
            "パワポ",
        ],
        "software" => &[
            "repo",
            "repository",
            "api",
            "deploy",
            "tool",
            "automation",
            "app",
            "worker",
            "コード",
            "実装",
            "リポジトリ",
            "デプロイ",
            "自動化",
        ],
        _ => &[],
    }
}

fn output_mode_keywords(output_mode: &str) -> &'static [&'static str] {
    match output_mode {
        "artifact" => &[
            "artifact",
            "document",
            "doc",
            "保存",
            "残す",
            "文書",
            "成果物",
        ],
        "reminder" => &[
            "reminder",
            "follow up",
            "deadline",
            "通知",
            "リマインド",
            "フォローアップ",
        ],
        "repo" => &["repo", "repository", "git", "リポジトリ", "git"],
        "app" => &[
            "deploy",
            "publish",
            "app",
            "service",
            "公開",
            "デプロイ",
            "サービス",
        ],
        "workspace_file" => &["file", "pptx", "slides", "ファイル", "資料", "pptx"],
        _ => &[],
    }
}

fn boosted_categories(agent_type: &str) -> &'static [&'static str] {
    match agent_type {
        "researcher" => &["research"],
        "implementer" | "reviewer" => &["software"],
        "planner" => &["planning"],
        "assistant" => &["writing", "planning", "slides", "research"],
        _ => &["software", "planning", "research"],
    }
}

#[derive(Debug)]
struct CatalogSummary {
    locale: String,
    entries: Vec<Value>,
    count: usize,
}

fn summarize_catalog(catalog: &SkillCatalogResponse, locale: &str) -> CatalogSummary {
    let entries = if locale == catalog.locale {
        catalog
            .skills
            .iter()
            .map(summarize_skill)
            .collect::<Vec<_>>()
    } else {
        localized_official_skills(locale)
            .into_iter()
            .chain(
                catalog
                    .skills
                    .iter()
                    .filter(|skill| skill.source == "custom")
                    .cloned(),
            )
            .map(|skill| summarize_skill(&skill))
            .collect::<Vec<_>>()
    };
    CatalogSummary {
        locale: locale.to_string(),
        count: entries.len(),
        entries,
    }
}

fn summarize_skill(skill: &ActivatedSkill) -> Value {
    json!({
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "triggers": skill.triggers,
        "source": skill.source,
        "category": skill.category,
        "locale": skill.locale,
        "version": skill.version,
        "activation_tags": skill.activation_tags,
        "execution_contract": skill.execution_contract,
        "availability": skill.availability,
        "availability_reasons": skill.availability_reasons,
    })
}

fn format_skill(skill: &ActivatedSkill) -> Value {
    json!({
        "id": skill.id,
        "name": skill.name,
        "description": skill.description,
        "instructions": skill.instructions,
        "triggers": skill.triggers,
        "metadata": {
            "locale": skill.locale,
            "category": skill.category,
            "activation_tags": skill.activation_tags,
            "execution_contract": skill.execution_contract,
        },
        "source": skill.source,
        "editable": skill.source == "custom",
        "enabled": true,
        "availability": skill.availability,
        "availability_reasons": skill.availability_reasons,
    })
}

fn describe_skill<'a>(
    catalog: &'a SkillCatalogResponse,
    skill_ref: &str,
    source_hint: Option<&str>,
) -> Option<&'a ActivatedSkill> {
    let skill_ref = skill_ref.trim();
    match source_hint {
        Some("official") => catalog
            .skills
            .iter()
            .find(|skill| skill.source == "official" && skill.id == skill_ref),
        Some("custom") => catalog.skills.iter().find(|skill| {
            skill.source == "custom" && (skill.id == skill_ref || skill.name == skill_ref)
        }),
        _ => catalog
            .skills
            .iter()
            .find(|skill| skill.source == "official" && skill.id == skill_ref)
            .or_else(|| {
                catalog.skills.iter().find(|skill| {
                    skill.source == "custom" && (skill.id == skill_ref || skill.name == skill_ref)
                })
            }),
    }
}

fn string_arg(arguments: &Value, key: &str) -> Option<String> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}
