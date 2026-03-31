use crate::control_rpc::{ActivatedSkill, SkillExecutionContract};

pub fn localized_official_skills(locale: &str) -> Vec<ActivatedSkill> {
    match locale {
        "ja" => vec![
            official_skill(
                "research-brief",
                "1.0.0",
                "official",
                "research",
                100,
                "ja",
                "調査ブリーフ",
                "トピックを調査し、根拠を比較しながら要点を整理して返す。",
                "調査系の依頼では、先に事実収集を行い、その後で結論を出す。最新性が重要なら現在の情報を優先し、不確実な話題では複数ソースを照合し、確認できた事実と推測を分けて要約や brief を返す。",
                &["調査", "リサーチ", "要約", "比較", "根拠", "出典", "ファクトチェック", "分析"],
                &["research", "summary", "evidence", "comparison"],
                contract(
                    &["browser_open", "browser_goto", "browser_extract", "browser_screenshot", "web_fetch", "search", "create_artifact"],
                    &["artifact"],
                    &["chat", "artifact"],
                    &[],
                    &["research-brief"],
                ),
            ),
            official_skill(
                "writing-draft",
                "1.0.0",
                "official",
                "writing",
                90,
                "ja",
                "文章ドラフト",
                "ラフな意図を文書、メール、レポート、投稿文の形に落とし込む。",
                "文章作成系の依頼では、まず読み手・トーン・出力形式を明確にし、抽象的な助言ではなく具体的なドラフトを返す。再利用される成果物なら create_artifact で保存する。",
                &["文章", "ドラフト", "下書き", "書いて", "書き直し", "メール", "レポート", "記事", "投稿"],
                &["writing", "draft", "rewrite", "communication"],
                contract(&["create_artifact"], &["artifact"], &["chat", "artifact"], &[], &["writing-draft"]),
            ),
            official_skill(
                "planning-structurer",
                "1.0.0",
                "official",
                "planning",
                80,
                "ja",
                "計画ストラクチャ",
                "目標、制約、マイルストーン、次の一手を整理して実行可能な形にする。",
                "計画系の依頼では、ゴール・制約・成功条件・依存関係を切り分け、少数の実行可能なフェーズに分解する。再利用されるなら artifact に残し、期限やフォローアップがあるなら reminder を使う。",
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
            official_skill(
                "slides-author",
                "1.0.0",
                "official",
                "slides",
                95,
                "ja",
                "スライド作成",
                "プレゼン資料の構成、各スライドの内容、話す流れを組み立てる。",
                "スライドやプレゼン依頼では、先に全体の物語線を作り、その後にスライドごとのタイトル、要点、必要なら話者メモまで具体化する。残す価値があるなら artifact や file として保存する。",
                &["スライド", "資料", "プレゼン", "発表", "デッキ", "PPTX", "パワポ"],
                &["slides", "presentation", "deck", "narrative"],
                contract(
                    &["create_artifact", "workspace_files_write"],
                    &["artifact", "workspace_file"],
                    &["chat", "artifact", "workspace_file"],
                    &[],
                    &["slides-outline", "speaker-notes"],
                ),
            ),
            official_skill(
                "repo-app-operator",
                "1.0.0",
                "official",
                "software",
                110,
                "ja",
                "リポジトリ/アプリ運用",
                "ソフトウェア資産を repo と app として取得・作成・変更・公開する。",
                "ソフトウェアや自動化の依頼では、可能なら durable な Takos asset として扱う。既存候補がありそうなら store_search から入り、repo_fork または create_repository で repo を確保し、container と runtime tool で変更し、container_commit で保存し、repo-local app なら app_deployment_deploy_from_repo で公開する。",
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
                        "app_deployment_deploy_from_repo",
                    ],
                    &["repo", "app", "artifact"],
                    &["chat", "repo", "app", "artifact"],
                    &[],
                    &["repo-app-bootstrap", "api-worker"],
                ),
            ),
        ],
        _ => vec![
            official_skill(
                "research-brief",
                "1.0.0",
                "official",
                "research",
                100,
                "en",
                "Research Brief",
                "Investigate a topic, gather evidence, compare sources, and summarize the result clearly.",
                "When the user is researching, gather facts before concluding. Prefer current sources when freshness matters, compare multiple sources when the topic is uncertain, state what is confirmed versus inferred, and end with a concise answer or brief.",
                &["research", "investigate", "analyze", "compare", "summarize", "sources", "fact check"],
                &["research", "summary", "evidence", "comparison"],
                contract(
                    &["browser_open", "browser_goto", "browser_extract", "browser_screenshot", "web_fetch", "search", "create_artifact"],
                    &["artifact"],
                    &["chat", "artifact"],
                    &[],
                    &["research-brief"],
                ),
            ),
            official_skill(
                "writing-draft",
                "1.0.0",
                "official",
                "writing",
                90,
                "en",
                "Writing Draft",
                "Turn rough intent into a draft, rewrite, report, email, or polished written output.",
                "When the user needs writing help, determine the audience, tone, and desired output shape. Produce a concrete draft instead of generic advice, keep structure clear, and use create_artifact when the result should be saved as a durable deliverable.",
                &["write", "draft", "rewrite", "email", "post", "article", "copy", "document"],
                &["writing", "draft", "rewrite", "communication"],
                contract(&["create_artifact"], &["artifact"], &["chat", "artifact"], &[], &["writing-draft"]),
            ),
            official_skill(
                "planning-structurer",
                "1.0.0",
                "official",
                "planning",
                80,
                "en",
                "Planning Structurer",
                "Clarify goals, scope, milestones, and next steps for a project or task.",
                "When the user needs planning, identify the goal, constraints, success criteria, and dependencies. Break work into a small number of actionable phases, surface tradeoffs, and record the result in a durable artifact when the plan will be reused.",
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
            official_skill(
                "slides-author",
                "1.0.0",
                "official",
                "slides",
                95,
                "en",
                "Slides Author",
                "Design slide decks, presentation structures, and speaking outlines.",
                "When the user needs a presentation or deck, build a narrative arc first, then produce slide-by-slide content with titles, key points, and optional speaker notes. Prefer reusable artifacts and files over chat-only output when the deck should persist.",
                &["slides", "slide deck", "presentation", "pptx", "powerpoint", "keynote"],
                &["slides", "presentation", "deck", "narrative"],
                contract(
                    &["create_artifact", "workspace_files_write"],
                    &["artifact", "workspace_file"],
                    &["chat", "artifact", "workspace_file"],
                    &[],
                    &["slides-outline", "speaker-notes"],
                ),
            ),
            official_skill(
                "repo-app-operator",
                "1.0.0",
                "official",
                "software",
                110,
                "en",
                "Repo App Operator",
                "Acquire, create, modify, and deploy software assets as repos and apps on Takos.",
                "When the task is about software or automation, prefer durable Takos assets. Start from store_search when existing assets might help, use repo_fork or create_repository to obtain a repo, use container and runtime tools to change it, save with container_commit, and publish with app_deployment_deploy_from_repo when the repo defines a repo-local app.",
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
                        "app_deployment_deploy_from_repo",
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
fn official_skill(
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
