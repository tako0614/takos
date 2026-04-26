const repoRoot = new URL("../", import.meta.url);

type PromptAsset = {
  tsName: string;
  rustName?: string;
  path: string;
};

const assets: PromptAsset[] = [
  {
    tsName: "corePromptMarkdown",
    rustName: "CORE_PROMPT",
    path: "packages/control/src/application/services/agent/prompts/core.md",
  },
  {
    tsName: "toolRuntimeRulesMarkdown",
    rustName: "TOOL_RUNTIME_RULES",
    path:
      "packages/control/src/application/services/agent/prompts/tool-runtime-rules.md",
  },
  {
    tsName: "responseGuidelinesMarkdown",
    rustName: "RESPONSE_GUIDELINES",
    path:
      "packages/control/src/application/services/agent/prompts/response-guidelines.md",
  },
  {
    tsName: "generalWorkflowMarkdown",
    rustName: "GENERAL_WORKFLOW",
    path:
      "packages/control/src/application/services/agent/prompts/general-workflow.md",
  },
  {
    tsName: "modeDefaultMarkdown",
    rustName: "MODE_DEFAULT",
    path:
      "packages/control/src/application/services/agent/prompts/modes/default.md",
  },
  {
    tsName: "modeResearcherMarkdown",
    rustName: "MODE_RESEARCHER",
    path:
      "packages/control/src/application/services/agent/prompts/modes/researcher.md",
  },
  {
    tsName: "modeImplementerMarkdown",
    rustName: "MODE_IMPLEMENTER",
    path:
      "packages/control/src/application/services/agent/prompts/modes/implementer.md",
  },
  {
    tsName: "modeReviewerMarkdown",
    rustName: "MODE_REVIEWER",
    path:
      "packages/control/src/application/services/agent/prompts/modes/reviewer.md",
  },
  {
    tsName: "modeAssistantMarkdown",
    rustName: "MODE_ASSISTANT",
    path:
      "packages/control/src/application/services/agent/prompts/modes/assistant.md",
  },
  {
    tsName: "modePlannerMarkdown",
    rustName: "MODE_PLANNER",
    path:
      "packages/control/src/application/services/agent/prompts/modes/planner.md",
  },
  {
    tsName: "researchBriefJaMarkdown",
    rustName: "RESEARCH_BRIEF_JA_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/research-brief.ja.md",
  },
  {
    tsName: "researchBriefEnMarkdown",
    rustName: "RESEARCH_BRIEF_EN_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/research-brief.en.md",
  },
  {
    tsName: "writingDraftJaMarkdown",
    rustName: "WRITING_DRAFT_JA_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/writing-draft.ja.md",
  },
  {
    tsName: "writingDraftEnMarkdown",
    rustName: "WRITING_DRAFT_EN_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/writing-draft.en.md",
  },
  {
    tsName: "planningStructurerJaMarkdown",
    rustName: "PLANNING_STRUCTURER_JA_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/planning-structurer.ja.md",
  },
  {
    tsName: "planningStructurerEnMarkdown",
    rustName: "PLANNING_STRUCTURER_EN_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/planning-structurer.en.md",
  },
  {
    tsName: "slidesAuthorJaMarkdown",
    rustName: "SLIDES_AUTHOR_JA_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/slides-author.ja.md",
  },
  {
    tsName: "slidesAuthorEnMarkdown",
    rustName: "SLIDES_AUTHOR_EN_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/slides-author.en.md",
  },
  {
    tsName: "repoAppOperatorJaMarkdown",
    rustName: "REPO_APP_OPERATOR_JA_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/repo-app-operator.ja.md",
  },
  {
    tsName: "repoAppOperatorEnMarkdown",
    rustName: "REPO_APP_OPERATOR_EN_MARKDOWN",
    path:
      "packages/control/src/application/services/agent/prompts/skills/repo-app-operator.en.md",
  },
];

const tsOutputPath =
  "packages/control/src/application/services/agent/prompt-assets.generated.ts";
const rustOutputPath = "agent/src/prompt_assets.rs";

async function readAsset(asset: PromptAsset): Promise<[PromptAsset, string]> {
  const url = new URL(asset.path, repoRoot);
  return [asset, await Deno.readTextFile(url)];
}

function formatTsString(value: string): string {
  return JSON.stringify(value);
}

function formatRustRawString(value: string): string {
  let hashes = "#";
  while (value.includes(`"${hashes}`)) {
    hashes += "#";
  }
  return `r${hashes}"${value}"${hashes}`;
}

function renderTs(entries: Array<[PromptAsset, string]>): string {
  const lines = [
    "// This file is generated from ./prompts/*.md assets to avoid runtime loaders in the local public path.",
    "// Run `deno task generate:agent-prompts` from the repository root after editing prompt markdown.",
    "",
  ];

  for (const [asset, content] of entries) {
    lines.push(
      `export const ${asset.tsName} =`,
      `  ${formatTsString(content)};`,
    );
  }
  return lines.join("\n") + "\n";
}

function renderRust(entries: Array<[PromptAsset, string]>): string {
  const lines: string[] = [
    "// This file is generated from packages/control/src/application/services/agent/prompts/*.md.",
    "// Run `deno task generate:agent-prompts` from the Takos repository root after editing prompt markdown.",
    "",
  ];

  for (const [asset, content] of entries) {
    if (!asset.rustName) continue;
    lines.push(
      `pub const ${asset.rustName}: &str = ${formatRustRawString(content)};`,
    );
  }
  return lines.join("\n") + "\n";
}

async function ensureFile(path: string, content: string, check: boolean) {
  const url = new URL(path, repoRoot);
  const current = await Deno.readTextFile(url).catch(() => "");
  if (current === content) return;

  if (check) {
    console.error(
      `${path} is out of date. Run deno task generate:agent-prompts.`,
    );
    Deno.exitCode = 1;
    return;
  }

  await Deno.writeTextFile(url, content);
  console.log(`updated ${path}`);
}

const check = Deno.args.includes("--check");
const entries = await Promise.all(assets.map(readAsset));
await ensureFile(tsOutputPath, renderTs(entries), check);
await ensureFile(rustOutputPath, renderRust(entries), check);
