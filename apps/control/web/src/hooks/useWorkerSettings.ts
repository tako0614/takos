import { useCallback, useEffect, useState } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { useConfirmDialog } from '../providers/ConfirmDialogProvider';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from './useToast';
import type { Resource, Worker } from '../types';
import type {
  Binding,
  EnvVar,
  RuntimeConfig,
  WorkerDomain,
  WorkerSettingsTab,
  VerificationInfo,
} from '../views/workers/types';

export function useWorkerSettings(
  worker: Worker | null,
  onWorkerUpdated: (updates: Partial<Worker>) => void,
  onRefreshWorkers: () => void,
) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [workerSettingsTab, setWorkerSettingsTab] = useState<WorkerSettingsTab>('general');
  const [editSlug, setEditSlug] = useState('');
  const [savingSlug, setSavingSlug] = useState(false);

  const [workerDomains, setWorkerDomains] = useState<WorkerDomain[]>([]);
  const [loadingWorkerDomains, setLoadingWorkerDomains] = useState(false);
  const [newWorkerDomain, setNewWorkerDomain] = useState('');
  const [addingWorkerDomain, setAddingWorkerDomain] = useState(false);
  const [verificationInfo, setVerificationInfo] = useState<VerificationInfo | null>(null);

  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({});
  const [loadingWorkerSettings, setLoadingWorkerSettings] = useState(false);
  const [savingWorkerSettings, setSavingWorkerSettings] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [newEnvType, setNewEnvType] = useState<EnvVar['type']>('plain_text');

  const fetchWorkerSettings = useCallback(async (workerId: string) => {
    setLoadingWorkerSettings(true);
    try {
      const [envRes, bindingsRes, settingsRes] = await Promise.all([
        rpc.workers[':id'].env.$get({ param: { id: workerId } }),
        rpc.workers[':id'].bindings.$get({ param: { id: workerId } }),
        rpc.workers[':id'].settings.$get({ param: { id: workerId } }),
      ]);
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
  }, []);

  const fetchWorkerDomains = useCallback(async (workerId: string) => {
    setLoadingWorkerDomains(true);
    try {
      const res = await rpc.workers[':id']['custom-domains'].$get({ param: { id: workerId } });
      const data = await rpcJson<{ domains: WorkerDomain[] }>(res);
      setWorkerDomains(data.domains || []);
    } catch {
      setWorkerDomains([]);
    } finally {
      setLoadingWorkerDomains(false);
    }
  }, []);

  useEffect(() => {
    if (!worker) return;
    setEditSlug(worker.slug ?? '');
    setVerificationInfo(null);
    fetchWorkerDomains(worker.id);
    fetchWorkerSettings(worker.id);
  }, [fetchWorkerDomains, fetchWorkerSettings, worker]);

  const handleAddEnvVar = useCallback(() => {
    if (!newEnvName.trim()) return;
    setEnvVars(prev => [...prev, { name: newEnvName.trim(), value: newEnvValue, type: newEnvType }]);
    setNewEnvName('');
    setNewEnvValue('');
    setNewEnvType('plain_text');
  }, [newEnvName, newEnvType, newEnvValue]);

  const handleEnvVarChange = useCallback((index: number, value: string) => {
    setEnvVars(prev => prev.map((env, i) => (i === index ? { ...env, value } : env)));
  }, []);

  const handleRemoveEnvVar = useCallback((index: number) => {
    setEnvVars(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleSaveEnvVars = useCallback(async () => {
    if (!worker) return;
    setSavingWorkerSettings(true);
    try {
      const res = await rpc.workers[':id'].env.$patch({
        param: { id: worker.id },
        json: {
          variables: envVars.filter(e => e.value).map(e => ({
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
  }, [envVars, showToast, t, worker]);

  const handleAddBinding = useCallback((resource: Resource) => {
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
  }, []);

  const handleSaveBindings = useCallback(async () => {
    if (!worker) return;
    setSavingWorkerSettings(true);
    try {
      const res = await rpc.workers[':id'].bindings.$patch({
        param: { id: worker.id },
        json: { bindings },
      });
      await rpcJson(res);
      showToast('success', t('saved'));
    } catch {
      showToast('error', t('failedToSave'));
    } finally {
      setSavingWorkerSettings(false);
    }
  }, [bindings, showToast, t, worker]);

  const handleSaveRuntimeConfig = useCallback(async () => {
    if (!worker) return;
    setSavingWorkerSettings(true);
    try {
      const limits: { cpu_ms?: number; subrequests?: number } = {};
      if (runtimeConfig.cpu_ms) limits.cpu_ms = runtimeConfig.cpu_ms;
      if (runtimeConfig.subrequests) limits.subrequests = runtimeConfig.subrequests;

      const res = await rpc.workers[':id'].settings.$patch({
        param: { id: worker.id },
        json: {
          compatibility_date: runtimeConfig.compatibility_date,
          compatibility_flags: runtimeConfig.compatibility_flags,
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
  }, [runtimeConfig, showToast, t, worker]);

  const handleSaveSlug = useCallback(async () => {
    if (!worker || !editSlug.trim()) return;
    setSavingSlug(true);
    try {
      const res = await rpc.workers[':id'].slug.$patch({
        param: { id: worker.id },
        json: { slug: editSlug.trim() },
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
  }, [editSlug, onRefreshWorkers, onWorkerUpdated, showToast, t, worker]);

  const handleAddWorkerDomain = useCallback(async () => {
    if (!worker || !newWorkerDomain.trim()) return;
    setAddingWorkerDomain(true);
    try {
      const res = await rpc.workers[':id']['custom-domains'].$post({
        param: { id: worker.id },
        json: { domain: newWorkerDomain.trim() },
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
  }, [fetchWorkerDomains, newWorkerDomain, showToast, t, worker]);

  const handleVerifyWorkerDomain = useCallback(async (domainId: string) => {
    if (!worker) return;
    try {
      const res = await rpc.workers[':id']['custom-domains'][':domainId'].verify.$post({
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
  }, [fetchWorkerDomains, showToast, t, worker]);

  const handleDeleteWorkerDomain = useCallback(async (domainId: string) => {
    if (!worker) return;
    const confirmed = await confirm({
      title: t('deleteDomain'),
      message: t('confirmDeleteDomain'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await rpc.workers[':id']['custom-domains'][':domainId'].$delete({
        param: { id: worker.id, domainId },
      });
      await rpcJson(res);
      showToast('success', t('deleted'));
      fetchWorkerDomains(worker.id);
    } catch {
      showToast('error', t('failedToDelete'));
    }
  }, [confirm, fetchWorkerDomains, showToast, t, worker]);

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
