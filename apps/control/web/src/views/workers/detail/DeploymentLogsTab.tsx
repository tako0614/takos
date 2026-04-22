import { createEffect, createSignal } from "solid-js";
import { useI18n } from "../../../store/i18n.ts";
import { useToast } from "../../../store/toast.ts";
import { useConfirmDialog } from "../../../store/confirm-dialog.ts";
import { Icons } from "../../../lib/Icons.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Badge } from "../../../components/ui/Badge.tsx";
import { rpc, rpcJson, rpcPath } from "../../../lib/rpc.ts";
import { formatDateTime } from "../../../lib/format.ts";
import type { Worker } from "../../../types/index.ts";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

interface Deployment {
  id: string;
  version: number;
  status: "pending" | "in_progress" | "success" | "failed" | "rolled_back";
  deploy_state?: string;
  artifact_ref?: string | null;
  routing_status?: "active" | "canary" | "rollback" | "archived";
  routing_weight?: number;
  bundle_hash?: string | null;
  bundle_size?: number | null;
  deployed_by?: string | null;
  deploy_message?: string | null;
  created_at: string;
  completed_at?: string | null;
  error_message?: string | null;
  events?: DeploymentEvent[];
}

interface DeploymentEvent {
  id: string;
  type: string;
  message: string;
  created_at: string;
}

interface DeploymentLogsTabProps {
  worker: Worker;
}

