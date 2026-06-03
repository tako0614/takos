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

export { SYSTEM_PROMPTS };
