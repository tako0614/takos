import { createEffect, createSignal, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { Icons } from "../../lib/Icons.tsx";
import { MODEL_OPTIONS } from "../../lib/modelCatalog.ts";

export function ModelTab(props: { spaceId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [selectedModel, setSelectedModel] = createSignal(MODEL_OPTIONS[0].id);
  const [tokenLimit, setContextWindow] = createSignal<number | null>(null);
  let modelSettingsSeq = 0;

  createEffect(() => {
    void fetchModelSettings(props.spaceId);
  });

  const fetchModelSettings = async (spaceId = props.spaceId) => {
    const seq = ++modelSettingsSeq;
    setLoading(true);
    try {
      const res = await rpc.spaces[":spaceId"].model.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{
        ai_model?: string;
        model?: string;
        token_limit?: number;
      }>(res);
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      const model = data.ai_model || data.model || "";
      if (MODEL_OPTIONS.some((opt) => opt.id === model)) {
        setSelectedModel(model);
      }
      if (typeof data.token_limit === "number") {
        setContextWindow(data.token_limit);
      }
    } catch (err) {
      if (seq !== modelSettingsSeq || spaceId !== props.spaceId) return;
      console.error("Failed to fetch model settings:", err);
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
        <div class="flex flex-col items-center justify-center py-12 text-zinc-500 gap-3">
          <Icons.Loader class="w-5 h-5 animate-spin" />
          <p>{t("loading")}</p>
        </div>
      }
    >
      <div class="flex flex-col gap-6">
        <div class="bg-zinc-100 dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <h4 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">
            {t("modelBackend")}
          </h4>
          <div class="grid grid-cols-3 gap-3">
            {MODEL_OPTIONS.map((opt) => (
              <button
                type="button"
                class={`flex flex-col items-start gap-1 p-4 rounded-lg border transition-colors text-left ${
                  selectedModel() === opt.id
                    ? "border-zinc-900 dark:border-zinc-100 bg-white/10 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
                    : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-900/50 dark:hover:border-zinc-400 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
                onClick={() => setSelectedModel(opt.id)}
                disabled={saving()}
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

        <button
          type="button"
          class="w-full py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
