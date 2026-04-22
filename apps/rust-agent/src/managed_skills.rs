use crate::control_rpc::{ActivatedSkill, SkillExecutionContract};
use crate::prompt_assets::{
    PLANNING_STRUCTURER_EN_MARKDOWN, PLANNING_STRUCTURER_JA_MARKDOWN,
    REPO_APP_OPERATOR_EN_MARKDOWN, REPO_APP_OPERATOR_JA_MARKDOWN, RESEARCH_BRIEF_EN_MARKDOWN,
    RESEARCH_BRIEF_JA_MARKDOWN, SLIDES_AUTHOR_EN_MARKDOWN, SLIDES_AUTHOR_JA_MARKDOWN,
    WRITING_DRAFT_EN_MARKDOWN, WRITING_DRAFT_JA_MARKDOWN,
};

// Fallback-only managed skill catalog used when control RPC does not provide
// managed skills in skill runtime context payloads.
pub fn localized_managed_skills(locale: &str) -> Vec<ActivatedSkill> {
    match locale {
        "ja" => vec![
            managed_skill(
                "research-brief",
                "1.0.0",
                "managed",
                "research",
                100,
                "ja",
                "調査ブリーフ",
                "トピックを調査し、根拠を比較しながら要点を整理して返す。",
                RESEARCH_BRIEF_JA_MARKDOWN.trim(),
                &["調査", "リサーチ", "要約", "比較", "根拠", "出典", "ファクトチェック", "分析"],
                &["research", "summary", "evidence", "comparison"],
                contract(
                    &["web_fetch", "search", "create_artifact"],
                    &["artifact"],
                    &["chat", "artifact"],
                    &[],
                    &["research-brief"],
                ),
            ),
            managed_skill(
                "writing-draft",
                "1.0.0",
                "managed",
                "writing",
                90,
                "ja",
                "文章ドラフト",
                "ラフな意図を文書、メール、レポート、投稿文の形に落とし込む。",
                WRITING_DRAFT_JA_MARKDOWN.trim(),
                &["文章", "ドラフト", "下書き", "書いて", "書き直し", "メール", "レポート", "記事", "投稿"],
                &["writing", "draft", "rewrite", "communication"],
                contract(&["create_artifact"], &["artifact"], &["chat", "artifact"], &[], &["writing-draft"]),
            ),
            managed_skill(
                "planning-structurer",
                "1.0.0",
                "managed",
                "planning",
                80,
                "ja",
                "計画ストラクチャ",
                "目標、制約、マイルストーン、次の一手を整理して実行可能な形にする。",
                PLANNING_STRUCTURER_JA_MARKDOWN.trim(),
                &["計画", "プラン", "ロードマップ", "マイルストーン", "段取り", "整理", "次の一手", "進め方"],
                &["plan", "roadmap", "milestone", "organization"],
                contract(
                    &["create_artifact", "set_reminder", "recall"],
                    &["artifact", "reminder"],
                    &["chat", "artifact", "reminder"],
                    &[],
                    &["planning-structurer"],
                ),
            ),
            managed_skill(
                "slides-author",
                "1.0.0",
                "managed",
                "slides",
                95,
                "ja",
                "スライド作成",
                "プレゼン資料の構成、各スライドの内容、話す流れを組み立てる。",
                SLIDES_AUTHOR_JA_MARKDOWN.trim(),
                &["スライド", "資料", "プレゼン", "発表", "デッキ", "PPTX", "パワポ"],
                &["slides", "presentation", "deck", "narrative"],
                contract(
                    &["create_artifact", "space_files_write"],
                    &["artifact", "workspace_file"],
                    &["chat", "artifact", "workspace_file"],
                    &[],
                    &["slides-outline", "speaker-notes"],
                ),
            ),
            managed_skill(
                "repo-app-operator",
                "1.0.0",
                "managed",
                "software",
                110,
                "ja",
                "リポジトリ/アプリ運用",
                "ソフトウェア資産を repo と app として取得・作成・変更・公開する。",
                REPO_APP_OPERATOR_JA_MARKDOWN.trim(),
                &["リポジトリ", "repo", "API", "アプリ", "デプロイ", "worker", "ツール", "自動化", "サービス", "エンドポイント"],
                &["repo", "software", "deploy", "app", "automation"],
                contract(
                    &[
                        "store_search",
                        "repo_fork",
                        "create_repository",
                        "container_start",
                        "runtime_exec",
                        "container_commit",
                        "group_deployment_snapshot_deploy_from_repo",
                    ],
                    &["repo", "app", "artifact"],
                    &["chat", "repo", "app", "artifact"],
                    &[],
                    &["repo-app-bootstrap", "api-worker"],
                ),
            ),
        ],
        _ => vec![
            managed_skill(
                "research-brief",
                "1.0.0",
                "managed",
                "research",
                100,
                "en",
                "Research Brief",
                "Investigate a topic, gather evidence, compare sources, and summarize the result clearly.",
                RESEARCH_BRIEF_EN_MARKDOWN.trim(),
                &["research", "investigate", "analyze", "compare", "summarize", "sources", "fact check"],
                &["research", "summary", "evidence", "comparison"],
                contract(
                    &["web_fetch", "search", "create_artifact"],
                    &["artifact"],
                    &["chat", "artifact"],
                    &[],
                    &["research-brief"],
                ),
            ),
            managed_skill(
                "writing-draft",
                "1.0.0",
                "managed",
                "writing",
                90,
                "en",
                "Writing Draft",
                "Turn rough intent into a draft, rewrite, report, email, or polished written output.",
                WRITING_DRAFT_EN_MARKDOWN.trim(),
                &["write", "draft", "rewrite", "email", "post", "article", "copy", "document"],
                &["writing", "draft", "rewrite", "communication"],
                contract(&["create_artifact"], &["artifact"], &["chat", "artifact"], &[], &["writing-draft"]),
            ),
            managed_skill(
                "planning-structurer",
                "1.0.0",
                "managed",
                "planning",
                80,
                "en",
                "Planning Structurer",
                "Clarify goals, scope, milestones, and next steps for a project or task.",
                PLANNING_STRUCTURER_EN_MARKDOWN.trim(),
                &["plan", "roadmap", "milestone", "schedule", "break down", "organize", "next steps"],
                &["plan", "roadmap", "milestone", "organization"],
                contract(
                    &["create_artifact", "set_reminder", "recall"],
                    &["artifact", "reminder"],
                    &["chat", "artifact", "reminder"],
                    &[],
                    &["planning-structurer"],
                ),
            ),
            managed_skill(
                "slides-author",
                "1.0.0",
                "managed",
                "slides",
                95,
                "en",
                "Slides Author",
                "Design slide decks, presentation structures, and speaking outlines.",
                SLIDES_AUTHOR_EN_MARKDOWN.trim(),
                &["slides", "slide deck", "presentation", "pptx", "powerpoint", "keynote"],
                &["slides", "presentation", "deck", "narrative"],
                contract(
                    &["create_artifact", "space_files_write"],
                    &["artifact", "workspace_file"],
                    &["chat", "artifact", "workspace_file"],
                    &[],
                    &["slides-outline", "speaker-notes"],
                ),
            ),
            managed_skill(
                "repo-app-operator",
                "1.0.0",
                "managed",
                "software",
                110,
                "en",
                "Repo App Operator",
                "Acquire, create, modify, and deploy software assets as repos and apps on Takos.",
                REPO_APP_OPERATOR_EN_MARKDOWN.trim(),
                &["repo", "repository", "deploy", "app", "api", "worker", "tool", "automation", "service", "endpoint"],
                &["repo", "software", "deploy", "app", "automation"],
                contract(
                    &[
                        "store_search",
                        "repo_fork",
                        "create_repository",
                        "container_start",
                        "runtime_exec",
                        "container_commit",
                        "group_deployment_snapshot_deploy_from_repo",
                    ],
                    &["repo", "app", "artifact"],
                    &["chat", "repo", "app", "artifact"],
                    &[],
                    &["repo-app-bootstrap", "api-worker"],
                ),
            ),
        ],
    }
}

