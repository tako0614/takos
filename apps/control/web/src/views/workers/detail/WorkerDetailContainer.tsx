import type { Resource, Worker } from "../../../types/index.ts";
import { WorkerDetail } from "../WorkerDetail.tsx";
import type { WorkerDetailTab } from "../worker-models.ts";
import { useWorkerSettings } from "../../../hooks/useWorkerSettings.ts";

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

export function WorkerDetailContainer(props: WorkerDetailContainerProps) {
  const handleWorkerUpdated = (updates: Partial<Worker>) => {
    props.onWorkerUpdated(props.worker.id, updates);
  };

  const settings = useWorkerSettings(
    () => props.worker,
    handleWorkerUpdated,
    props.onRefreshWorkers,
  );

  return (
    <WorkerDetail
      worker={props.worker}
      tab={props.tab}
      onBack={props.onBack}
      onTabChange={props.onTabChange}
      onDeleteWorker={props.onDeleteWorker}
      workerSettingsTab={settings.workerSettingsTab()}
      onWorkerSettingsTabChange={settings.setWorkerSettingsTab}
      editSlug={settings.editSlug()}
      onEditSlugChange={settings.setEditSlug}
      onSaveSlug={settings.handleSaveSlug}
      savingSlug={settings.savingSlug()}
      workerDomains={settings.workerDomains()}
      loadingWorkerDomains={settings.loadingWorkerDomains()}
      verificationInfo={settings.verificationInfo()}
      onCloseVerificationInfo={() => settings.setVerificationInfo(null)}
      newWorkerDomain={settings.newWorkerDomain()}
      onNewWorkerDomainChange={settings.setNewWorkerDomain}
      onAddWorkerDomain={settings.handleAddWorkerDomain}
      addingWorkerDomain={settings.addingWorkerDomain()}
      onVerifyWorkerDomain={settings.handleVerifyWorkerDomain}
      onDeleteWorkerDomain={settings.handleDeleteWorkerDomain}
      loadingWorkerSettings={settings.loadingWorkerSettings()}
      envVars={settings.envVars()}
      onEnvVarChange={settings.handleEnvVarChange}
      onRemoveEnvVar={settings.handleRemoveEnvVar}
      newEnvName={settings.newEnvName()}
      onNewEnvNameChange={settings.setNewEnvName}
      newEnvValue={settings.newEnvValue()}
      onNewEnvValueChange={settings.setNewEnvValue}
      newEnvType={settings.newEnvType()}
      onNewEnvTypeChange={settings.setNewEnvType}
      onAddEnvVar={settings.handleAddEnvVar}
      onSaveEnvVars={settings.handleSaveEnvVars}
      bindings={settings.bindings()}
      resources={props.resources}
      onAddBinding={settings.handleAddBinding}
      onSaveBindings={settings.handleSaveBindings}
      runtimeConfig={settings.runtimeConfig()}
      onRuntimeConfigChange={settings.setRuntimeConfig}
      onSaveRuntimeConfig={settings.handleSaveRuntimeConfig}
      savingWorkerSettings={settings.savingWorkerSettings()}
    />
  );
}
