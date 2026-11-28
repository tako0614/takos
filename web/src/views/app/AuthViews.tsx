import { createSignal, onMount, Show } from "solid-js";
import { LoadingScreen } from "../../components/common/LoadingScreen.tsx";
import { claimOidcAutoLoginAttempt } from "../../lib/oidc-auto-login.ts";
import { useI18n } from "../../store/i18n.ts";

export function LoginPage(props: { onLogin: () => void; returnTo?: string }) {
  const i18n = useI18n();
  const t = i18n.t;
  const [autoRedirecting, setAutoRedirecting] = createSignal(false);

  onMount(() => {
    if (!claimOidcAutoLoginAttempt(globalThis.sessionStorage)) return;
    setAutoRedirecting(true);
    props.onLogin();
  });

  return (
    <Show when={!autoRedirecting()} fallback={<LoadingScreen />}>
      <main class="flex items-center justify-center min-h-screen bg-white dark:bg-zinc-900 p-4">
        <div class="w-full max-w-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 text-center">
          <div class="flex justify-center mb-6">
            <img src="/logo.png" alt="Takos" class="w-16 h-16 rounded-xl" />
          </div>
          <h1 class="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
            {t("appName")}
          </h1>
          <p class="text-zinc-500 dark:text-zinc-400 mb-8">
            {t("loginSubtitle")}
          </p>

          <button
            type="button"
            class="w-full min-h-[44px] flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 rounded-lg font-medium hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => props.onLogin()}
          >
            <img src="/logo.png" alt="" class="w-5 h-5 rounded-md" />
            {t("continueWithTakosumiAccounts")}
          </button>

          <div class="flex justify-center gap-2 mt-6">
            <button
              type="button"
              aria-pressed={i18n.lang === "ja"}
              class={`min-h-[44px] px-3 py-1.5 rounded-lg text-sm transition-colors ${
                i18n.lang === "ja"
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
              onClick={() => i18n.setLang("ja")}
            >
              日本語
            </button>
            <button
              type="button"
              aria-pressed={i18n.lang === "en"}
              class={`min-h-[44px] px-3 py-1.5 rounded-lg text-sm transition-colors ${
                i18n.lang === "en"
                  ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
              onClick={() => i18n.setLang("en")}
            >
              English
            </button>
          </div>

          <div class="flex justify-center gap-1 mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            <a
              href="https://developers.takos.jp"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-[44px] items-center px-2 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {t("docs")}
            </a>
            <a
              href="/terms"
              class="inline-flex min-h-[44px] items-center px-2 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {t("terms")}
            </a>
            <a
              href="/privacy"
              class="inline-flex min-h-[44px] items-center px-2 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              {t("privacy")}
            </a>
          </div>
        </div>
      </main>
    </Show>
  );
}
