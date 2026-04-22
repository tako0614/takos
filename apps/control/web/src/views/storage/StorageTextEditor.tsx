import {
  createEffect,
  createSignal,
  lazy,
  onCleanup,
  Show,
  Suspense,
} from "solid-js";
import { useI18n } from "../../store/i18n.ts";
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
    if (!isDirty() || editedContent() === null) return;
    const success = await saveContent(props.file.id, editedContent()!);
    if (success) {
      setIsDirty(false);
      showToast("success", t("saved"));
      props.onSave?.();
    }
  };

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    globalThis.addEventListener("keydown", handler);
    onCleanup(() => globalThis.removeEventListener("keydown", handler));
  });

  const language = () => detectLanguage(props.file.name);
  const prefersDark = typeof globalThis !== "undefined" &&
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches;

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
      onClose={props.onClose}
      t={t}
      extraButtons={extraButtons()}
    >
      <Show
        when={!loading()}
        fallback={
          <div class="flex items-center justify-center h-full">
            <Icons.Loader class="w-8 h-8 animate-spin text-zinc-500" />
          </div>
        }
      >
        <Show
          when={!error()}
          fallback={
            <div class="p-4 m-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
              {error()}
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
                <div class="flex items-center justify-center h-full">
                  <Icons.Loader class="w-8 h-8 animate-spin text-zinc-500" />
                </div>
              }
            >
              <MonacoEditor
                height="100%"
                language={language()}
                theme={prefersDark ? "vs-dark" : "vs"}
                value={editedContent()!}
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
