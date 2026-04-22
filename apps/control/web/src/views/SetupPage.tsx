import { createEffect, createSignal, onCleanup } from "solid-js";
import { Icons } from "../lib/Icons.tsx";
import { useI18n } from "../store/i18n.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";

interface SetupPageProps {
  onComplete: () => void;
}

export function SetupPage(props: SetupPageProps) {
  const { t } = useI18n();
  const [username, setUsername] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [usernameError, setUsernameError] = createSignal<string | null>(null);
  const [usernameAvailable, setUsernameAvailable] = createSignal<
    boolean | null
  >(null);
  const [checkingUsername, setCheckingUsername] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!username() || username().length < 3) {
      setUsernameAvailable(null);
      setUsernameError(null);
      return;
    }

    const timer = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await rpc.setup["check-username"].$post({
          json: { username: username() },
        });
        const data = await rpcJson<{ available: boolean; error?: string }>(res);
        setUsernameAvailable(data.available);
        setUsernameError(data.error || null);
      } catch {
        setUsernameError(t("failedToCheckUsername"));
      } finally {
        setCheckingUsername(false);
      }
    }, 300);

    onCleanup(() => clearTimeout(timer));
  });

  const handleSubmit = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    setError(null);

    if (!username() || username().length < 3) {
      setError(t("usernameTooShort"));
      return;
    }

    if (password() && password() !== confirmPassword()) {
      setError(t("passwordMismatch"));
      return;
    }

    if (password() && password().length < 8) {
      setError(t("passwordTooShort"));
      return;
    }

    setSubmitting(true);
    try {
      const res = await rpc.setup.complete.$post({
        json: {
          username: username(),
          ...((password() ? { password: password() } : {}) as Record<
            string,
            unknown
          >),
        },
      });
      await rpcJson(res);
      props.onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("unknownError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="min-h-screen bg-white dark:bg-zinc-900 flex items-center justify-center p-4">
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
            {/* Username */}
            <div>
              <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                {t("username")}
              </label>
              <div class="relative">
                <input
                  type="text"
                  value={username()}
                  onInput={(e) =>
                    setUsername(
                      e.currentTarget.value.toLowerCase().replace(
                        /[^a-z0-9_-]/g,
                        "",
                      ),
                    )}
                  placeholder={t("usernamePlaceholder")}
                  class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                  maxLength={30}
                  required
                />
                {checkingUsername() && (
                  <div class="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <div class="w-3.5 h-3.5 border border-zinc-400 dark:border-zinc-500 border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {!checkingUsername() && usernameAvailable() === true && (
                  <div class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 dark:text-zinc-400">
                    <Icons.Check class="w-3.5 h-3.5" />
                  </div>
                )}
                {!checkingUsername() && usernameAvailable() === false && (
                  <div class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500">
                    <Icons.X class="w-3.5 h-3.5" />
                  </div>
                )}
              </div>
              {usernameError() && (
                <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {usernameError()}
                </p>
              )}
            </div>

            {/* Password (optional) */}
            <div>
              <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                {t("password")}{" "}
                <span class="text-zinc-400 dark:text-zinc-500">
                  {t("passwordOptional")}
                </span>
              </label>
              <input
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                placeholder={t("passwordPlaceholder")}
                class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
              />
            </div>

            {/* Confirm Password */}
            {password() && (
              <div>
                <label class="block text-xs text-zinc-500 dark:text-zinc-400 mb-1.5">
                  {t("confirmPasswordLabel")}
                </label>
                <input
                  type="password"
                  value={confirmPassword()}
                  onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                  placeholder={t("confirmPasswordPlaceholder")}
                  class="w-full px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:border-zinc-400 dark:focus:border-zinc-500"
                />
              </div>
            )}

            {/* Error */}
            {error() && (
              <p class="text-xs text-zinc-600 dark:text-zinc-400">{error()}</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting() || !username() ||
                usernameAvailable() === false || checkingUsername()}
              class="w-full py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed text-white dark:text-zinc-900 text-sm rounded transition-colors"
            >
              {submitting()
                ? (
                  <span class="flex items-center justify-center gap-1.5">
                    <span class="w-3 h-3 border border-white dark:border-zinc-900 border-t-transparent rounded-full animate-spin" />
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
    </div>
  );
}
