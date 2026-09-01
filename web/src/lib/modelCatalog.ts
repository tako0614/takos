export type ModelSelectOption = {
  id: string;
  label: string;
  description?: string;
  source?: "models_api" | "gateway" | "fallback";
  disabled?: boolean;
};

export function getModelLabel(
  models: readonly ModelSelectOption[],
  modelId: string,
): string {
  return models.find((model) => model.id === modelId)?.label ?? modelId;
}
