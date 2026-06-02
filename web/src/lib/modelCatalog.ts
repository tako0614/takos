export type ModelSelectOption = {
  id: string;
  label: string;
  description?: string;
};

const OPENAI_MODEL_OPTIONS: ReadonlyArray<ModelSelectOption> = [
  { id: "gpt-5.5", label: "GPT-5.5" },
];

export const DEFAULT_MODEL_ID = OPENAI_MODEL_OPTIONS[0].id;

export const FALLBACK_MODELS: ReadonlyArray<ModelSelectOption> =
  OPENAI_MODEL_OPTIONS;

export const MODEL_OPTIONS: ReadonlyArray<ModelSelectOption> =
  OPENAI_MODEL_OPTIONS;

export function getModelLabel(modelId: string): string {
  return OPENAI_MODEL_OPTIONS.find((m) => m.id === modelId)?.label ?? modelId;
}
