import { createSignal, onMount } from "solid-js";
import { apiJson, rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import { getErrorMessage } from "../lib/errors.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import type { Worker } from "../types/index.ts";

const DEPLOY_LIST_TIMEOUT_MS = 15000;

function isYurucommuWorker(worker: Worker): boolean {
  if (!worker.config) return false;
  try {
    const config = JSON.parse(worker.config) as { source?: string };
    return config?.source === "yurucommu";
  } catch {
    return false;
  }
}

export function useSpaceWorkers(spaceId: string | null) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [cfWorkers, setCfWorkers] = createSignal<Worker[]>([]);
  const [loadingCfWorkers, setLoadingCfWorkers] = createSignal(true);

  const refreshWorkers = async () => {
    setLoadingCfWorkers(true);
    try {
      const data = await apiJson<{ services: Worker[] }>(
        spaceId
          ? `/api/spaces/${encodeURIComponent(spaceId)}/services`
          : "/api/services",
        { timeoutMs: DEPLOY_LIST_TIMEOUT_MS },
      );
      setCfWorkers(data.services || []);
    } catch (error) {
      setCfWorkers([]);
      showToast(
        "error",
        getErrorMessage(error, t("failedToLoad")),
      );
    } finally {
      setLoadingCfWorkers(false);
    }
  };

  onMount(() => {
    refreshWorkers();
  });

  const deleteWorker = async (worker: Worker) => {
    const baseMessage = t("confirmDeleteWorker");
    const warning = isYurucommuWorker(worker)
      ? `${baseMessage}\n\n${t("yurucommuWorkerDeleteWarning")}`
      : baseMessage;
    const confirmed = await confirm({
      title: t("deleteWorker"),
      message: warning,
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return false;
    try {
      const res = await rpcPath(rpc, "services", ":id").$delete({
        param: { id: worker.id },
      });
      await rpcJson(res);
      showToast("success", t("deleted"));
      await refreshWorkers();
      return true;
    } catch {
      showToast("error", t("failedToDelete"));
      return false;
    }
  };

  return {
    cfWorkers,
    setCfWorkers,
    loadingCfWorkers,
    refreshWorkers,
    deleteWorker,
  };
}
