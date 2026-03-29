import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { DEFAULT_MODEL_ID, FALLBACK_MODELS, type ModelSelectOption } from '../lib/modelCatalog';
import type { ModelOption } from '../views/agent/work/task-work-types';

export interface UseChatModelSelectionOptions {
  spaceId: string;
  initialModel?: string;
}

export interface UseChatModelSelectionResult {
  availableModels: ModelSelectOption[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  fetchSpaceModels: () => Promise<void>;
}

export function useChatModelSelection({
  spaceId,
  initialModel,
}: UseChatModelSelectionOptions): UseChatModelSelectionResult {
  const [selectedModel, setSelectedModel] = useState<string>(initialModel ?? DEFAULT_MODEL_ID);
  const [availableModels, setAvailableModels] = useState<ModelSelectOption[]>([...FALLBACK_MODELS]);

  const fetchSpaceModels = useCallback(async () => {
    if (!spaceId) return;
    try {
      const res = await rpc.spaces[':spaceId'].model.$get({
        param: { spaceId },
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

      const provider = data.ai_provider || data.provider || 'openai';
      let raw: ModelOption[] | undefined;
      if (provider === 'anthropic') {
        raw = data.available_models?.anthropic;
      } else if (provider === 'google') {
        raw = data.available_models?.google;
      } else {
        raw = data.available_models?.openai;
      }

      const models = (raw || [])
        .map((entry) => {
          if (typeof entry === 'string') {
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
      setAvailableModels(resolvedModels);

      const resolvedIds = resolvedModels.map((model) => model.id);
      if (initialModel && resolvedIds.includes(initialModel)) {
        setSelectedModel(initialModel);
      } else {
        const desiredModel = data.ai_model || data.model;
        if (desiredModel && resolvedIds.includes(desiredModel)) {
          setSelectedModel(desiredModel);
        } else {
          setSelectedModel((prev) => (resolvedIds.includes(prev) ? prev : resolvedModels[0].id));
        }
      }
    } catch (err) {
      console.error('Failed to fetch space models:', err);
      setAvailableModels([...FALLBACK_MODELS]);
    }
  }, [spaceId, initialModel]);

  useEffect(() => {
    fetchSpaceModels();
  }, [fetchSpaceModels]);

  return {
    availableModels,
    selectedModel,
    setSelectedModel,
    fetchSpaceModels,
  };
}
