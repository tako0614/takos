import { createEffect, createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { Icons } from "../../lib/Icons.tsx";
import type { ModelSelectOption } from "../../lib/modelCatalog.ts";
import {
  type ModelSettingsResponse,
  readModelSettingsResponse,
} from "../../lib/model-settings-response.ts";

export function ModelTab(props: { spaceId: string; canManage: boolean }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [loadError, setLoadError] = createSignal(false);
  const [selectedModel, setSelectedModel] = createSignal("");
  const [savedModel, setSavedModel] = createSignal("");
  const [modelOptions, setModelOptions] = createSignal<ModelSelectOption[]>([]);
  const [tokenLimit, setContextWindow] = createSignal<number | null>(null);
  let modelSettingsSeq = 0;
  let modelSaveSeq = 0;

  createEffect(() => {
    const spaceId = props.spaceId;
    modelSaveSeq++;
    setSaving(false);
    void fetchModelSettings(spaceId);
  });

  const applyModelSettings = (data: ModelSettingsResponse) => {
    setModelOptions(data.availableModels[data.modelBackend]);
    setSelectedModel(data.model);
    setSavedModel(data.model);
    setContextWindow(data.tokenLimit);
  };

  const fetchModelSettings = async (spaceId = props.spaceId) => {
    const seq = ++modelSettingsSeq;
    setLoading(true);
    setLoadError(false);
    try {
      const res = await rpc.spaces[":spaceId"].model.$get({
        param: { spaceId },
      });
      const data = readModelSettingsResponse(await rpcJson<unknown>(res));
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      applyModelSettings(data);
    } catch (err) {
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      console.error("Failed to fetch model settings:", err);
      setModelOptions([]);
      setSelectedModel("");
      setSavedModel("");
      setContextWindow(null);
      setLoadError(true);
    } finally {
      if (seq === modelSettingsSeq && spaceId === props.spaceId) {
        setLoading(false);
      }
    }
  };

  const handleSave = async () => {
    if (
      !props.canManage || saving() || !selectedModel() ||
      selectedModel() === savedModel()
    ) return;
    const spaceId = props.spaceId;
    const seq = ++modelSaveSeq;
    setSaving(true);
    try {
      const res = await rpc.spaces[":spaceId"].model.$patch({
        param: { spaceId },
        json: { model: selectedModel() } as Record<string, string>,
      });
      const data = readModelSettingsResponse(await rpcJson<unknown>(res));
      if (seq !== modelSaveSeq || spaceId !== props.spaceId) return;
      applyModelSettings(data);
      showToast("success", t("modelSettingsSaved"));
    } catch {
      if (seq !== modelSaveSeq || spaceId !== props.spaceId) return;
      showToast("error", t("modelSettingsFailed"));
    } finally {
      if (seq === modelSaveSeq && spaceId === props.spaceId) {
        setSaving(false);
      }
    }
  };

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="flex flex-col items-center justify-center py-12 text-zinc-500 gap-3">
          <Icons.Loader class="w-5 h-5 animate-spin" />
          <p>{t("loading")}</p>
        </div>
      }
    >
      <Show
        when={!loadError()}
        fallback={
          <div
            role="alert"
            class="flex flex-col items-center justify-center gap-4 py-12 text-center"
          >
            <p class="text-sm text-red-600 dark:text-red-400">
              {t("failedToLoad")}
            </p>
            <button
              type="button"
              class="min-h-[44px] rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-900 dark:border-zinc-600 dark:text-zinc-100"
              onClick={() => void fetchModelSettings()}
            >
              {t("retry")}
            </button>
          </div>
        }
      >
        <div class="flex flex-col gap-6">
          <div class="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
            <h4 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
              {t("modelSelection")}
            </h4>
            <div
              class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              role="radiogroup"
              aria-label={t("modelSelection")}
            >
              {modelOptions().map((opt) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedModel() === opt.id}
                  class={`flex flex-col items-start gap-1 p-4 rounded-lg border transition-colors text-left ${
                    selectedModel() === opt.id
                      ? "border-zinc-900 dark:border-zinc-100 bg-white/10 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                      : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-900/50 dark:hover:border-zinc-400 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  }`}
                  onClick={() => setSelectedModel(opt.id)}
                  disabled={!props.canManage || saving() || opt.disabled}
                >
                  <span class="text-base font-semibold">{opt.label}</span>
                  {opt.description && (
                    <span class="text-xs opacity-70">{opt.description}</span>
                  )}
                </button>
              ))}
            </div>
            {tokenLimit() !== null && (
              <p class="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                {t("tokenLimitLabel")}: {t("tokenLimitValue", {
                  count: (tokenLimit()! / 1000).toFixed(0),
                })}
              </p>
            )}
          </div>

          {props.canManage
            ? (
              <button
                type="button"
                class="w-full py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                onClick={handleSave}
                disabled={saving() || !selectedModel() ||
                  selectedModel() === savedModel()}
              >
                {saving()
                  ? (
                    <>
                      <Icons.Loader class="w-5 h-5 animate-spin" />
                      <span>{t("saving")}</span>
                    </>
                  )
                  : <span>{t("saveModelSettings")}</span>}
              </button>
            )
            : (
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                {t("workspaceReadOnly")}
              </p>
            )}
        </div>
      </Show>
    </Show>
  );
}
