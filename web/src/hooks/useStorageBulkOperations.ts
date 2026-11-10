import { createSignal, onCleanup } from "solid-js";
import type { Setter } from "solid-js";
import { useToast } from "../store/toast.ts";
import { useI18n } from "../store/i18n.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import type { StorageFile } from "../types/index.ts";
import type { StorageBulkDeleteResult, StorageBulkRenameResult } from "./useSpaceStorage.ts";

interface UseStorageBulkOperationsParams {
  files: () => StorageFile[];
  selectedFiles: () => Set<string>;
  setSelectedFiles: Setter<Set<string>>;
  getScope: () => symbol | undefined;
  deleteItems: (ids: string[]) => Promise<StorageBulkDeleteResult | null>;
  bulkMoveItems: (ids: string[], dest: string) => Promise<boolean>;
  bulkRenameItems: (
    renames: Array<{ file_id: string; name: string }>,
    isCurrentOperation?: () => boolean,
  ) => Promise<StorageBulkRenameResult | null>;
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
  const [renameSession, setRenameSession] = createSignal<{ scope: symbol; keys: Map<string, string> }>();
  const [pendingRenameKeys, setPendingRenameKeys] = createSignal(new Set<string>());
  const isCurrentRename = (session: ReturnType<typeof renameSession>) =>
    !disposed && session !== undefined && renameSession() === session && getScope() === session.scope;
  const bulkRenaming = () => {
    const session = renameSession();
    return isCurrentRename(session) && bulkRenames().some(item => pendingRenameKeys().has(session!.keys.get(item.file_id)!));
  };

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
    const scope = getScope();
    if (disposed || !scope) return;
    const selected = Array.from(selectedFiles())
      .map((id) => files().find((f) => f.id === id))
      .filter((f): f is StorageFile => !!f);
    if (selected.length === 0) return;
    setRenameSession({ scope, keys: new Map(selected.map(file => [file.id, JSON.stringify([file.space_id, file.id])])) });
    setBulkRenames(selected.map(f => ({ file_id: f.id, old_name: f.name, name: f.name })));
    setShowBulkRenameModal(true);
  };

  const closeBulkRename = () => {
    setRenameSession(undefined);
    setShowBulkRenameModal(false);
    setBulkRenames([]);
  };

  const handleBulkRename = async () => {
    const session = renameSession();
    if (!isCurrentRename(session) || bulkRenaming()) return;
    const draft = bulkRenames();
    const renames = draft
      .filter(r => r.name.trim() && r.name.trim() !== r.old_name)
      .map((r) => ({ file_id: r.file_id, name: r.name.trim() }))
      .filter(r => session!.keys.has(r.file_id));

    if (renames.length === 0) return;

    const keys = renames.map(item => session!.keys.get(item.file_id)!);
    setPendingRenameKeys(previous => new Set([...previous, ...keys]));
    try {
      const result = await bulkRenameItems(renames, () => isCurrentRename(session));
      const hasNewerDraft = bulkRenames().some(item => item.name !== draft.find(submitted => submitted.file_id === item.file_id)?.name);
      // Reopening the same view may need a new baseline, never the old draft.
      const currentSession = renameSession();
      if (result && isCurrentRename(currentSession) && currentSession?.scope === session!.scope) {
        setBulkRenames(previous => previous.map(item => {
          const file = result.renamed.find(file => file.id === item.file_id);
          if (!file) return item;
          const submitted = draft.find(entry => entry.file_id === item.file_id);
          return { ...item, old_name: file.name,
            name: isCurrentRename(session) && item.name === submitted?.name ? file.name : item.name };
        }));
      }
      if (!isCurrentRename(session)) return;
      if (result) {
        const renamedIds = new Set(result.renamed.map(file => file.id));
        setSelectedFiles(previous => new Set([...previous].filter(id => !renamedIds.has(id))));
        if (result.failedIds.length > 0) showToast("error", t("failedToRename"));
        else {
          showToast("success", t("renamed"));
          if (!hasNewerDraft && bulkRenames().every(item => !item.name.trim() || item.name.trim() === item.old_name)) closeBulkRename();
        }
      } else showToast("error", t("failedToRename"));
    } finally {
      setPendingRenameKeys(previous => new Set([...previous].filter(key => !keys.includes(key))));
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
    showBulkRenameModal: () => showBulkRenameModal() && isCurrentRename(renameSession()),
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
