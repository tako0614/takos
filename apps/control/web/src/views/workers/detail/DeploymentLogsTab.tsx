import { useState, useEffect } from 'react';
import { useI18n } from '../../../store/i18n';
import { useToast } from '../../../store/toast';
import { useConfirmDialog } from '../../../store/confirm-dialog';
import { Icons } from '../../../lib/Icons';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { rpc, rpcJson } from '../../../lib/rpc';
import { formatDateTime } from '../../../lib/format';
import type { Worker } from '../../../types';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

interface Deployment {
  id: string;
  version: number;
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'rolled_back';
  deploy_state?: string;
  artifact_ref?: string | null;
  routing_status?: 'active' | 'canary' | 'rollback' | 'archived';
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

export function DeploymentLogsTab({ worker }: DeploymentLogsTabProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDeployment, setExpandedDeployment] = useState<string | null>(null);
  const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);
  const [rollingBackVersion, setRollingBackVersion] = useState<number | null>(null);

  useEffect(() => {
    loadDeployments();
  }, [worker.id]);

  const loadDeployments = async () => {
    try {
      setLoading(true);
      const res = await rpc.workers[':id'].deployments.$get({
        param: { id: worker.id },
      });
      const data = await rpcJson<{ deployments: Deployment[] }>(res);
      setDeployments(data.deployments || []);
    } catch (err) {
      console.error('Failed to load deployments:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDeploymentDetails = async (deploymentId: string) => {
    try {
      setLoadingDetailsId(deploymentId);
      const res = await rpc.workers[':id'].deployments[':deploymentId'].$get({
        param: { id: worker.id, deploymentId },
      });
      const data = await rpcJson<{ events?: DeploymentEvent[] }>(res);

      if (data.events) {
        setDeployments((prev) =>
          prev.map((d) => (d.id === deploymentId ? { ...d, events: data.events } : d))
        );
      }
    } catch (err) {
      console.error('Failed to load deployment details:', err);
    } finally {
      setLoadingDetailsId(null);
    }
  };

  const toggleExpanded = (deployment: Deployment) => {
    const next = expandedDeployment === deployment.id ? null : deployment.id;
    setExpandedDeployment(next);
    if (next && !deployment.events && loadingDetailsId !== deployment.id) {
      void loadDeploymentDetails(deployment.id);
    }
  };

  const getStatusBadge = (status: Deployment['status']) => {
    const statusMap: Record<Deployment['status'], { variant: 'default' | 'success' | 'warning' | 'error'; label: string }> = {
      pending: { variant: 'default', label: t('deployStatus_pending') },
      in_progress: { variant: 'warning', label: t('deployStatus_in_progress') },
      success: { variant: 'success', label: t('deployStatus_success') },
      failed: { variant: 'error', label: t('deployStatus_failed') },
      rolled_back: { variant: 'warning', label: t('deployStatus_rolled_back') },
    };
    const { variant, label } = statusMap[status] || { variant: 'default', label: status };
    return <Badge variant={variant}>{label}</Badge>;
  };

  const getRoutingBadge = (deployment: Deployment) => {
    if (!deployment.routing_status) return null;
    const status = deployment.routing_status;
    const weight = typeof deployment.routing_weight === 'number' ? deployment.routing_weight : 0;

    const labelKeys = {
      active: 'routingStatus_active',
      canary: 'routingStatus_canary',
      rollback: 'routingStatus_rollback',
      archived: 'routingStatus_archived',
    } as const;
    const labelBase = t(labelKeys[status]);
    const label = status === 'canary' ? `${labelBase} ${weight}%` : labelBase;

    let variant: 'default' | 'success' | 'warning' | 'error' = 'default';
    if (status === 'active') variant = 'success';
    else if (status === 'canary' || status === 'rollback') variant = 'warning';

    return <Badge variant={variant}>{label}</Badge>;
  };

  const rollbackToVersion = async (version: number) => {
    const ok = await confirm({
      title: t('confirmRollback'),
      message: t('rollbackWarning', { version }),
      confirmText: t('rollback'),
      danger: true,
    });
    if (!ok) return;

    try {
      setRollingBackVersion(version);
      const res = await rpc.workers[':id'].deployments.rollback.$post({
        param: { id: worker.id },
        json: { target_version: version },
      });
      await rpcJson(res);
      showToast('success', t('rollbackApplied'));
      await loadDeployments();
    } catch {
      showToast('error', t('failedToRollback'));
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
    return `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Icons.Loader className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (deployments.length === 0) {
    return (
      <Card padding="lg">
        <div className="text-center py-8">
          <Icons.Upload className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400">{t('noDeployments')}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('deploymentHistory')}</h2>
        <Button variant="secondary" size="sm" onClick={loadDeployments} leftIcon={<Icons.RefreshCw className="w-4 h-4" />}>
          {t('refresh')}
        </Button>
      </div>

      <div className="space-y-3">
        {deployments.map((deployment) => (
          <Card key={deployment.id} padding="none" className="overflow-hidden">
            <div
              className="flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              onClick={() => toggleExpanded(deployment)}
            >
              <div className="flex items-center gap-2">
                {expandedDeployment === deployment.id ? (
                  <Icons.ChevronDown className="w-4 h-4 text-zinc-400" />
                ) : (
                  <Icons.ChevronRight className="w-4 h-4 text-zinc-400" />
                )}
                {getStatusBadge(deployment.status)}
                {getRoutingBadge(deployment)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono text-zinc-600 dark:text-zinc-400">
                    v{deployment.version}
                  </span>
                  {deployment.bundle_hash && (
                    <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
                      {deployment.bundle_hash.slice(0, 8)}
                    </span>
                  )}
                  {deployment.deployed_by && (
                    <span className="text-xs text-zinc-500">
                      {t('deployedBy')}: {deployment.deployed_by}
                    </span>
                  )}
                  {deployment.deploy_message && (
                    <span className="text-xs text-zinc-500 truncate">
                      {deployment.deploy_message}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-zinc-500">
                {deployment.bundle_size && (
                  <span>{formatBytes(deployment.bundle_size)}</span>
                )}
                {getDuration(deployment) && (
                  <span>{getDuration(deployment)}</span>
                )}
                <span>{formatDateTime(deployment.created_at)}</span>
              </div>
            </div>

            {expandedDeployment === deployment.id && (
              <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-4 py-3">
                {loadingDetailsId === deployment.id && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <Icons.Loader className="w-4 h-4 animate-spin" />
                    <span>Loading deployment details...</span>
                  </div>
                )}
                {deployment.error_message && (
                  <div className="mb-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400 text-sm font-medium mb-1">
                      <Icons.AlertTriangle className="w-4 h-4" />
                      {t('deploymentFailed')}
                    </div>
                    <p className="text-sm text-red-600 dark:text-red-400 font-mono">{deployment.error_message}</p>
                  </div>
                )}

                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {deployment.routing_status === 'archived' && deployment.status === 'success' && (
                      <Button
                        variant="danger"
                        size="sm"
                        isLoading={rollingBackVersion === deployment.version}
                        disabled={rollingBackVersion !== null}
                        onClick={() => void rollbackToVersion(deployment.version)}
                        leftIcon={<Icons.RefreshCw className="w-4 h-4" />}
                      >
                        {t('rollbackToVersion', { version: deployment.version })}
                      </Button>
                    )}
                  </div>
                  {deployment.artifact_ref && (
                    <span className="text-xs font-mono text-zinc-500 truncate">
                      {deployment.artifact_ref}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">Version:</span>
                    <span className="ml-2 font-mono text-zinc-700 dark:text-zinc-300">v{deployment.version}</span>
                  </div>
                  {deployment.bundle_hash && (
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400">{t('bundleHash')}:</span>
                      <span className="ml-2 font-mono text-zinc-700 dark:text-zinc-300">{deployment.bundle_hash}</span>
                    </div>
                  )}
                  {deployment.bundle_size && (
                    <div>
                      <span className="text-zinc-500 dark:text-zinc-400">{t('bundleSize')}:</span>
                      <span className="ml-2 text-zinc-700 dark:text-zinc-300">{formatBytes(deployment.bundle_size)}</span>
                    </div>
                  )}
                </div>

                {deployment.events && deployment.events.length > 0 && (
                  <div className="mt-4">
                    <h4 className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t('deploymentEvents')}</h4>
                    <div className="space-y-2">
                      {deployment.events.map((event) => (
                        <div key={event.id} className="flex items-start gap-2 text-xs">
                          <span className="text-zinc-400 font-mono whitespace-nowrap">
                            {new Date(event.created_at).toLocaleTimeString()}
                          </span>
                          <span className="text-zinc-600 dark:text-zinc-400">{event.message}</span>
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
