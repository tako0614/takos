import { createSignal } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useCustomTools } from "../../hooks/useCustomTools.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import type { CustomTool, Space } from "../../types/index.ts";
import { ToolCard } from "./ToolCard.tsx";
import { CreateToolModal, EditToolModal } from "./ToolModals.tsx";

interface CustomToolsSectionProps {
  spaces: Space[];
  selectedSpaceId: string | null;
  setSelectedSpaceId: (id: string) => void;
}

export function CustomToolsSection(props: CustomToolsSectionProps) {
  const { t } = useI18n();

  const {
    tools,
    loading,
    selectedTool,
    setSelectedTool,
    createTool,
    updateTool,
    deleteTool,
    toggleTool,
    executeTool,
  } = useCustomTools({ spaceId: () => props.selectedSpaceId || "" });

  const [showCreateModal, setShowCreateModal] = createSignal(false);
  const [showEditModal, setShowEditModal] = createSignal(false);
  const [editingTool, setEditingTool] = createSignal<CustomTool | null>(null);
  const [showExecuteModal, setShowExecuteModal] = createSignal(false);
  const [executeInput, setExecuteInput] = createSignal("{}");
  const [executeResult, setExecuteResult] = createSignal<string | null>(null);
  const [executing, setExecuting] = createSignal(false);

  const handleToggle = async (tool: CustomTool) => {
    await toggleTool(tool.id, !tool.enabled);
  };

  const handleExecute = async () => {
    if (!selectedTool()) return;
    setExecuting(true);
    try {
      const input = JSON.parse(executeInput());
      const result = await executeTool(selectedTool()!.name, input);
      setExecuteResult(
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    } catch (error) {
      setExecuteResult(
        error instanceof Error ? error.message : t("executionFailed"),
      );
    } finally {
      setExecuting(false);
    }
  };

  const openExecuteModal = (tool: CustomTool) => {
    setSelectedTool(tool);
    setExecuteInput("{}");
    setExecuteResult(null);
    setShowExecuteModal(true);
  };

  const openEditModal = (tool: CustomTool) => {
    setEditingTool(tool);
    setShowEditModal(true);
  };

  if (!props.selectedSpaceId) {
    return (
      <div class="flex flex-col items-center justify-center h-64 gap-4">
        <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
          <Icons.Wrench class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
        </div>
        <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {t("selectSpace")}
        </p>
      </div>
    );
  }

  return (
    <>
      {loading()
        ? (
          <div class="flex flex-col items-center justify-center h-64 gap-4">
            <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
            <span class="text-sm text-zinc-400">{t("loading")}</span>
          </div>
        )
        : tools().length === 0
        ? (
          <div class="flex flex-col items-center justify-center h-64 gap-4">
            <div class="w-16 h-16 rounded-2xl bg-zinc-50 dark:bg-zinc-800 flex items-center justify-center">
              <Icons.Wrench class="w-8 h-8 text-zinc-300 dark:text-zinc-600" />
            </div>
            <div class="text-center">
              <p class="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                {t("noCustomToolsYet")}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Icons.Plus class="w-4 h-4" />}
              onClick={() => setShowCreateModal(true)}
            >
              {t("createFirstTool")}
            </Button>
          </div>
        )
        : (
          <div class="space-y-4">
            <div class="flex justify-end">
              <button
                type="button"
                class="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-xl text-sm font-medium transition-colors"
                onClick={() => setShowCreateModal(true)}
              >
                <Icons.Plus class="w-4 h-4" />
                {t("addTool")}
              </button>
            </div>
            <div class="grid gap-3">
              {tools().map((tool) => (
                <ToolCard
                  tool={tool}
                  onToggle={() => handleToggle(tool)}
                  onEdit={() => openEditModal(tool)}
                  onExecute={() => openExecuteModal(tool)}
                  onDelete={() => deleteTool(tool.id, tool.name)}
                />
              ))}
            </div>
          </div>
        )}

      {showCreateModal() && (
        <CreateToolModal
          onClose={() => setShowCreateModal(false)}
          onCreate={async (data) => {
            await createTool(data);
            setShowCreateModal(false);
          }}
        />
      )}

      {showEditModal() && editingTool() && (
        <EditToolModal
          tool={editingTool()!}
          onClose={() => {
            setShowEditModal(false);
            setEditingTool(null);
          }}
          onSave={async (data) => {
            const success = await updateTool(editingTool()!.id, data);
            if (success) {
              setShowEditModal(false);
              setEditingTool(null);
            }
          }}
        />
      )}

      {showExecuteModal() && selectedTool() && (
        <Modal
          isOpen
          onClose={() => setShowExecuteModal(false)}
          title={`${t("test")}: ${selectedTool()!.name}`}
        >
          <div class="flex flex-col gap-4">
            <div>
              <label class="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("inputJson")}
              </label>
              <textarea
                value={executeInput()}
                onInput={(e) => setExecuteInput(e.target.value)}
                class="w-full min-h-[100px] p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-zinc-900/10 dark:focus:ring-zinc-100/10"
                placeholder="{}"
              />
            </div>

            <Button
              onClick={handleExecute}
              isLoading={executing()}
              leftIcon={<Icons.Play class="w-4 h-4" />}
            >
              {t("execute")}
            </Button>

            {executeResult() !== null && (
              <div>
                <label class="block mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t("result")}
                </label>
                <pre class="p-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 overflow-auto max-h-[200px] text-xs font-mono whitespace-pre-wrap">
                  {executeResult()}
                </pre>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
