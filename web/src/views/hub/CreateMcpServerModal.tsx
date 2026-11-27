import { createSignal, createUniqueId } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";

const MCP_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function CreateMcpServerModal(props: {
  onClose: () => void;
  onCreate: (
    input: { name: string; url: string; scope?: string },
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const nameErrorId = createUniqueId();
  const urlErrorId = createUniqueId();
  const [name, setName] = createSignal("");
  const [url, setUrl] = createSignal("");
  const [scope, setScope] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [showAdvanced, setShowAdvanced] = createSignal(false);

  const nameError = () =>
    name().length > 0 && !MCP_NAME_PATTERN.test(name())
      ? t("mcpNameInvalid")
      : null;

  const urlError = () => {
    if (url().length === 0) return null;
    try {
      const parsed = new URL(url());
      if (parsed.protocol !== "https:") return t("mcpUrlInvalid");
      return null;
    } catch {
      return t("mcpUrlInvalid");
    }
  };

  const canSubmit = () =>
    name().trim().length > 0 && url().trim().length > 0 && !nameError() &&
    !urlError();

  return (
    <Modal isOpen onClose={props.onClose} title={t("addMcpServer")} size="md">
      <form
        class="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit()) {
            return;
          }
          setSubmitting(true);
          try {
            await props.onCreate({
              name: name().trim(),
              url: url().trim(),
              scope: scope().trim() || undefined,
            });
          } finally {
            setSubmitting(false);
          }
        }}
      >
        <label class="block">
          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("name")}
          </span>
          <input
            value={name()}
            onInput={(e) =>
              setName(e.currentTarget.value)}
            class={`mt-2 w-full h-11 rounded-xl border ${
              nameError()
                ? "border-red-500 dark:border-red-400"
                : "border-zinc-200 dark:border-zinc-700"
            } bg-white dark:bg-zinc-900 px-3 text-base sm:text-sm text-zinc-900 dark:text-zinc-100`}
            placeholder="github"
            autofocus
            required
            aria-invalid={nameError() ? "true" : "false"}
            aria-describedby={nameError() ? nameErrorId : undefined}
          />
          {nameError() && (
            <p
              id={nameErrorId}
              role="alert"
              class="mt-1 text-xs text-red-600 dark:text-red-400"
            >
              {nameError()}
            </p>
          )}
        </label>
        <label class="block">
          <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            URL
          </span>
          <input
            type="url"
            value={url()}
            onInput={(e) =>
              setUrl(e.currentTarget.value)}
            class={`mt-2 w-full h-11 rounded-xl border ${
              urlError()
                ? "border-red-500 dark:border-red-400"
                : "border-zinc-200 dark:border-zinc-700"
            } bg-white dark:bg-zinc-900 px-3 text-base sm:text-sm text-zinc-900 dark:text-zinc-100`}
            placeholder="https://example.com/mcp"
            required
            aria-invalid={urlError() ? "true" : "false"}
            aria-describedby={urlError() ? urlErrorId : undefined}
          />
          {urlError() && (
            <p
              id={urlErrorId}
              role="alert"
              class="mt-1 text-xs text-red-600 dark:text-red-400"
            >
              {urlError()}
            </p>
          )}
        </label>

        {/* Advanced toggle */}
        <button
          type="button"
          aria-expanded={showAdvanced()}
          class="flex items-center gap-1 min-h-[36px] text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
          onClick={() =>
            setShowAdvanced(!showAdvanced())}
        >
          {showAdvanced()
            ? <Icons.ChevronDown class="w-3 h-3" />
            : <Icons.ChevronRight class="w-3 h-3" />}
          {t("mcpAdvanced")}
        </button>

        {showAdvanced() && (
          <label class="block">
            <span class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Scope
            </span>
            <input
              value={scope()}
              onInput={(e) => setScope(e.currentTarget.value)}
              class="mt-2 w-full h-11 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-base sm:text-sm text-zinc-900 dark:text-zinc-100"
              placeholder="read write"
            />
          </label>
        )}

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose} type="button">
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            isLoading={submitting()}
            disabled={!canSubmit()}
          >
            {t("addMcpServer")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
