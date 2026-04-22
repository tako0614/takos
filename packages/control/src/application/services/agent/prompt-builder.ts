import {
  corePromptMarkdown,
  generalWorkflowMarkdown,
  modeAssistantMarkdown,
  modeDefaultMarkdown,
  modeImplementerMarkdown,
  modePlannerMarkdown,
  modeResearcherMarkdown,
  modeReviewerMarkdown,
  responseGuidelinesMarkdown,
  toolRuntimeRulesMarkdown,
} from "./prompt-assets.generated.ts";

type PromptToolSummary = {
  name: string;
  description: string;
};

const TOOL_RUNTIME_RULES = toolRuntimeRulesMarkdown.trim();
const RESPONSE_GUIDELINES = responseGuidelinesMarkdown.trim();

const DEFAULT_CORE_PROMPT = [
  corePromptMarkdown.trim(),
  TOOL_RUNTIME_RULES,
  RESPONSE_GUIDELINES,
].join("\n\n");

const SYSTEM_PROMPTS: Record<string, string> = {
  default: [
    DEFAULT_CORE_PROMPT,
    modeDefaultMarkdown.trim(),
    generalWorkflowMarkdown.trim(),
  ].join("\n\n"),
  researcher: [
    DEFAULT_CORE_PROMPT,
    modeResearcherMarkdown.trim(),
    generalWorkflowMarkdown.trim(),
  ].join("\n\n"),
  implementer: [
    DEFAULT_CORE_PROMPT,
    modeImplementerMarkdown.trim(),
    generalWorkflowMarkdown.trim(),
  ].join("\n\n"),
  reviewer: [
    DEFAULT_CORE_PROMPT,
    modeReviewerMarkdown.trim(),
    generalWorkflowMarkdown.trim(),
  ].join("\n\n"),
  assistant: [DEFAULT_CORE_PROMPT, modeAssistantMarkdown.trim()].join("\n\n"),
  planner: [DEFAULT_CORE_PROMPT, modePlannerMarkdown.trim()].join("\n\n"),
};

function buildRuntimeToolCatalog(tools: PromptToolSummary[]): string {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  if (sorted.length === 0) {
    return `

## Runtime Tool Catalog

No tools are available in this run.`;
  }

  const hasCapabilitySearch = sorted.some((tool) =>
    tool.name === "capability_search"
  );
  const hasCapabilityFamilies = sorted.some((tool) =>
    tool.name === "capability_families"
  );
  const hasCapabilityDescribe = sorted.some((tool) =>
    tool.name === "capability_describe"
  );
  const hasToolbox = sorted.some((tool) => tool.name === "toolbox");
  const toolLines = sorted.map((tool) =>
    `- \`${tool.name}\`: ${tool.description}`
  );
  const discoveryHint = hasToolbox
    ? "\n\nUse direct tools for common built-in operations. Use `toolbox` for manuals, extension tools, and less common capabilities: action=`search`, then `describe`, then `call`."
    : hasCapabilitySearch || hasCapabilityFamilies
    ? `\n\nIf you are unsure which tool fits, use \`capability_search\` to find relevant tools by natural language or \`capability_families\` to inspect the available capability surface.${
      hasCapabilityDescribe
        ? " Use `capability_describe` to inspect input schemas before invoking discovered tools."
        : ""
    }`
    : "";
  return `

## Runtime Tool Catalog

The following tools are available in this run:
${toolLines.join("\n")}${discoveryHint}`;
}

export function buildToolCatalogContent(tools: PromptToolSummary[]): string {
  return buildRuntimeToolCatalog(tools);
}

export function buildAvailableToolsPrompt(
  basePrompt: string,
  tools: PromptToolSummary[],
): string {
  return basePrompt + buildRuntimeToolCatalog(tools);
}

export {
  DEFAULT_CORE_PROMPT,
  RESPONSE_GUIDELINES,
  SYSTEM_PROMPTS,
  TOOL_RUNTIME_RULES,
};
