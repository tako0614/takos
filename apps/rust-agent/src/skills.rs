#![allow(dead_code)]

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::control_rpc::{
    ActivatedSkill, SkillCatalogResponse, SkillPlanResponse, SkillResolutionContext,
    SkillRuntimeContextResponse, ToolDefinition,
};
use crate::managed_skills::localized_managed_skills;

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
    let locale = runtime_context
        .locale
        .as_deref()
        .and_then(|value| normalized_locale(Some(value)))
        .unwrap_or_else(|| resolve_skill_locale(&runtime_context.resolution_context));
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

    let control_skills_include_managed = runtime_context
        .skills
        .iter()
        .any(|skill| skill.source == "managed");

    let (mut skills, managed_source) = if control_skills_include_managed {
        (runtime_context.skills.clone(), Some("control".to_string()))
    } else if !runtime_context.managed_skills.is_empty() {
        let mut combined = runtime_context.managed_skills.clone();
        merge_unique_skills(&mut combined, runtime_context.custom_skills.clone());
        (combined, Some("control".to_string()))
    } else {
        let mut combined = localized_managed_skills(&locale);
        merge_unique_skills(&mut combined, runtime_context.custom_skills.clone());
        (combined, Some("fallback_local".to_string()))
    };
    merge_unique_skills(&mut skills, runtime_context.skills.clone());
    merge_unique_skills(&mut skills, runtime_context.custom_skills.clone());

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
        managed_source,
    }
}

fn merge_unique_skills(target: &mut Vec<ActivatedSkill>, extra: Vec<ActivatedSkill>) {
    let mut known = target
        .iter()
        .map(|skill| format!("{}:{}", skill.source, skill.id))
        .collect::<HashSet<_>>();

    for skill in extra {
        let key = format!("{}:{}", skill.source, skill.id);
        if known.insert(key) {
            target.push(skill);
        }
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

#[allow(dead_code)]
pub fn local_skill_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "skill_list".to_string(),
            description: "List custom skills configured for this space.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
        },
        ToolDefinition {
            name: "skill_get".to_string(),
            description: "Get a custom skill in this space by id.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "skill_id": { "type": "string", "description": "Skill id" }
                },
                "required": ["skill_id"]
            }),
        },
        ToolDefinition {
            name: "skill_context".to_string(),
            description:
                "List the agent-visible skill catalog, including managed skills and enabled custom skills."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "locale": {
                        "type": "string",
                        "description": "Optional locale for localized managed skill text (ja or en).",
                        "enum": ["ja", "en"]
                    }
                }
            }),
        },
        ToolDefinition {
            name: "skill_catalog".to_string(),
            description:
                "List the full agent-visible skill catalog, including managed skills and enabled custom skills."
                    .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "locale": {
                        "type": "string",
                        "description": "Optional locale for localized managed skill text (ja or en).",
                        "enum": ["ja", "en"]
                    }
                }
            }),
        },
        ToolDefinition {
            name: "skill_describe".to_string(),
            description: "Describe one managed or custom skill in detail.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "skill_ref": {
                        "type": "string",
                        "description": "Skill reference. Managed skills use the managed skill id; custom skills should use the skill id. When source is omitted, Takos resolves managed first, then custom by id, then custom by name."
                    },
                    "source": {
                        "type": "string",
                        "description": "Optional skill source hint.",
                        "enum": ["managed", "custom"]
                    },
                    "locale": {
                        "type": "string",
                        "description": "Optional locale for localized managed skill text (ja or en).",
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
            let skill = catalog
                .skills
                .iter()
                .filter(|skill| skill.source == "custom")
                .find(|skill| skill_id.as_deref().is_some_and(|id| skill.id == id))?;
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
            let skill_ref = string_arg(arguments, "skill_ref")?;
            let source_hint = string_arg(arguments, "source");
            let localized_catalog = localized_catalog_for_locale(catalog, &locale);
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
    let localized_catalog = localized_catalog_for_locale(catalog, locale);
    let entries = localized_catalog
        .skills
        .iter()
        .map(summarize_skill)
        .collect::<Vec<_>>();
    CatalogSummary {
        locale: localized_catalog.locale,
        count: entries.len(),
        entries,
    }
}

