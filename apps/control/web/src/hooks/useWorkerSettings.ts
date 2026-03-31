import { createSignal, createEffect, on } from 'solid-js';
import { rpc, rpcJson, rpcPath } from '../lib/rpc.ts';
import { useConfirmDialog } from '../store/confirm-dialog.ts';
import { useI18n } from '../store/i18n.ts';
import { useToast } from '../store/toast.ts';
import type { Resource, Worker } from '../types/index.ts';
import type {
  Binding,
  EnvVar,
  RuntimeConfig,
  WorkerDomain,
  WorkerSettingsTab,
  VerificationInfo,
} from '../views/workers/worker-models.ts';

export function useWorkerSettings(
  worker: Worker | null,
  onWorkerUpdated: (updates: Partial<Worker>) => void,
  onRefreshWorkers: () => void,
) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [workerSettingsTab, setWorkerSettingsTab] = createSignal<WorkerSettingsTab>('general');
  const [editSlug, setEditSlug] = createSignal('');
  const [savingSlug, setSavingSlug] = createSignal(false);

  const [workerDomains, setWorkerDomains] = createSignal<WorkerDomain[]>([]);
  const [loadingWorkerDomains, setLoadingWorkerDomains] = createSignal(false);
  const [newWorkerDomain, setNewWorkerDomain] = createSignal('');
  const [addingWorkerDomain, setAddingWorkerDomain] = createSignal(false);
  const [verificationInfo, setVerificationInfo] = createSignal<VerificationInfo | null>(null);

  const [envVars, setEnvVars] = createSignal<EnvVar[]>([]);
  const [bindings, setBindings] = createSignal<Binding[]>([]);
  const [runtimeConfig, setRuntimeConfig] = createSignal<RuntimeConfig>({});
  const [loadingWorkerSettings, setLoadingWorkerSettings] = createSignal(false);
  const [savingWorkerSettings, setSavingWorkerSettings] = createSignal(false);
  const [newEnvName, setNewEnvName] = createSignal('');
  const [newEnvValue, setNewEnvValue] = createSignal('');
  const [newEnvType, setNewEnvType] = createSignal<EnvVar['type']>('plain_text');

  const fetchWorkerSettings = async (workerId: string) => {
    setLoadingWorkerSettings(true);
    try {
      const [envRes, bindingsRes, settingsRes] = await Promise.all([
        rpcPath(rpc, 'workers', ':id', 'env').$get({ param: { id: workerId } }),
        rpcPath(rpc, 'workers', ':id', 'bindings').$get({ param: { id: workerId } }),
        rpcPath(rpc, 'workers', ':id', 'settings').$get({ param: { id: workerId } }),
      ]) as [Response, Response, Response];
      const [envData, bindingsData, settingsData] = await Promise.all([
        rpcJson<{ env: { name: string; type: string; value?: string }[] }>(envRes),
        rpcJson<{ bindings: { type: string; name: string; resource_id?: string }[] }>(bindingsRes),
        rpcJson<{ compatibility_date?: string; compatibility_flags?: string[]; limits?: { cpu_ms?: number; subrequests?: number } }>(settingsRes),
      ]);
      setEnvVars((envData.env || []).map(e => ({
        name: e.name,
        value: e.value || '',
        type: e.type as 'plain_text' | 'secret_text',
      })));
      setBindings(bindingsData.bindings || []);
      setRuntimeConfig({
        compatibility_date: settingsData.compatibility_date,
        compatibility_flags: settingsData.compatibility_flags,
        cpu_ms: settingsData.limits?.cpu_ms,
        subrequests: settingsData.limits?.subrequests,
      });
    } catch {
      setEnvVars([]);
      setBindings([]);
      setRuntimeConfig({});
    } finally {
      setLoadingWorkerSettings(false);
    }
  };

  const fetchWorkerDomains = async (workerId: string) => {
    setLoadingWorkerDomains(true);
    try {
      const res = await rpcPath(rpc, 'workers', ':id', 'custom-domains').$get({ param: { id: workerId } }) as Response;
      const data = await rpcJson<{ domains: WorkerDomain[] }>(res);
      setWorkerDomains(data.domains || []);
    } catch {
      setWorkerDomains([]);
    } finally {
      setLoadingWorkerDomains(false);
    }
  };

  createEffect(on(() => worker, () => {
    if (!worker) return;
    setEditSlug(worker.slug ?? '');
    setVerificationInfo(null);
    fetchWorkerDomains(worker.id);
    fetchWorkerSettings(worker.id);
  }));

  const handleAddEnvVar = () => {
    if (!newEnvName().trim()) return;
    setEnvVars(prev => [...prev, { name: newEnvName().trim(), value: newEnvValue(), type: newEnvType() }]);
    setNewEnvName('');
    setNewEnvValue('');
    setNewEnvType('plain_text');
  };

  const handleEnvVarChange = (index: number, value: string) => {
    setEnvVars(prev => prev.map((env, i) => (i === index ? { ...env, value } : env)));
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveEnvVars = async () => {
    if (!worker) return;
    setSavingWorkerSettings(true);
    try {
      const res = await rpcPath(rpc, 'workers', ':id', 'env').$patch({
        param: { id: worker.id },
        json: {
          variables: envVars().filter(e => e.value).map(e => ({
            name: e.name,
            value: e.value,
            secret: e.type === 'secret_text',
          })),
        },
      });
      await rpcJson(res);
      showToast('success', t('saved'));
    } catch {
      showToast('error', t('failedToSave'));
    } finally {
      setSavingWorkerSettings(false);
    }
  };

  const handleAddBinding = (resource: Resource) => {
    let bindingType: string;
    switch (resource.type) {
      case 'd1': bindingType = 'd1'; break;
      case 'r2': bindingType = 'r2_bucket'; break;
      case 'kv': bindingType = 'kv_namespace'; break;
      default: bindingType = 'service'; break;
    }
    setBindings(prev => [
      ...prev,
      {
        type: bindingType,
        name: resource.name.toUpperCase().replace(/[^A-Z0-9]/g, '_'),
        resource_name: resource.name,
      },
    ]);
  };

  const handleSaveBindings = async () => {
    if (!worker) return;
    setSavingWorkerSettings(true);
    try {
      const res = await rpcPath(rpc, 'workers', ':id', 'bindings').$patch({
        param: { id: worker.id },
        json: { bindings: bindings() },
      });
      await rpcJson(res);
      showToast('success', t('saved'));
    } catch {
      showToast('error', t('failedToSave'));
    } finally {
      setSavingWorkerSettings(false);
    }
  };

  const handleSaveRuntimeConfig = async () => {
    if (!worker) return;
    setSavingWorkerSettings(true);
    try {
      const config = runtimeConfig();
      const limits: { cpu_ms?: number; subrequests?: number } = {};
      if (config.cpu_ms) limits.cpu_ms = config.cpu_ms;
      if (config.subrequests) limits.subrequests = config.subrequests;

      const res = await rpcPath(rpc, 'workers', ':id', 'settings').$patch({
        param: { id: worker.id },
        json: {
          compatibility_date: config.compatibility_date,
          compatibility_flags: config.compatibility_flags,
          limits: Object.keys(limits).length > 0 ? limits : undefined,
        },
      });
      await rpcJson(res);
      showToast('success', t('saved'));
    } catch {
      showToast('error', t('failedToSave'));
    } finally {
      setSavingWorkerSettings(false);
    }
  };

  const handleSaveSlug = async () => {
    if (!worker || !editSlug().trim()) return;
    setSavingSlug(true);
    try {
      const res = await rpcPath(rpc, 'workers', ':id', 'slug').$patch({
        param: { id: worker.id },
        json: { slug: editSlug().trim() },
      });
      const result = await rpcJson<{ success: boolean; slug: string; hostname: string }>(res);
      showToast('success', t('saved'));
      onWorkerUpdated({ slug: result.slug, hostname: result.hostname });
      await onRefreshWorkers();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToSave'));
    } finally {
      setSavingSlug(false);
    }
  };

  const handleAddWorkerDomain = async () => {
    if (!worker || !newWorkerDomain().trim()) return;
    setAddingWorkerDomain(true);
    try {
      const res = await rpcPath(rpc, 'workers', ':id', 'custom-domains').$post({
        param: { id: worker.id },
        json: { domain: newWorkerDomain().trim() },
      });
      const result = await rpcJson<{
        domain: { id: string; domain: string; status: string; verification_method: string };
        verification: { method: string; record: string; target: string; instructions: string };
      }>(res);
      setNewWorkerDomain('');
      setVerificationInfo(result.verification);
      showToast('success', t('domainAdded'));
      fetchWorkerDomains(worker.id);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToAddDomain'));
    } finally {
      setAddingWorkerDomain(false);
    }
  };

  const handleVerifyWorkerDomain = async (domainId: string) => {
    if (!worker) return;
    try {
      const res = await rpcPath(rpc, 'workers', ':id', 'custom-domains', ':domainId', 'verify').$post({
        param: { id: worker.id, domainId },
      });
      const result = await rpcJson<{ verified: boolean; message: string }>(res);
      if (result.verified) {
        showToast('success', t('domainVerified'));
        setVerificationInfo(null);
      } else {
        showToast('error', result.message || t('verificationFailed'));
      }
      fetchWorkerDomains(worker.id);
    } catch {
      showToast('error', t('verificationFailed'));
    }
  };

  const handleDeleteWorkerDomain = async (domainId: string) => {
    if (!worker) return;
    const confirmed = await confirm({
      title: t('deleteDomain'),
      message: t('confirmDeleteDomain'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await rpcPath(rpc, 'workers', ':id', 'custom-domains', ':domainId').$delete({
        param: { id: worker.id, domainId },
      });
      await rpcJson(res);
      showToast('success', t('deleted'));
      fetchWorkerDomains(worker.id);
    } catch {
      showToast('error', t('failedToDelete'));
    }
  };

  return {
    workerSettingsTab,
    setWorkerSettingsTab,
    editSlug,
    setEditSlug,
    handleSaveSlug,
    savingSlug,
    workerDomains,
    loadingWorkerDomains,
    verificationInfo,
    setVerificationInfo,
    newWorkerDomain,
    setNewWorkerDomain,
    handleAddWorkerDomain,
    addingWorkerDomain,
    handleVerifyWorkerDomain,
    handleDeleteWorkerDomain,
    loadingWorkerSettings,
    envVars,
    handleEnvVarChange,
    handleRemoveEnvVar,
    newEnvName,
    setNewEnvName,
    newEnvValue,
    setNewEnvValue,
    newEnvType,
    setNewEnvType,
    handleAddEnvVar,
    handleSaveEnvVars,
    bindings,
    handleAddBinding,
    handleSaveBindings,
    runtimeConfig,
    setRuntimeConfig,
    handleSaveRuntimeConfig,
    savingWorkerSettings,
  };
}
