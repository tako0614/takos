type PromptToolSummary = {
    name: string;
    description: string;
};
declare const TOOL_RUNTIME_RULES: string;
declare const RESPONSE_GUIDELINES: string;
declare const DEFAULT_CORE_PROMPT: string;
declare const SYSTEM_PROMPTS: Record<string, string>;
export declare function buildToolCatalogContent(tools: PromptToolSummary[]): string;
export declare function buildAvailableToolsPrompt(basePrompt: string, tools: PromptToolSummary[]): string;
export { DEFAULT_CORE_PROMPT, RESPONSE_GUIDELINES, SYSTEM_PROMPTS, TOOL_RUNTIME_RULES };
//# sourceMappingURL=prompt-builder.d.ts.map