import { useI18n } from "../../../store/i18n.ts";
import { useCreateSpaceForm } from "../../../hooks/useCreateSpaceForm.ts";
import { Icons } from "../../../lib/Icons.tsx";
import { Button, Modal, ModalFooter } from "../../../components/ui/index.ts";
import {
  MAX_SPACE_DESCRIPTION_CHARACTERS,
  MAX_SPACE_NAME_CHARACTERS,
} from "takos-api-contract/shared/types";

interface CreateSpaceModalProps {
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    installFeaturedApps: boolean,
    operationId: string,
  ) => Promise<void>;
}

export function CreateSpaceModal(props: CreateSpaceModalProps) {
  const { t } = useI18n();
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

  const close = () => {
    if (!loading()) props.onClose();
  };

  return (
    <Modal
      isOpen
      onClose={close}
      title={t("createCategory")}
      descriptionId="create-category-description"
      size="md"
      showCloseButton={!loading()}
      closeOnOverlayClick={!loading()}
      closeOnEscape={!loading()}
    >
      <form onSubmit={handleSubmit}>
        <div class="space-y-5">
          <p
            id="create-category-description"
            class="m-0 text-sm leading-6 text-zinc-600 dark:text-zinc-300"
          >
            {t("createCategoryHint")}
          </p>

          <div class="space-y-2">
            <label
              for="space-name"
              class="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              {t("categoryName")} <span aria-hidden="true">*</span>
            </label>
            <input
              id="space-name"
              name="workspace-name"
              type="text"
              class={`w-full px-3 py-2.5 bg-white dark:bg-zinc-800 border rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors ${
                error() && !name().trim()
                  ? "border-zinc-500 dark:border-zinc-400"
                  : "border-zinc-200 dark:border-zinc-600"
              }`}
              placeholder={t("categoryNamePlaceholder")}
              value={name()}
              onInput={(event) => {
                setName(event.currentTarget.value);
                if (error()) clearError();
              }}
              autofocus
              required
              maxLength={MAX_SPACE_NAME_CHARACTERS}
              disabled={loading()}
              aria-required="true"
              aria-invalid={error() && !name().trim() ? "true" : "false"}
            />
          </div>

          <div class="space-y-2">
            <label
              for="space-description"
              class="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              {t("description")} {" "}
              <span class="text-xs font-normal text-zinc-500 dark:text-zinc-400">
                ({t("optional")})
              </span>
            </label>
            <textarea
              id="space-description"
              name="workspace-description"
              class="w-full px-3 py-2.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors resize-none"
              placeholder={t("categoryDescriptionPlaceholder")}
              value={description()}
              onInput={(event) => {
                setDescription(event.currentTarget.value);
                if (error()) clearError();
              }}
              rows={3}
              maxLength={MAX_SPACE_DESCRIPTION_CHARACTERS}
              disabled={loading()}
            />
          </div>

          <label
            class={`flex gap-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3 ${
              loading() ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              name="workspace-install-featured-apps"
              class="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-600 dark:bg-zinc-800 dark:focus:ring-zinc-100"
              checked={installFeaturedApps()}
              onChange={(event) => {
                setInstallFeaturedApps(event.currentTarget.checked);
                if (error()) clearError();
              }}
              disabled={loading()}
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
              class="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2"
              role="alert"
            >
              <Icons.AlertTriangle class="w-4 h-4 shrink-0" />
              <span>{error()}</span>
            </div>
          )}
        </div>

        <ModalFooter class="-mx-6 -mb-6 mt-6">
          <Button
            type="button"
            variant="secondary"
            onClick={close}
            disabled={loading()}
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            disabled={loading() || !name().trim()}
            isLoading={loading()}
          >
            {t("create")}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