#[allow(clippy::too_many_arguments)]
fn managed_skill(
    id: &str,
    version: &str,
    source: &str,
    category: &str,
    priority: i32,
    locale: &str,
    name: &str,
    description: &str,
    instructions: &str,
    triggers: &[&str],
    activation_tags: &[&str],
    execution_contract: SkillExecutionContract,
) -> ActivatedSkill {
    ActivatedSkill {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        source: source.to_string(),
        category: Some(category.to_string()),
        locale: Some(locale.to_string()),
        version: Some(version.to_string()),
        triggers: triggers.iter().map(|value| (*value).to_string()).collect(),
        activation_tags: activation_tags
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        instructions: instructions.to_string(),
        execution_contract,
        availability: "available".to_string(),
        availability_reasons: Vec::new(),
        priority: Some(priority),
    }
}

fn contract(
    preferred_tools: &[&str],
    durable_output_hints: &[&str],
    output_modes: &[&str],
    required_mcp_servers: &[&str],
    template_ids: &[&str],
) -> SkillExecutionContract {
    SkillExecutionContract {
        preferred_tools: preferred_tools
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        durable_output_hints: durable_output_hints
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        output_modes: output_modes
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        required_mcp_servers: required_mcp_servers
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        template_ids: template_ids
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
    }
}
