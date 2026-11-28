import { createSignal } from "solid-js";
import { useDocumentTitle } from "../hooks/useDocumentTitle.ts";
import { useI18n } from "../store/i18n.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";

interface SetupPageProps {
  onComplete: () => void;
}

export function SetupPage(props: SetupPageProps) {
  const { t } = useI18n();
  useDocumentTitle(() => t("setupWelcome"));
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleSubmit = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    setError(null);

    setSubmitting(true);
    try {
      const res = await rpc.setup.complete.$post();
      await rpcJson(res);
      props.onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unknownError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main class="min-h-screen bg-white dark:bg-zinc-900 flex items-center justify-center p-4">
      <div class="w-full max-w-sm">
        <div class="p-6">
          <div class="text-center mb-6">
            <h1 class="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {t("setupWelcome")}
            </h1>
            <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {t("setupAccountSubtitle")}
            </p>
          </div>

          <form onSubmit={handleSubmit} class="space-y-4">
            {error() && (
              <p role="alert" class="text-sm text-red-600 dark:text-red-400">
                {error()}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting()}
              aria-busy={submitting() ? "true" : undefined}
              class="w-full min-h-[44px] py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-60 disabled:cursor-not-allowed text-white dark:text-zinc-900 text-sm font-medium rounded-lg transition-colors"
            >
              {submitting()
                ? (
                  <span class="flex items-center justify-center gap-1.5">
                    <span
                      aria-hidden="true"
                      class="w-3 h-3 border border-white dark:border-zinc-900 border-t-transparent rounded-full animate-spin"
                    />
                    {t("settingUp")}
                  </span>
                )
                : (
                  t("continue")
                )}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
