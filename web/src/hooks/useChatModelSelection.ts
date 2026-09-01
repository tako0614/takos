import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { rpc, rpcJson } from "../lib/rpc.ts";
import type { ModelSelectOption } from "../lib/modelCatalog.ts";
import {
  isSelectableChatModel,
  readChatModelSelection,
} from "./chat-model-selection.ts";

export interface UseChatModelSelectionOptions {
  spaceId: Accessor<string>;
  initialModel?: Accessor<string | undefined>;
}

export interface UseChatModelSelectionResult {
  availableModels: Accessor<ModelSelectOption[]>;
  selectedModel: Accessor<string>;
  setSelectedModel: (model: string) => void;
  isLoading: Accessor<boolean>;
  hasError: Accessor<boolean>;
  isReady: Accessor<boolean>;
  fetchSpaceModels: () => Promise<void>;
}

export function useChatModelSelection({
  spaceId,
  initialModel,
}: UseChatModelSelectionOptions): UseChatModelSelectionResult {
  const [selectedModel, setSelectedModelState] = createSignal("");
  const [availableModels, setAvailableModels] = createSignal<
    ModelSelectOption[]
  >([]);
  const [isLoading, setIsLoading] = createSignal(true);
  const [hasError, setHasError] = createSignal(false);
  let requestVersion = 0;

  const setSelectedModel = (model: string) => {
    if (isSelectableChatModel(availableModels(), model)) {
      setSelectedModelState(model);
    }
  };

  const loadSpaceModels = async (
    currentSpaceId: string,
    seedModel?: string,
  ): Promise<void> => {
    const version = ++requestVersion;
    setIsLoading(true);
    setHasError(false);
    setAvailableModels([]);
    setSelectedModelState("");
    try {
      const res = await rpc.spaces[":spaceId"].model.$get({
        param: { spaceId: currentSpaceId },
      });
      const data = await rpcJson<unknown>(res);
      const projection = readChatModelSelection(data, seedModel);
      if (version !== requestVersion || spaceId() !== currentSpaceId) return;
      setAvailableModels(projection.models);
      setSelectedModelState(projection.selectedModel);
    } catch {
      if (version !== requestVersion || spaceId() !== currentSpaceId) return;
      setHasError(true);
    } finally {
      if (version === requestVersion && spaceId() === currentSpaceId) {
        setIsLoading(false);
      }
    }
  };

  const fetchSpaceModels = async () => {
    const currentSpaceId = spaceId();
    if (!currentSpaceId) return;
    await loadSpaceModels(currentSpaceId, initialModel?.());
  };

  createEffect(() => {
    const currentSpaceId = spaceId();
    // The seed describes the Run/thread that caused this mount. Clearing the
    // hand-off after the first send must not refetch the same Workspace
    // catalog and reset the user's next-Run selection.
    const currentSeedModel = untrack(() => initialModel?.());
    if (!currentSpaceId) {
      requestVersion++;
      setAvailableModels([]);
      setSelectedModelState("");
      setHasError(false);
      setIsLoading(false);
      return;
    }
    void loadSpaceModels(currentSpaceId, currentSeedModel);
    onCleanup(() => {
      requestVersion++;
    });
  });

  return {
    availableModels,
    selectedModel,
    setSelectedModel,
    isLoading,
    hasError,
    isReady: () =>
      !isLoading() && !hasError() &&
      isSelectableChatModel(availableModels(), selectedModel()),
    fetchSpaceModels,
  };
}
