import {
  readModelSettingsResponse,
  type ModelSettingsResponse,
} from "../lib/model-settings-response.ts";
import type { ModelSelectOption } from "../lib/modelCatalog.ts";

export interface ChatModelSelectionProjection {
  models: ModelSelectOption[];
  selectedModel: string;
  settings: ModelSettingsResponse;
}

/**
 * Project the operator-owned Workspace catalog into the per-Run Chat picker.
 * A Run-derived seed may be retained only while the current catalog still
 * marks it selectable; otherwise the current Workspace default wins.
 */
export function readChatModelSelection(
  value: unknown,
  seedModel?: string,
): ChatModelSelectionProjection {
  const settings = readModelSettingsResponse(value);
  const models = settings.availableModels[settings.modelBackend];
  const selectedModel = seedModel && models.some((model) =>
      model.id === seedModel && !model.disabled
    )
    ? seedModel
    : settings.model;

  return { models, selectedModel, settings };
}

export function isSelectableChatModel(
  models: readonly ModelSelectOption[],
  model: string,
): boolean {
  return models.some((option) => option.id === model && !option.disabled);
}
