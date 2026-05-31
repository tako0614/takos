import { ErrorBoundary as SolidErrorBoundary } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../store/i18n.ts";

interface ErrorBoundaryProps {
  children: JSX.Element;
  fallback?: JSX.Element;
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  const { t } = useI18n();

  return (
    <SolidErrorBoundary
      fallback={(err, reset) => {
        if (props.fallback) {
          return props.fallback;
        }
        console.error("[ErrorBoundary]", err);
        return (
          <div class="flex flex-1 items-center justify-center p-6">
            <div class="max-w-md text-center space-y-4">
              <div class="mx-auto w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <svg
                  class="w-6 h-6 text-zinc-500 dark:text-zinc-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke-width={1.5}
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  />
                </svg>
              </div>
              <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {t("unexpectedErrorTitle")}
              </h2>
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                {t("unexpectedErrorDescription")}
              </p>
              <button
                type="button"
                onClick={reset}
                class="inline-flex items-center px-4 py-2 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
              >
                {t("tryAgain")}
              </button>
            </div>
          </div>
        );
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  );
}
