use std::collections::HashSet;

use serde_json::Value;

use crate::control_rpc::{
    ActivatedSkill, SkillCatalogResponse, SkillResolutionContext, SkillRuntimeContextResponse,
};

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
        // The Worker catalog is the authority. A container-image snapshot must
        // never silently become model-visible when the control response is
        // empty or during a partial rollout.
        (
            runtime_context.custom_skills.clone(),
            Some("control".to_string()),
        )
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

#[must_use]
pub fn render_available_skill_context(catalog: &SkillCatalogResponse) -> Option<String> {
    let sections = catalog
        .skills
        .iter()
        .filter(|skill| skill.availability != "unavailable")
        .filter(|skill| !skill.instructions.trim().is_empty())
        .map(|skill| {
            format!(
                "## {} ({})\n{}",
                skill.name,
                skill.id,
                skill.instructions.trim()
            )
        })
        .collect::<Vec<_>>();
    if sections.is_empty() {
        None
    } else {
        Some(format!(
            "Active Workspace skills supplied by Takos Worker:\n\n{}",
            sections.join("\n\n")
        ))
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
    fn build_skill_catalog_evaluates_control_supplied_custom_skills() {
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
                    &["web_fetch"],
                    &["private-server"],
                    &["missing-template"],
                ),
            ],
        );

        let catalog = build_skill_catalog(
            &context,
            &tool_names(&["create_artifact", "web_fetch", "store_search", "toolbox"]),
        );

        assert_eq!(catalog.locale, "ja");
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
        assert_eq!(catalog.managed_source.as_deref(), Some("control"));
    }

    #[test]
    fn build_skill_catalog_prefers_control_managed_skills_when_available() {
        let mut control_managed = custom_skill(
            "research-brief",
            "Research Brief",
            "research",
            "Research with citations.",
            &["research"],
            &["web_fetch"],
            &[],
            &[],
        );
        control_managed.source = "managed".to_string();
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
    fn build_skill_catalog_does_not_inject_local_fallback() {
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

        assert!(!catalog
            .skills
            .iter()
            .any(|skill| skill.id == "research-brief" && skill.source == "managed"));
        assert!(catalog
            .skills
            .iter()
            .any(|skill| skill.id == "custom-plan" && skill.source == "custom"));
        assert_eq!(catalog.managed_source.as_deref(), Some("control"));
    }

    #[test]
    fn render_available_skill_context_excludes_unavailable_skills() {
        let mut available = custom_skill(
            "available",
            "Available",
            "test",
            "Follow this instruction.",
            &[],
            &[],
            &[],
            &[],
        );
        available.availability = "available".to_string();
        let mut unavailable = available.clone();
        unavailable.id = "unavailable".to_string();
        unavailable.name = "Unavailable".to_string();
        unavailable.availability = "unavailable".to_string();
        let rendered = render_available_skill_context(&SkillCatalogResponse {
            skills: vec![available, unavailable],
            ..SkillCatalogResponse::default()
        })
        .expect("available skill context");

        assert!(rendered.contains("Follow this instruction."));
        assert!(!rendered.contains("Unavailable"));
    }
}
