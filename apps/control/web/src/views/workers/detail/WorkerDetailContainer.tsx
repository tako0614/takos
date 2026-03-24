import { useCallback } from 'react';
import type { Resource, Worker } from '../../../types';
import { WorkerDetail } from '../WorkerDetail';
import type { WorkerDetailTab } from '../types';
import { useWorkerSettings } from '../../../hooks/useWorkerSettings';

export interface WorkerDetailContainerProps {
  worker: Worker;
  tab: WorkerDetailTab;
  resources: Resource[];
  onBack: () => void;
  onTabChange: (tab: WorkerDetailTab) => void;
  onDeleteWorker: (worker: Worker) => void;
  onWorkerUpdated: (workerId: string, updates: Partial<Worker>) => void;
  onRefreshWorkers: () => Promise<void> | void;
}

export function WorkerDetailContainer({
  worker,
  tab,
  resources,
  onBack,
  onTabChange,
  onDeleteWorker,
  onWorkerUpdated,
  onRefreshWorkers,
}: WorkerDetailContainerProps) {
  const handleWorkerUpdated = useCallback((updates: Partial<Worker>) => {
    onWorkerUpdated(worker.id, updates);
  }, [onWorkerUpdated, worker.id]);

  const settings = useWorkerSettings(worker, handleWorkerUpdated, onRefreshWorkers);

  return (
    <WorkerDetail
      worker={worker}
      tab={tab}
      onBack={onBack}
      onTabChange={onTabChange}
      onDeleteWorker={onDeleteWorker}
      workerSettingsTab={settings.workerSettingsTab}
      onWorkerSettingsTabChange={settings.setWorkerSettingsTab}
      editSlug={settings.editSlug}
      onEditSlugChange={settings.setEditSlug}
      onSaveSlug={settings.handleSaveSlug}
      savingSlug={settings.savingSlug}
      workerDomains={settings.workerDomains}
      loadingWorkerDomains={settings.loadingWorkerDomains}
      verificationInfo={settings.verificationInfo}
      onCloseVerificationInfo={() => settings.setVerificationInfo(null)}
      newWorkerDomain={settings.newWorkerDomain}
      onNewWorkerDomainChange={settings.setNewWorkerDomain}
      onAddWorkerDomain={settings.handleAddWorkerDomain}
      addingWorkerDomain={settings.addingWorkerDomain}
      onVerifyWorkerDomain={settings.handleVerifyWorkerDomain}
      onDeleteWorkerDomain={settings.handleDeleteWorkerDomain}
      loadingWorkerSettings={settings.loadingWorkerSettings}
      envVars={settings.envVars}
      onEnvVarChange={settings.handleEnvVarChange}
      onRemoveEnvVar={settings.handleRemoveEnvVar}
      newEnvName={settings.newEnvName}
      onNewEnvNameChange={settings.setNewEnvName}
      newEnvValue={settings.newEnvValue}
      onNewEnvValueChange={settings.setNewEnvValue}
      newEnvType={settings.newEnvType}
      onNewEnvTypeChange={settings.setNewEnvType}
      onAddEnvVar={settings.handleAddEnvVar}
      onSaveEnvVars={settings.handleSaveEnvVars}
      bindings={settings.bindings}
      resources={resources}
      onAddBinding={settings.handleAddBinding}
      onSaveBindings={settings.handleSaveBindings}
      runtimeConfig={settings.runtimeConfig}
      onRuntimeConfigChange={settings.setRuntimeConfig}
      onSaveRuntimeConfig={settings.handleSaveRuntimeConfig}
      savingWorkerSettings={settings.savingWorkerSettings}
    />
  );
}
