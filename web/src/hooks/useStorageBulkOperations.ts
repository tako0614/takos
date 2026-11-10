import { createSignal, onCleanup } from "solid-js";
import type { Setter } from "solid-js";
import { useToast } from "../store/toast.ts";
import { useI18n } from "../store/i18n.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import type { StorageFile } from "../types/index.ts";
import type { StorageBulkDeleteResult } from "./useSpaceStorage.ts";

interface UseStorageBulkOperationsParams {
  files: () => StorageFile[];
  selectedFiles: () => Set<string>;
  setSelectedFiles: Setter<Set<string>>;
  getScope: () => symbol | undefined;
  deleteItems: (ids: string[]) => Promise<StorageBulkDeleteResult | null>;
  bulkMoveItems: (ids: string[], dest: string) => Promise<boolean>;
  bulkRenameItems: (
    renames: Array<{ file_id: string; name: string }>,
  ) => Promise<boolean>;
}

function normalizePath(path: string): string {
  let p = (path || "").trim();
  if (!p) return "/";
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

interface UseStorageBulkOperationsResult {
  showBulkMoveModal: () => boolean;
  bulkMovePath: () => string;
  setBulkMovePath: Setter<string>;
  bulkMoving: () => boolean;
  showBulkRenameModal: () => boolean;
  bulkRenames: () => Array<{ file_id: string; old_name: string; name: string }>;
  setBulkRenames: Setter<
    Array<{ file_id: string; old_name: string; name: string }>
  >;
  bulkRenaming: () => boolean;
  openBulkMove: () => void;
  closeBulkMove: () => void;
  handleBulkMove: () => Promise<void>;
  openBulkRename: () => void;
  closeBulkRename: () => void;
  handleBulkRename: () => Promise<void>;
  handleBulkDelete: () => Promise<void>;
  normalizePath: (path: string) => string;
}

export function useStorageBulkOperations({
  files,
  selectedFiles,
  setSelectedFiles,
  getScope,
  deleteItems,
  bulkMoveItems,
  bulkRenameItems,
}: UseStorageBulkOperationsParams): UseStorageBulkOperationsResult {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  let disposed = false;
  let pendingDeleteScope: symbol | undefined;
  onCleanup(() => { disposed = true; });

  const [showBulkMoveModal, setShowBulkMoveModal] = createSignal(false);
  const [bulkMovePath, setBulkMovePath] = createSignal("");
  const [bulkMoving, setBulkMoving] = createSignal(false);
  const [showBulkRenameModal, setShowBulkRenameModal] = createSignal(false);
  const [bulkRenames, setBulkRenames] = createSignal<
    Array<{ file_id: string; old_name: string; name: string }>
  >([]);
  const [bulkRenaming, setBulkRenaming] = createSignal(false);

  const openBulkMove = () => {
    setBulkMovePath("/");
    setShowBulkMoveModal(true);
  };

  const closeBulkMove = () => {
    setShowBulkMoveModal(false);
    setBulkMovePath("");
  };

  const handleBulkMove = async () => {
    if (selectedFiles().size === 0) return;
    const dest = normalizePath(bulkMovePath());

    setBulkMoving(true);
    const ok = await bulkMoveItems(Array.from(selectedFiles()), dest);
    setBulkMoving(false);

    if (ok) {
      showToast("success", t("moved"));
      setSelectedFiles(new Set<string>());
      setShowBulkMoveModal(false);
    } else {
      showToast("error", t("failedToSave"));
    }
  };

  const openBulkRename = () => {
    const items = Array.from(selectedFiles())
      .map((id) => files().find((f) => f.id === id))
      .filter((f): f is StorageFile => !!f)
      .map((f) => ({ file_id: f.id, old_name: f.name, name: f.name }));
    setBulkRenames(items);
    setShowBulkRenameModal(true);
  };

  const closeBulkRename = () => {
    setShowBulkRenameModal(false);
    setBulkRenames([]);
  };

  const handleBulkRename = async () => {
    const renames = bulkRenames()
      .map((r) => ({ file_id: r.file_id, name: r.name.trim() }))
      .filter((r) => r.name.length > 0);

    if (renames.length === 0) return;

    setBulkRenaming(true);
    const ok = await bulkRenameItems(renames);
    setBulkRenaming(false);

    if (ok) {
      showToast("success", t("renamed"));
      setSelectedFiles(new Set<string>());
      setShowBulkRenameModal(false);
    } else {
      showToast("error", t("failedToRename"));
    }
  };

  const handleBulkDelete = async () => {
    if (disposed) return;
    const ids = Array.from(selectedFiles()), scope = getScope();
    if (ids.length === 0 || !scope || pendingDeleteScope === scope) return;
    const isCurrent = () => !disposed && getScope() === scope;
    pendingDeleteScope = scope;
    try {
      const confirmed = await confirm({
        title: t("deleteSelectedTitle"),
        message: t("deleteSelectedConfirm").replace("{count}", String(ids.length)),
        confirmText: t("delete"),
        danger: true,
      });
      if (!confirmed || !isCurrent()) return;
      const result = await deleteItems(ids);
      if (!isCurrent()) return;
      if (result) {
        setSelectedFiles(prev => new Set([...prev].filter(id => !ids.includes(id) || result.failedIds.includes(id))));
        if (result.failedIds.length > 0) showToast("error", t("failedToDeleteSome"));
        else showToast("success", t("itemsDeleted").replace("{count}", String(ids.length)));
      } else {
        showToast("error", t("failedToDeleteSome"));
      }
    } finally {
      if (pendingDeleteScope === scope) pendingDeleteScope = undefined;
    }
  };

  return {
    showBulkMoveModal,
    bulkMovePath,
    setBulkMovePath,
    bulkMoving,
    showBulkRenameModal,
    bulkRenames,
    setBulkRenames,
    bulkRenaming,
    openBulkMove,
    closeBulkMove,
    handleBulkMove,
    openBulkRename,
    closeBulkRename,
    handleBulkRename,
    handleBulkDelete,
    normalizePath,
  };
}