export function DeploymentLogsTab(props: DeploymentLogsTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [deployments, setDeployments] = createSignal<Deployment[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [expandedDeployment, setExpandedDeployment] = createSignal<
    string | null
  >(null);
  const [loadingDetailsId, setLoadingDetailsId] = createSignal<string | null>(
    null,
  );
  const [rollingBackVersion, setRollingBackVersion] = createSignal<
    number | null
  >(null);
  let deploymentsSeq = 0;
  let detailsSeq = 0;

  createEffect(() => {
    void loadDeployments();
  });

  const loadDeployments = async () => {
    const workerId = props.worker.id;
    const seq = ++deploymentsSeq;
    try {
      setLoading(true);
      const res = await rpcPath(rpc, "services", ":id", "deployments").$get({
        param: { id: workerId },
      });
      const data = await rpcJson<{ deployments: Deployment[] }>(res);
      if (seq !== deploymentsSeq || workerId !== props.worker.id) return;
      setDeployments(data.deployments || []);
    } catch (err) {
      if (seq !== deploymentsSeq || workerId !== props.worker.id) return;
      console.error("Failed to load deployments:", err);
    } finally {
      if (seq === deploymentsSeq && workerId === props.worker.id) {
        setLoading(false);
      }
    }
  };

  const loadDeploymentDetails = async (deploymentId: string) => {
    const workerId = props.worker.id;
    const seq = ++detailsSeq;
    try {
      setLoadingDetailsId(deploymentId);
      const res = await rpcPath(
        rpc,
        "services",
        ":id",
        "deployments",
        ":deploymentId",
      ).$get({
        param: { id: workerId, deploymentId },
      });
      const data = await rpcJson<{ events?: DeploymentEvent[] }>(res);

      if (seq !== detailsSeq || workerId !== props.worker.id) return;
      if (data.events) {
        setDeployments((prev) =>
          prev.map((
            d,
          ) => (d.id === deploymentId ? { ...d, events: data.events } : d))
        );
      }
    } catch (err) {
      if (seq !== detailsSeq || workerId !== props.worker.id) return;
      console.error("Failed to load deployment details:", err);
    } finally {
      if (seq === detailsSeq && workerId === props.worker.id) {
        setLoadingDetailsId(null);
      }
    }
  };

  const toggleExpanded = (deployment: Deployment) => {
    const next = expandedDeployment() === deployment.id ? null : deployment.id;
    setExpandedDeployment(next);
    if (next && !deployment.events && loadingDetailsId() !== deployment.id) {
      void loadDeploymentDetails(deployment.id);
    }
  };

  const getStatusBadge = (status: Deployment["status"]) => {
    const statusMap: Record<
      Deployment["status"],
      { variant: "default" | "success" | "warning" | "error"; label: string }
    > = {
      pending: { variant: "default", label: t("deployStatus_pending") },
      in_progress: { variant: "warning", label: t("deployStatus_in_progress") },
      success: { variant: "success", label: t("deployStatus_success") },
      failed: { variant: "error", label: t("deployStatus_failed") },
      rolled_back: { variant: "warning", label: t("deployStatus_rolled_back") },
    };
    const { variant, label } = statusMap[status] ||
      { variant: "default", label: status };
    return <Badge variant={variant}>{label}</Badge>;
  };

  const getRoutingBadge = (deployment: Deployment) => {
    if (!deployment.routing_status) return null;
    const status = deployment.routing_status;
    const weight = typeof deployment.routing_weight === "number"
      ? deployment.routing_weight
      : 0;

    const labelKeys = {
      active: "routingStatus_active",
      canary: "routingStatus_canary",
      rollback: "routingStatus_rollback",
      archived: "routingStatus_archived",
    } as const;
    const labelBase = t(labelKeys[status]);
    const label = status === "canary" ? `${labelBase} ${weight}%` : labelBase;

    let variant: "default" | "success" | "warning" | "error" = "default";
    if (status === "active") variant = "success";
    else if (status === "canary" || status === "rollback") variant = "warning";

    return <Badge variant={variant}>{label}</Badge>;
  };

  const rollbackToVersion = async (version: number) => {
    const ok = await confirm({
      title: t("confirmRollback"),
      message: t("rollbackWarning", { version }),
      confirmText: t("rollback"),
      danger: true,
    });
    if (!ok) return;

    try {
      setRollingBackVersion(version);
      const res = await rpcPath(
        rpc,
        "services",
        ":id",
        "deployments",
        "rollback",
      ).$post({
        param: { id: props.worker.id },
        json: { target_version: version },
      });
      await rpcJson(res);
      showToast("success", t("rollbackApplied"));
      await loadDeployments();
    } catch {
      showToast("error", t("failedToRollback"));
    } finally {
      setRollingBackVersion(null);
    }
  };

  const getDuration = (deployment: Deployment) => {
    if (!deployment.completed_at) return null;
    const start = new Date(deployment.created_at).getTime();
    const end = new Date(deployment.completed_at).getTime();
    const durationMs = end - start;
    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
    return `${Math.floor(durationMs / 60000)}m ${
      Math.floor((durationMs % 60000) / 1000)
    }s`;
  };

  return (
    <>
      {loading()
        ? (
          <div class="flex items-center justify-center py-12">
            <Icons.Loader class="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        )
        : deployments().length === 0
        ? (
          <Card padding="lg">
            <div class="text-center py-8">
              <Icons.Upload class="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
              <p class="text-zinc-500 dark:text-zinc-400">
                {t("noDeployments")}
              </p>
            </div>
          </Card>
        )
        : <DeploymentHistoryContent />}
    </>
  );

  function DeploymentHistoryContent() {
    return (
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {t("deploymentHistory")}
          </h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={loadDeployments}
            leftIcon={<Icons.RefreshCw class="w-4 h-4" />}
          >
            {t("refresh")}
          </Button>
        </div>

        <div class="space-y-3">
          {deployments().map((deployment: Deployment) => (
            <Card padding="none" class="overflow-hidden">
              <div
                class="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                onClick={() =>
                  toggleExpanded(deployment)}
              >
                <div class="flex items-center gap-2">
                  {expandedDeployment() === deployment.id
                    ? <Icons.ChevronDown class="w-4 h-4 text-zinc-400" />
                    : <Icons.ChevronRight class="w-4 h-4 text-zinc-400" />}
                  {getStatusBadge(deployment.status)}
                  {getRoutingBadge(deployment)}
                </div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-mono text-zinc-600 dark:text-zinc-400">
                      v{deployment.version}
                    </span>
                    {deployment.bundle_hash && (
                      <span class="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                        {deployment.bundle_hash.slice(0, 8)}
                      </span>
                    )}
                    {deployment.deployed_by && (
                      <span class="text-xs text-zinc-500">
                        {t("deployedBy")}: {deployment.deployed_by}
                      </span>
                    )}
                    {deployment.deploy_message && (
                      <span class="text-xs text-zinc-500 truncate">
                        {deployment.deploy_message}
                      </span>
                    )}
                  </div>
                </div>

                <div class="flex items-center gap-4 text-xs text-zinc-500">
                  {deployment.bundle_size && (
                    <span>{formatBytes(deployment.bundle_size)}</span>
                  )}
                  {getDuration(deployment) && (
                    <span>{getDuration(deployment)}</span>
                  )}
                  <span>{formatDateTime(deployment.created_at)}</span>
                </div>
              </div>

              {expandedDeployment() === deployment.id && (
                <div class="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3">
                  {loadingDetailsId() === deployment.id && (
                    <div class="mb-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                      <Icons.Loader class="w-4 h-4 animate-spin" />
                      <span>{t("loadingDeploymentDetails")}</span>
                    </div>
                  )}
                  {deployment.error_message && (
                    <div class="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <div class="flex items-center gap-2 text-red-700 dark:text-red-400 text-sm font-medium mb-1">
                        <Icons.AlertTriangle class="w-4 h-4" />
                        {t("deploymentFailed")}
                      </div>
                      <p class="text-sm text-red-600 dark:text-red-400 font-mono">
                        {deployment.error_message}
                      </p>
                    </div>
                  )}

                  <div class="mb-3 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                      {deployment.routing_status === "archived" &&
                        deployment.status === "success" && (
                        <Button
                          variant="danger"
                          size="sm"
                          isLoading={rollingBackVersion() ===
                            deployment.version}
                          disabled={rollingBackVersion() !== null}
                          onClick={() =>
                            void rollbackToVersion(deployment.version)}
                          leftIcon={<Icons.RefreshCw class="w-4 h-4" />}
                        >
                          {t("rollbackToVersion", {
                            version: deployment.version,
                          })}
                        </Button>
                      )}
                    </div>
                    {deployment.artifact_ref && (
                      <span class="text-xs font-mono text-zinc-500 truncate">
                        {deployment.artifact_ref}
                      </span>
                    )}
                  </div>

                  <div class="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span class="text-zinc-500 dark:text-zinc-400">
                        {t("versionLabel")}:
                      </span>
                      <span class="ml-2 font-mono text-zinc-700 dark:text-zinc-300">
                        v{deployment.version}
                      </span>
                    </div>
                    {deployment.bundle_hash && (
                      <div>
                        <span class="text-zinc-500 dark:text-zinc-400">
                          {t("bundleHash")}:
                        </span>
                        <span class="ml-2 font-mono text-zinc-700 dark:text-zinc-300">
                          {deployment.bundle_hash}
                        </span>
                      </div>
                    )}
                    {deployment.bundle_size && (
                      <div>
                        <span class="text-zinc-500 dark:text-zinc-400">
                          {t("bundleSize")}:
                        </span>
                        <span class="ml-2 text-zinc-700 dark:text-zinc-300">
                          {formatBytes(deployment.bundle_size)}
                        </span>
                      </div>
                    )}
                  </div>

                  {deployment.events && deployment.events.length > 0 && (
                    <div class="mt-4">
                      <h4 class="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                        {t("deploymentEvents")}
                      </h4>
                      <div class="space-y-2">
                        {deployment.events.map((event: DeploymentEvent) => (
                          <div class="flex items-start gap-2 text-xs">
                            <span class="text-zinc-400 font-mono whitespace-nowrap">
                              {new Date(event.created_at).toLocaleTimeString()}
                            </span>
                            <span class="text-zinc-600 dark:text-zinc-400">
                              {event.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    );
  }
}
