import { createEffect, createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { Icons } from "../../lib/Icons.tsx";
import {
  FALLBACK_MODELS,
  type ModelSelectOption,
} from "../../lib/modelCatalog.ts";
import type { ModelOption } from "./work/task-work-types.ts";

export function ModelTab(props: { spaceId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [selectedModel, setSelectedModel] = createSignal(FALLBACK_MODELS[0].id);
  const [modelOptions, setModelOptions] = createSignal<ModelSelectOption[]>([
    ...FALLBACK_MODELS,
  ]);
  const [tokenLimit, setContextWindow] = createSignal<number | null>(null);
  let modelSettingsSeq = 0;

  createEffect(() => {
    void fetchModelSettings(props.spaceId);
  });

  const fetchModelSettings = async (spaceId = props.spaceId) => {
    const seq = ++modelSettingsSeq;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await rpc.spaces[":spaceId"].model.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{
        ai_model?: string;
        model?: string;
        token_limit?: number;
        model_backend?: string;
        available_models?: {
          openai: ModelOption[];
          anthropic: ModelOption[];
          google: ModelOption[];
        };
      }>(res);
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      const backend = data.model_backend || "openai";
      const raw = data.available_models?.[
        backend as keyof NonNullable<typeof data.available_models>
      ] ?? data.available_models?.openai ?? [];
      const models = raw.map((entry) => {
        if (typeof entry === "string") return { id: entry, label: entry };
        return {
          id: entry.id,
          label: entry.name || entry.id,
          description: entry.description,
          source: entry.source,
          disabled: entry.disabled,
        };
      }).filter((entry) => entry.id);
      const resolvedOptions = models.length > 0
        ? models
        : [...FALLBACK_MODELS];
      setModelOptions(resolvedOptions);
      const model = data.ai_model || data.model || "";
      if (resolvedOptions.some((opt) => opt.id === model)) {
        setSelectedModel(model);
      } else {
        setSelectedModel(
          resolvedOptions.find((opt) => !opt.disabled)?.id ??
            resolvedOptions[0].id,
        );
      }
      if (typeof data.token_limit === "number") {
        setContextWindow(data.token_limit);
      }
    } catch (err) {
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      console.error("Failed to fetch model settings:", err);
      setLoadError(
        err instanceof Error && err.message ? err.message : t("failedToLoad"),
      );
    } finally {
      if (seq === modelSettingsSeq && spaceId === props.spaceId) {
        setLoading(false);
      }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await rpc.spaces[":spaceId"].model.$patch({
        param: { spaceId: props.spaceId },
        json: { model: selectedModel() } as Record<string, string>,
      });
      const data = await rpcJson<{ token_limit?: number }>(res);
      if (typeof data.token_limit === "number") {
        setContextWindow(data.token_limit);
      }
      showToast("success", t("modelSettingsSaved"));
    } catch {
      showToast("error", t("modelSettingsFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Show
      when={!loading()}
      fallback={
        <div
          role="status"
          aria-live="polite"
          class="flex flex-col items-center justify-center py-12 text-zinc-600 dark:text-zinc-300 gap-3"
        >
          <Icons.Loader class="w-5 h-5 animate-spin" aria-hidden="true" />
          <p>{t("loading")}</p>
        </div>
      }
    >
      <div class="flex flex-col gap-6">
        <Show when={loadError()}>
          {(err) => (
            <div
              role="alert"
              class="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
            >
              <span class="min-w-0 flex-1">{err()}</span>
              <button
                type="button"
                class="min-h-[44px] sm:min-h-0 rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                onClick={() => void fetchModelSettings()}
              >
                {t("retry")}
              </button>
            </div>
          )}
        </Show>

        <div class="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <h3 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
            {t("modelBackend")}
          </h3>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {modelOptions().map((opt) => (
              <button
                type="button"
                aria-pressed={selectedModel() === opt.id}
                class={`min-h-[44px] flex flex-col items-start gap-1 p-4 rounded-lg border transition-colors text-left ${
                  selectedModel() === opt.id
                    ? "border-zinc-900 dark:border-zinc-100 bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                    : "border-zinc-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 hover:border-zinc-900/50 dark:hover:border-zinc-400 text-zinc-700 dark:text-zinc-200 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
                onClick={() => setSelectedModel(opt.id)}
                disabled={saving() || opt.disabled}
              >
                <span class="text-base font-semibold">{opt.label}</span>
                {opt.description && (
                  <span class="text-xs text-zinc-600 dark:text-zinc-300">
                    {opt.description}
                  </span>
                )}
              </button>
            ))}
          </div>
          {tokenLimit() !== null && (
            <p class="mt-3 text-xs text-zinc-600 dark:text-zinc-300">
              {t("tokenLimitLabel")}: {t("tokenLimitValue", {
                count: (tokenLimit()! / 1000).toFixed(0),
              })}
            </p>
          )}
        </div>

        <button
          type="button"
          class="min-h-[44px] w-full py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          onClick={handleSave}
          disabled={saving()}
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
      </div>
    </Show>
  );
}
