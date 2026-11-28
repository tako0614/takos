import { createUniqueId } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import { useCreateSpaceForm } from "../../../hooks/useCreateSpaceForm.ts";
import { useDialogLifecycle } from "../../../hooks/useDialogLifecycle.ts";
import { useFocusTrap } from "../../../hooks/useFocusTrap.ts";
import { Icons } from "../../../lib/Icons.tsx";
import {
  MAX_WORKSPACE_DESCRIPTION_CHARACTERS,
  MAX_WORKSPACE_NAME_CHARACTERS,
} from "takos-api-contract/shared/types";

interface CreateSpaceModalProps {
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    installFeaturedApps: boolean,
  ) => Promise<void>;
}

export function CreateSpaceModal(props: CreateSpaceModalProps) {
  const { t } = useI18n();
  const layerId = createUniqueId();
  const titleId = createUniqueId();
  const errorId = createUniqueId();
  const nameId = createUniqueId();
  const descriptionId = createUniqueId();
  let dialogRef: HTMLDivElement | undefined;

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

  const {
    name,
    setName,
    description,
    setDescription,
    installFeaturedApps,
    setInstallFeaturedApps,
    loading,
    error,
    clearError,
    handleSubmit,
  } = useCreateSpaceForm({
    onCreate: props.onCreate,
    nameRequiredMessage: t("nameRequired"),
    failedToCreateMessage: t("failedToCreate"),
  });

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4 z-50"
      onClick={props.onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        class="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-t-2xl sm:rounded-xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden shadow-lg focus:outline-none"
        style={{ "padding-bottom": "var(--spacing-safe-bottom)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2
            id={titleId}
            class="text-lg font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {t("createSpace")}
          </h2>
          <button
            type="button"
            class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
            onClick={props.onClose}
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
                class="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t("spaceName")}{" "}
                <span class="text-zinc-500 dark:text-zinc-400" aria-hidden="true">*</span>
              </label>
              <input
                id={nameId}
                type="text"
                class={`w-full min-h-[44px] px-3 py-2 bg-white dark:bg-zinc-700 border rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors ${
                  error() && !name().trim()
                    ? "border-red-500 dark:border-red-400"
                    : "border-zinc-200 dark:border-zinc-600"
                }`}
                placeholder={t("spaceNamePlaceholder")}
                value={name()}
                onInput={(e) => {
                  setName(e.currentTarget.value);
                  if (error()) clearError();
                }}
                autofocus
                required
                maxLength={MAX_WORKSPACE_NAME_CHARACTERS}
                aria-required="true"
                aria-invalid={error() ? "true" : "false"}
                aria-describedby={error() ? errorId : undefined}
              />
            </div>
            <div class="space-y-2">
              <label
                for={descriptionId}
                class="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t("description")}{" "}
                <span class="text-zinc-500 dark:text-zinc-400 text-xs">
                  ({t("optional") || "optional"})
                </span>
              </label>
              <textarea
                id={descriptionId}
                class="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-base sm:text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors resize-none"
                placeholder={t("descriptionPlaceholder")}
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                rows={3}
                maxLength={MAX_WORKSPACE_DESCRIPTION_CHARACTERS}
              />
            </div>
            <label class="flex gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                class="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:ring-zinc-100"
                checked={installFeaturedApps()}
                onChange={(e) => setInstallFeaturedApps(e.currentTarget.checked)}
              />
              <span class="space-y-1">
                <span class="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {t("installFeaturedAppsOnCreate")}
                </span>
                <span class="block text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                  {t("installFeaturedAppsOnCreateHint")}
                </span>
              </span>
            </label>
            {error() && (
              <div
                id={errorId}
                class="text-sm text-red-600 dark:text-red-400 flex items-center gap-2"
                role="alert"
              >
                <Icons.AlertTriangle class="w-4 h-4 shrink-0" />
                <span>{error()}</span>
              </div>
            )}
          </div>
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
            <button
              type="button"
              class="min-h-[44px] px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
              onClick={props.onClose}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              class="min-h-[44px] px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100"
              disabled={loading() || !name().trim()}
              aria-disabled={loading() || !name().trim()}
            >
              {loading() ? t("creating") : t("create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
