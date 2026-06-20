export type ModelSelectOption = {
  id: string;
  label: string;
  description?: string;
};

const OPENAI_COMPATIBLE_MODEL_OPTIONS: ReadonlyArray<ModelSelectOption> = [
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Direct OpenAI-compatible default",
  },
  {
    id: "takosumi/default",
    label: "Takosumi Default",
    description: "Operator-selected gateway model",
  },
  {
    id: "deepseek/chat",
    label: "DeepSeek Chat",
    description: "Gateway OpenAI-compatible alias",
  },
  {
    id: "zai/glm",
    label: "Z.AI GLM",
    description: "Gateway OpenAI-compatible alias",
  },
  {
    id: "gemini/chat",
    label: "Gemini Chat",
    description: "Gateway OpenAI-compatible alias",
  },
];

export const DEFAULT_MODEL_ID = OPENAI_COMPATIBLE_MODEL_OPTIONS[0].id;

export const FALLBACK_MODELS: ReadonlyArray<ModelSelectOption> =
  OPENAI_COMPATIBLE_MODEL_OPTIONS;

export const MODEL_OPTIONS: ReadonlyArray<ModelSelectOption> =
  OPENAI_COMPATIBLE_MODEL_OPTIONS;

export function getModelLabel(modelId: string): string {
  return MODEL_OPTIONS.find((m) => m.id === modelId)?.label ?? modelId;
}
