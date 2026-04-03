import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { rpc, rpcJson } from "../lib/rpc.ts";
import {
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  type ModelSelectOption,
} from "../lib/modelCatalog.ts";
import type { ModelOption } from "../views/agent/work/task-work-types.ts";

export interface UseChatModelSelectionOptions {
  spaceId: Accessor<string>;
  initialModel?: Accessor<string | undefined>;
}

export interface UseChatModelSelectionResult {
  availableModels: Accessor<ModelSelectOption[]>;
  selectedModel: Accessor<string>;
  setSelectedModel: (model: string) => void;
  fetchSpaceModels: () => Promise<void>;
}

export function useChatModelSelection({
  spaceId,
  initialModel,
}: UseChatModelSelectionOptions): UseChatModelSelectionResult {
  const [selectedModel, setSelectedModel] = createSignal<string>(
    initialModel?.() ?? DEFAULT_MODEL_ID,
  );
  const [availableModels, setAvailableModels] = createSignal<
    ModelSelectOption[]
  >([...FALLBACK_MODELS]);

  const loadSpaceModels = async (
    currentSpaceId: string,
    seedModel?: string,
    isCancelled?: () => boolean,
  ): Promise<void> => {
    try {
      const res = await rpc.spaces[":spaceId"].model.$get({
        param: { spaceId: currentSpaceId },
      });
      const data = await rpcJson<{
        ai_model?: string;
        ai_provider?: string;
        model?: string;
        provider?: string;
        available_models: {
          openai: ModelOption[];
          anthropic: ModelOption[];
          google: ModelOption[];
        };
      }>(res);

      const provider = data.ai_provider || data.provider || "openai";
      let raw: ModelOption[] | undefined;
      if (provider === "anthropic") {
        raw = data.available_models?.anthropic;
      } else if (provider === "google") {
        raw = data.available_models?.google;
      } else {
        raw = data.available_models?.openai;
      }

      const models = (raw || [])
        .map((entry) => {
          if (typeof entry === "string") {
            return { id: entry, label: entry };
          }
          return {
            id: entry.id,
            label: entry.name || entry.id,
            description: entry.description,
          };
        })
        .filter((entry) => entry.id);

      const resolvedModels = models.length > 0 ? models : [...FALLBACK_MODELS];
      if (isCancelled?.()) return;
      setAvailableModels(resolvedModels);

      const resolvedIds = resolvedModels.map((model) => model.id);
      if (seedModel && resolvedIds.includes(seedModel)) {
        if (isCancelled?.()) return;
        setSelectedModel(seedModel);
      } else {
        const desiredModel = data.ai_model || data.model;
        if (desiredModel && resolvedIds.includes(desiredModel)) {
          if (isCancelled?.()) return;
          setSelectedModel(desiredModel);
        } else {
          if (isCancelled?.()) return;
          setSelectedModel((
            prev,
          ) => (resolvedIds.includes(prev) ? prev : resolvedModels[0].id));
        }
      }
    } catch (err) {
      if (isCancelled?.()) return;
      console.error("Failed to fetch space models:", err);
      setAvailableModels([...FALLBACK_MODELS]);
    }
  };

  const fetchSpaceModels = async () => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return;
    await loadSpaceModels(currentSpaceId, initialModel?.());
  };

  createEffect(() => {
    const currentSpaceId = spaceId();
    const currentSeedModel = initialModel?.();
    if (!currentSpaceId) return;
    let cancelled = false;
    void loadSpaceModels(currentSpaceId, currentSeedModel, () => cancelled);
    onCleanup(() => {
      cancelled = true;
    });
  });

  return {
    availableModels,
    selectedModel,
    setSelectedModel,
    fetchSpaceModels,
  };
}