fn localized_catalog_for_locale(
    catalog: &SkillCatalogResponse,
    locale: &str,
) -> SkillCatalogResponse {
    if locale == catalog.locale {
        return catalog.clone();
    }
    if catalog.managed_source.as_deref() == Some("control") {
        return catalog.clone();
    }

    let skills = localized_managed_skills(locale)
        .into_iter()
        .map(|mut skill| {
            if let Some(existing) = catalog
                .skills
                .iter()
                .find(|existing| existing.source == "managed" && existing.id == skill.id)
            {
                skill.availability = existing.availability.clone();
                skill.availability_reasons = existing.availability_reasons.clone();
            }
            skill
        })
        .chain(
            catalog
                .skills
                .iter()
                .filter(|skill| skill.source == "custom")
                .cloned(),
        )
        .collect::<Vec<_>>();

    SkillCatalogResponse {
        locale: locale.to_string(),
        skills,
        resolution_context: catalog.resolution_context.clone(),
        managed_source: catalog.managed_source.clone(),
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
        Some("managed") => catalog
            .skills
            .iter()
            .find(|skill| skill.source == "managed" && skill.id == skill_ref),
        Some("custom") => catalog.skills.iter().find(|skill| {
            skill.source == "custom" && (skill.id == skill_ref || skill.name == skill_ref)
        }),
        _ => catalog
            .skills
            .iter()
            .find(|skill| skill.source == "managed" && skill.id == skill_ref)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control_rpc::SkillExecutionContract;
    use serde_json::json;

    #[allow(clippy::too_many_arguments)]
    fn custom_skill(
        id: &str,
        name: &str,
        category: &str,
        instructions: &str,
        triggers: &[&str],
        preferred_tools: &[&str],
        required_mcp_servers: &[&str],
        template_ids: &[&str],
    ) -> ActivatedSkill {
        ActivatedSkill {
            id: id.to_string(),
            name: name.to_string(),
            description: format!("{name} description"),
            source: "custom".to_string(),
            category: Some(category.to_string()),
            locale: Some("en".to_string()),
            version: None,
            triggers: triggers.iter().map(|value| (*value).to_string()).collect(),
            activation_tags: vec![category.to_string()],
            instructions: instructions.to_string(),
            execution_contract: SkillExecutionContract {
                preferred_tools: preferred_tools
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
                durable_output_hints: vec![],
                output_modes: vec!["chat".to_string()],
                required_mcp_servers: required_mcp_servers
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
                template_ids: template_ids
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
            },
            availability: "available".to_string(),
            availability_reasons: vec![],
            priority: Some(50),
        }
    }

    fn runtime_context(
        conversation: &[&str],
        run_input: Value,
        custom_skills: Vec<ActivatedSkill>,
    ) -> SkillRuntimeContextResponse {
        SkillRuntimeContextResponse {
            locale: None,
            skills: vec![],
            managed_skills: vec![],
            custom_skills,
            resolution_context: SkillResolutionContext {
                conversation: conversation
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
                thread_title: Some("Deploy repository app".to_string()),
                run_input,
                agent_type: Some("implementer".to_string()),
                ..SkillResolutionContext::default()
            },
            available_mcp_server_names: vec!["github".to_string()],
            available_template_ids: vec![
                "custom-template".to_string(),
                "repo-app-bootstrap".to_string(),
                "api-worker".to_string(),
            ],
        }
    }

    fn runtime_context_with_control_skills(
        locale: Option<&str>,
        skills: Vec<ActivatedSkill>,
        custom_skills: Vec<ActivatedSkill>,
    ) -> SkillRuntimeContextResponse {
        SkillRuntimeContextResponse {
            locale: locale.map(ToString::to_string),
            managed_skills: skills
                .iter()
                .filter(|skill| skill.source == "managed")
                .cloned()
                .collect(),
            skills,
            custom_skills,
            resolution_context: SkillResolutionContext {
                conversation: vec!["Build and deploy this repo app".to_string()],
                thread_title: Some("Deploy repository app".to_string()),
                run_input: json!({}),
                agent_type: Some("implementer".to_string()),
                ..SkillResolutionContext::default()
            },
            available_mcp_server_names: vec!["github".to_string()],
            available_template_ids: vec![
                "custom-template".to_string(),
                "repo-app-bootstrap".to_string(),
                "api-worker".to_string(),
            ],
        }
    }

    fn tool_names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn build_skill_catalog_merges_managed_and_custom_skills() {
        let context = runtime_context(
            &["このAPIをリポジトリからデプロイしたい"],
            json!({}),
            vec![
                custom_skill(
                    "custom-plan",
                    "Space Planner",
                    "planning",
                    "Create space-specific plans.",
                    &["space", "plan"],
                    &["create_artifact"],
                    &[],
                    &[],
                ),
                custom_skill(
                    "custom-secure",
                    "Secure MCP Skill",
                    "software",
                    "Requires a private MCP server.",
                    &["secure"],
                    &["runtime_exec"],
                    &["private-server"],
                    &["missing-template"],
                ),
            ],
        );

        let catalog = build_skill_catalog(
            &context,
            &tool_names(&[
                "create_artifact",
                "runtime_exec",
                "store_search",
                "repo_fork",
                "create_repository",
                "container_start",
                "container_commit",
                "group_deployment_snapshot_deploy_from_repo",
            ]),
        );

        assert_eq!(catalog.locale, "ja");
        assert!(catalog
            .skills
            .iter()
            .any(|skill| skill.id == "research-brief"));
        let planner = catalog
            .skills
            .iter()
            .find(|skill| skill.id == "custom-plan")
            .expect("custom skill should be present");
        assert_eq!(planner.availability, "available");

        let secure = catalog
            .skills
            .iter()
            .find(|skill| skill.id == "custom-secure")
            .expect("restricted custom skill should be present");
        assert_eq!(secure.availability, "unavailable");
        assert!(secure
            .availability_reasons
            .iter()
            .any(|reason| reason.contains("missing required MCP servers")));
        assert!(secure
            .availability_reasons
            .iter()
            .any(|reason| reason.contains("missing required templates")));
        assert_eq!(catalog.managed_source.as_deref(), Some("fallback_local"));
    }

    #[test]
    fn build_skill_catalog_prefers_control_managed_skills_when_available() {
        let mut control_managed = localized_managed_skills("en")
            .into_iter()
            .find(|skill| skill.id == "research-brief")
            .expect("research-brief fallback skill should exist");
        control_managed.name = "Control Managed Research".to_string();

        let context =
            runtime_context_with_control_skills(Some("en"), vec![control_managed.clone()], vec![]);
        let catalog = build_skill_catalog(&context, &tool_names(&["search", "web_fetch"]));

        let skill = catalog
            .skills
            .iter()
            .find(|entry| entry.id == "research-brief")
            .expect("research-brief should be present");
        assert_eq!(skill.name, "Control Managed Research");
        assert_eq!(catalog.managed_source.as_deref(), Some("control"));
    }

    #[test]
    fn build_skill_catalog_uses_local_fallback_when_control_has_no_managed_skills() {
        let custom = custom_skill(
            "custom-plan",
            "Space Planner",
            "planning",
            "Create space-specific plans.",
            &["space", "plan"],
            &["create_artifact"],
            &[],
            &[],
        );
        let context =
            runtime_context_with_control_skills(Some("en"), vec![custom.clone()], vec![custom]);
        let catalog = build_skill_catalog(&context, &tool_names(&["create_artifact"]));

        assert!(catalog
            .skills
            .iter()
            .any(|skill| skill.id == "research-brief" && skill.source == "managed"));
        assert_eq!(catalog.managed_source.as_deref(), Some("fallback_local"));
    }

    #[test]
    fn resolve_skill_plan_prefers_repo_operator_for_software_work() {
        let context = runtime_context(
            &["Deploy this repository as an API app and wire the endpoint with automation."],
            json!({
                "task": "Create a deployable Worker API from the current repo",
                "goal": "ship a repo-backed app",
            }),
            vec![custom_skill(
                "custom-notes",
                "Workspace Notes",
                "writing",
                "Write notes.",
                &["notes"],
                &["create_artifact"],
                &[],
                &[],
            )],
        );
        let catalog = build_skill_catalog(
            &context,
            &tool_names(&[
                "store_search",
                "repo_fork",
                "create_repository",
                "container_start",
                "runtime_exec",
                "container_commit",
                "group_deployment_snapshot_deploy_from_repo",
                "create_artifact",
            ]),
        );
        let repo_skill = catalog
            .skills
            .iter()
            .find(|skill| skill.id == "repo-app-operator")
            .expect("repo skill should be present");
        assert_ne!(repo_skill.availability, "unavailable");
        assert!(
            score_skill(repo_skill, &catalog.resolution_context).is_some(),
            "repo skill should receive a positive score for software-oriented context"
        );

        let plan = resolve_skill_plan(&catalog);

        assert!(!plan.activated_skills.is_empty());
        assert!(plan
            .activated_skills
            .iter()
            .any(|skill| skill.id == "repo-app-operator"));
    }

    #[test]
    fn local_skill_tools_expose_only_custom_entries_for_list_and_get() {
        let context = runtime_context(
            &["Need a space plan"],
            json!({}),
            vec![custom_skill(
                "custom-plan",
                "Space Planner",
                "planning",
                "Create space-specific plans.",
                &["space", "plan"],
                &["create_artifact"],
                &[],
                &[],
            )],
        );
        let catalog = build_skill_catalog(&context, &tool_names(&["create_artifact"]));

        let list_payload = execute_local_skill_tool("skill_list", &json!({}), &catalog)
            .expect("skill_list should return a payload");
        let list_value: Value = serde_json::from_str(&list_payload).expect("valid JSON payload");
        assert_eq!(list_value["count"].as_u64(), Some(1));

        let get_payload =
            execute_local_skill_tool("skill_get", &json!({ "skill_id": "custom-plan" }), &catalog)
                .expect("skill_get should return a payload");
        let get_value: Value = serde_json::from_str(&get_payload).expect("valid JSON payload");
        assert_eq!(get_value["skill"]["id"].as_str(), Some("custom-plan"));
        assert_eq!(get_value["skill"]["source"].as_str(), Some("custom"));
    }

    #[test]
    fn skill_describe_supports_locale_override_for_managed_skills() {
        let context = runtime_context(&["Need research"], json!({}), vec![]);
        let catalog = build_skill_catalog(&context, &tool_names(&["search", "web_fetch"]));

        let payload = execute_local_skill_tool(
            "skill_describe",
            &json!({
                "skill_ref": "research-brief",
                "source": "managed",
                "locale": "ja",
            }),
            &catalog,
        )
        .expect("skill_describe should return a payload");
        let value: Value = serde_json::from_str(&payload).expect("valid JSON payload");
        assert_eq!(value["skill"]["id"].as_str(), Some("research-brief"));
        assert_eq!(value["skill"]["name"].as_str(), Some("調査ブリーフ"));
        assert_eq!(value["skill"]["source"].as_str(), Some("managed"));
    }

    #[test]
    fn skill_describe_keeps_control_managed_content_when_locale_overridden() {
        let mut control_managed = localized_managed_skills("en")
            .into_iter()
            .find(|skill| skill.id == "research-brief")
            .expect("research-brief fallback skill should exist");
        control_managed.name = "Control Managed Research".to_string();

        let context =
            runtime_context_with_control_skills(Some("en"), vec![control_managed], vec![]);
        let catalog = build_skill_catalog(&context, &tool_names(&["search", "web_fetch"]));

        let payload = execute_local_skill_tool(
            "skill_describe",
            &json!({
                "skill_ref": "research-brief",
                "source": "managed",
                "locale": "ja",
            }),
            &catalog,
        )
        .expect("skill_describe should return a payload");
        let value: Value = serde_json::from_str(&payload).expect("valid JSON payload");

        assert_eq!(
            value["skill"]["name"].as_str(),
            Some("Control Managed Research")
        );
    }
}
