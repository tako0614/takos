import { createSignal, createUniqueId, Show } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import { useDialogLifecycle } from "../../../hooks/useDialogLifecycle.ts";
import { useFocusTrap } from "../../../hooks/useFocusTrap.ts";
import { getErrorMessage } from "../../../lib/errors.ts";
import { Icons } from "../../../lib/Icons.tsx";

interface CreateRepoModalProps {
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    visibility: "public" | "private",
  ) => void | Promise<void>;
}

export function CreateRepoModal(props: CreateRepoModalProps) {
  const { t } = useI18n();
  const layerId = createUniqueId();
  const titleId = createUniqueId();
  const nameId = createUniqueId();
  const descriptionId = createUniqueId();
  const errorId = createUniqueId();
  let dialogRef: HTMLDivElement | undefined;

  const [name, setName] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [visibility, setVisibility] = createSignal<"public" | "private">(
    "private",
  );
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const isTopLayer = useDialogLifecycle({
    isOpen: true,
    layerId,
    get onEscape() {
      return props.onClose;
    },
    closeOnEscape: true,
    lockBodyScroll: true,
  });

  useFocusTrap({
    isOpen: true,
    getContainer: () => dialogRef,
    isTopLayer,
    respectAutofocus: true,
  });

  const handleSubmit = async (e: Event & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    if (!name().trim() || submitting()) return;
    setSubmitting(true);
    setError(null);
    try {
      await props.onCreate(name().trim(), description().trim(), visibility());
    } catch (err) {
      setError(getErrorMessage(err, t("failedToCreate")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
      onClick={() => props.onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        class="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-t-2xl sm:rounded-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden shadow-lg focus:outline-none"
        style={{ "padding-bottom": "var(--spacing-safe-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2
            id={titleId}
            class="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {t("createRepository")}
          </h2>
          <button
            type="button"
            class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200/70 dark:hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
            onClick={() => props.onClose()}
            aria-label={t("close")}
          >
            <Icons.X class="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} class="flex flex-col flex-1 min-h-0">
          <div class="px-6 py-4 space-y-4 overflow-y-auto flex-1">
            <div class="space-y-2">
              <label
                for={nameId}
                class="flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                <span>{t("repositoryName")}</span>
                <span class="text-zinc-500 dark:text-zinc-400" aria-hidden="true">*</span>
              </label>
              <input
                id={nameId}
                type="text"
                value={name()}
                onInput={(e) => {
                  setName(e.currentTarget.value);
                  if (error()) setError(null);
                }}
                placeholder="my-awesome-project"
                autofocus
                required
                class="w-full min-h-[44px] px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors"
                aria-required="true"
                aria-invalid={error() ? "true" : "false"}
                aria-describedby={error() ? errorId : undefined}
              />
            </div>
            <div class="space-y-2">
              <label
                for={descriptionId}
                class="flex items-center gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                <span>{t("description")}</span>
                <span class="text-zinc-500 dark:text-zinc-400 text-xs">
                  {`(${t("optional")})`}
                </span>
              </label>
              <textarea
                id={descriptionId}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder={t("repositoryDescriptionPlaceholder")}
                rows={3}
                class="w-full px-3 py-2 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors resize-none"
              />
            </div>
            <fieldset class="space-y-2 border-0 p-0 m-0">
              <legend class="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("visibility")}
              </legend>
              <div class="space-y-2">
                <label
                  class={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-zinc-900 dark:focus-within:ring-zinc-100 ${
                    visibility() === "public"
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-100/80 dark:bg-white/10"
                      : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100/60 dark:hover:bg-white/10"
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value="public"
                    checked={visibility() === "public"}
                    onChange={() => setVisibility("public")}
                    class="sr-only"
                  />
                  <Icons.Globe class="w-5 h-5 text-zinc-900 dark:text-zinc-100 shrink-0" aria-hidden="true" />
                  <div class="flex-1 min-w-0">
                    <strong class="block text-sm text-zinc-900 dark:text-zinc-100">
                      {t("visibilityPublic")}
                    </strong>
                    <span class="text-xs text-zinc-600 dark:text-zinc-300">
                      {t("visibilityPublicDescription")}
                    </span>
                  </div>
                </label>
                <label
                  class={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-zinc-900 dark:focus-within:ring-zinc-100 ${
                    visibility() === "private"
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-100/80 dark:bg-white/10"
                      : "border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100/60 dark:hover:bg-white/10"
                  }`}
                >
                  <input
                    type="radio"
                    name="visibility"
                    value="private"
                    checked={visibility() === "private"}
                    onChange={() => setVisibility("private")}
                    class="sr-only"
                  />
                  <Icons.Lock class="w-5 h-5 text-zinc-600 dark:text-zinc-300 shrink-0" aria-hidden="true" />
                  <div class="flex-1 min-w-0">
                    <strong class="block text-sm text-zinc-900 dark:text-zinc-100">
                      {t("visibilityPrivate")}
                    </strong>
                    <span class="text-xs text-zinc-600 dark:text-zinc-300">
                      {t("visibilityPrivateDescription")}
                    </span>
                  </div>
                </label>
              </div>
            </fieldset>
            <Show when={error()}>
              {(msg) => (
                <div
                  id={errorId}
                  role="alert"
                  class="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
                >
                  <Icons.AlertTriangle class="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{msg()}</span>
                </div>
              )}
            </Show>
          </div>
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
            <button
              type="button"
              class="min-h-[44px] px-4 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
              onClick={() => props.onClose()}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              class="min-h-[44px] px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
              disabled={submitting() || !name().trim()}
              aria-disabled={submitting() || !name().trim()}
              aria-busy={submitting() ? "true" : undefined}
            >
              {submitting() ? t("creating") : t("createRepository")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
