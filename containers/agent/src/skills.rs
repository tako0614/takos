use std::collections::HashSet;

use serde_json::{json, Value};

use crate::control_rpc::{
    ActivatedSkill, SkillCatalogResponse, SkillResolutionContext, SkillRuntimeContextResponse,
};
use crate::managed_skills::localized_managed_skills;

pub const LOCAL_SKILL_TOOL_NAMES: [&str; 5] = [
    "skill_list",
    "skill_get",
    "skill_context",
    "skill_catalog",
    "skill_describe",
];

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
        .map(std::string::String::as_str)
        .collect::<HashSet<_>>();
    let available_mcp_servers = runtime_context
        .available_mcp_server_names
        .iter()
        .map(std::string::String::as_str)
        .collect::<HashSet<_>>();
    let available_template_ids = runtime_context
        .available_template_ids
        .iter()
        .map(std::string::String::as_str)
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
            runtime_context_with_control_skills(Some("en"), vec![control_managed], vec![]);
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
