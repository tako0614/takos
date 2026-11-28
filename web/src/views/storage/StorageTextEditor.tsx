import {
  createEffect,
  createSignal,
  lazy,
  onCleanup,
  Show,
  Suspense,
} from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useTheme } from "../../store/theme.ts";
import { useConfirmDialog } from "../../store/confirm-dialog.ts";
import { useToast } from "../../store/toast.ts";
import { useFileContent } from "../../hooks/useFileContent.ts";
import { detectLanguage } from "../../lib/languageMap.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { StorageFile } from "../../types/index.ts";
import type { ResolvedHandler } from "./storageUtils.tsx";
import { StorageViewerShell } from "./StorageViewerShell.tsx";
import { StorageEmptyState } from "./StorageEmptyState.tsx";

const MonacoEditor = lazy(() => import("../../lib/MonacoEditor.tsx"));

export function StorageTextEditor(props: {
  spaceId: string;
  file: StorageFile;
  downloadUrl: string | null;
  allHandlers: ResolvedHandler[];
  activeHandler: ResolvedHandler;
  showHandlerMenu: boolean;
  setShowHandlerMenu: (v: boolean) => void;
  onSelectHandler: (h: ResolvedHandler, asDefault: boolean) => void;
  onClearDefault: () => void;
  onClose: () => void;
  onSave?: () => void;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const { confirm } = useConfirmDialog();

  const handleClose = async () => {
    if (isDirty()) {
      const confirmed = await confirm({
        title: t("unsavedChangesTitle"),
        message: t("unsavedChangesMessage"),
        confirmText: t("discardChanges"),
        danger: true,
      });
      if (!confirmed) return;
    }
    props.onClose();
  };
  const { showToast } = useToast();
  const {
    content,
    encoding,
    loading,
    error,
    saving,
    loadContent,
    saveContent,
  } = useFileContent(() => props.spaceId);
  const [editedContent, setEditedContent] = createSignal<string | null>(null);
  const [isDirty, setIsDirty] = createSignal(false);
  createEffect(() => {
    loadContent(props.file.id);
  });

  createEffect(() => {
    if (content() !== null) {
      setEditedContent(content());
      setIsDirty(false);
    }
  });

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setEditedContent(value);
      setIsDirty(value !== content());
    }
  };

  const handleSave = async () => {
    const current = editedContent();
    if (!isDirty() || current === null) return;
    const success = await saveContent(props.file.id, current);
    if (success) {
      setIsDirty(false);
      showToast("success", t("saved"));
      props.onSave?.();
    }
  };

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    globalThis.addEventListener("keydown", handler);
    onCleanup(() => globalThis.removeEventListener("keydown", handler));
  });

  const language = () => detectLanguage(props.file.name);

  const extraButtons = () =>
    isDirty()
      ? (
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          isLoading={saving()}
          leftIcon={<Icons.Save class="w-4 h-4" />}
        >
          {t("save")}
        </Button>
      )
      : undefined;

  return (
    <StorageViewerShell
      file={props.file}
      downloadUrl={props.downloadUrl}
      allHandlers={props.allHandlers}
      activeHandler={props.activeHandler}
      showHandlerMenu={props.showHandlerMenu}
      setShowHandlerMenu={props.setShowHandlerMenu}
      onSelectHandler={props.onSelectHandler}
      onClearDefault={props.onClearDefault}
      onClose={handleClose}
      t={t}
      extraButtons={extraButtons()}
    >
      <Show
        when={!loading()}
        fallback={
          <div
            role="status"
            aria-live="polite"
            class="flex items-center justify-center h-full"
          >
            <Icons.Loader class="w-8 h-8 animate-spin text-zinc-500" aria-hidden="true" />
            <span class="sr-only">{t("loading")}</span>
          </div>
        }
      >
        <Show
          when={!error()}
          fallback={
            <div
              role="alert"
              class="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
            >
              <span class="min-w-0 flex-1">{error()}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void loadContent(props.file.id)}
              >
                {t("retry")}
              </Button>
            </div>
          }
        >
          <Show
            when={encoding() === "utf-8" && editedContent() !== null}
            fallback={
              <Show
                when={encoding() === "base64"}
                fallback={
                  <StorageEmptyState
                    file={props.file}
                    downloadUrl={props.downloadUrl}
                    t={t}
                  />
                }
              >
                <StorageEmptyState
                  file={props.file}
                  downloadUrl={props.downloadUrl}
                  t={t}
                  label={t("binaryFile")}
                />
              </Show>
            }
          >
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-live="polite"
                  class="flex items-center justify-center h-full"
                >
                  <Icons.Loader class="w-8 h-8 animate-spin text-zinc-500" aria-hidden="true" />
                  <span class="sr-only">{t("loading")}</span>
                </div>
              }
            >
              <MonacoEditor
                height="100%"
                language={language()}
                theme={theme.resolvedTheme === "dark" ? "vs-dark" : "vs"}
                value={editedContent() ?? ""}
                onChange={handleEditorChange}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  wordWrap: "on",
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            </Suspense>
          </Show>
        </Show>
      </Show>
    </StorageViewerShell>
  );
}
