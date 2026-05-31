import { useI18n } from "../../store/i18n.ts";

export function LoginPage(props: { onLogin: () => void; returnTo?: string }) {
  const { t, lang, setLang } = useI18n();

  return (
    <div class="flex items-center justify-center min-h-screen bg-white dark:bg-zinc-900 p-4">
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
          class="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 rounded-lg font-medium hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          onClick={() => props.onLogin()}
        >
          <img src="/logo.png" alt="" class="w-5 h-5 rounded-md" />
          {t("continueWithTakosumiAccounts")}
        </button>

        <div class="flex justify-center gap-2 mt-6">
          <button
            type="button"
            class={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              lang === "ja"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
            onClick={() => setLang("ja")}
          >
            日本語
          </button>
          <button
            type="button"
            class={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              lang === "en"
                ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
                : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
            onClick={() => setLang("en")}
          >
            English
          </button>
        </div>

        <div class="flex justify-center gap-3 mt-4 text-xs text-zinc-400">
          <a
            href="https://developers.takos.jp"
            target="_blank"
            rel="noopener noreferrer"
            class="hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {t("docs")}
          </a>
          <a href="/terms" class="hover:text-zinc-600 dark:hover:text-zinc-300">
            {t("terms")}
          </a>
          <a
            href="/privacy"
            class="hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {t("privacy")}
          </a>
        </div>
      </div>
    </div>
  );
}
