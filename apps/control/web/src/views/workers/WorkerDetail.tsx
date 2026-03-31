import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import type { Resource, Worker } from '../../types';
import { Breadcrumb } from '../../components/ui/Breadcrumb';
import { WorkerOverviewTab } from './detail/WorkerOverviewTab';
import { WorkerSettingsPanel } from './detail/WorkerSettingsPanel';
import { DeploymentLogsTab } from './detail/DeploymentLogsTab';
import type {
  Binding,
  EnvVar,
  RuntimeConfig,
  WorkerDetailTab,
  WorkerDomain,
  WorkerSettingsTab,
  VerificationInfo,
} from './worker-models';
import {
  getWorkerDisplayHostname,
  getWorkerDisplayName,
  getWorkerStatusIndicatorClass,
  getWorkerUrl,
} from './utils/workerUtils';

export interface WorkerDetailProps {
  worker: Worker;
  tab: WorkerDetailTab;
  onBack: () => void;
  onTabChange: (tab: WorkerDetailTab) => void;
  onDeleteWorker: (worker: Worker) => void;
  workerSettingsTab: WorkerSettingsTab;
  onWorkerSettingsTabChange: (tab: WorkerSettingsTab) => void;
  editSlug: string;
  onEditSlugChange: (value: string) => void;
  onSaveSlug: () => void;
  savingSlug: boolean;
  workerDomains: WorkerDomain[];
  loadingWorkerDomains: boolean;
  verificationInfo: VerificationInfo | null;
  onCloseVerificationInfo: () => void;
  newWorkerDomain: string;
  onNewWorkerDomainChange: (value: string) => void;
  onAddWorkerDomain: () => void;
  addingWorkerDomain: boolean;
  onVerifyWorkerDomain: (domainId: string) => void;
  onDeleteWorkerDomain: (domainId: string) => void;
  loadingWorkerSettings: boolean;
  envVars: EnvVar[];
  onEnvVarChange: (index: number, value: string) => void;
  onRemoveEnvVar: (index: number) => void;
  newEnvName: string;
  onNewEnvNameChange: (value: string) => void;
  newEnvValue: string;
  onNewEnvValueChange: (value: string) => void;
  newEnvType: EnvVar['type'];
  onNewEnvTypeChange: (value: EnvVar['type']) => void;
  onAddEnvVar: () => void;
  onSaveEnvVars: () => void;
  bindings: Binding[];
  resources: Resource[];
  onAddBinding: (resource: Resource) => void;
  onSaveBindings: () => void;
  runtimeConfig: RuntimeConfig;
  onRuntimeConfigChange: (config: RuntimeConfig) => void;
  onSaveRuntimeConfig: () => void;
  savingWorkerSettings: boolean;
}

function StatusDot({ status }: { status: Worker['status'] }) {
  return <span class={`w-2 h-2 rounded-full ${getWorkerStatusIndicatorClass(status)}`} />;
}

export function WorkerDetail({
  worker,
  tab,
  onBack,
  onTabChange,
  onDeleteWorker,
  workerSettingsTab,
  onWorkerSettingsTabChange,
  editSlug,
  onEditSlugChange,
  onSaveSlug,
  savingSlug,
  workerDomains,
  loadingWorkerDomains,
  verificationInfo,
  onCloseVerificationInfo,
  newWorkerDomain,
  onNewWorkerDomainChange,
  onAddWorkerDomain,
  addingWorkerDomain,
  onVerifyWorkerDomain,
  onDeleteWorkerDomain,
  loadingWorkerSettings,
  envVars,
  onEnvVarChange,
  onRemoveEnvVar,
  newEnvName,
  onNewEnvNameChange,
  newEnvValue,
  onNewEnvValueChange,
  newEnvType,
  onNewEnvTypeChange,
  onAddEnvVar,
  onSaveEnvVars,
  bindings,
  resources,
  onAddBinding,
  onSaveBindings,
  runtimeConfig,
  onRuntimeConfigChange,
  onSaveRuntimeConfig,
  savingWorkerSettings,
}: WorkerDetailProps) {
  const { t } = useI18n();
  const workerName = getWorkerDisplayName(worker);
  const workerHostname = getWorkerDisplayHostname(worker);
  const workerUrl = getWorkerUrl(worker);

  const breadcrumbItems = [
    { label: t('workers'), onClick: onBack },
    { label: workerName },
  ];

  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      <header class="flex flex-col gap-3 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800">
        <Breadcrumb items={breadcrumbItems} />
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-3 flex-1">
            <span class="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300"><Icons.Server class="w-5 h-5" /></span>
            <div>
              <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{workerName}</h1>
              {workerUrl ? (
                <a href={workerUrl} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-sm text-zinc-900 dark:text-zinc-100 hover:underline">
                  <Icons.Globe class="w-3 h-3" />
                  <span>{workerHostname}</span>
                  <Icons.ExternalLink class="w-3 h-3" />
                </a>
              ) : (
                <div class="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                  <Icons.Globe class="w-3 h-3" />
                  <span>{workerHostname}</span>
                </div>
              )}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <StatusDot status={worker.status} />
            <span class="text-sm text-zinc-500 dark:text-zinc-400">{worker.status}</span>
          </div>
        </div>
      </header>

      <div class="flex gap-1 px-6 pt-4 border-b border-zinc-200 dark:border-zinc-800">
        <button
          class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === 'overview' ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
          onClick={() => onTabChange('overview')}
        >
          {t('overview')}
        </button>
        <button
          class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === 'deployments' ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
          onClick={() => onTabChange('deployments')}
        >
          {t('deploymentHistory')}
        </button>
        <button
          class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${tab === 'settings' ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
          onClick={() => onTabChange('settings')}
        >
          {t('settings')}
        </button>
      </div>

      <div class="flex-1 overflow-auto p-6">
        {tab === 'overview' && (
          <WorkerOverviewTab worker={worker} />
        )}

        {tab === 'deployments' && (
          <DeploymentLogsTab worker={worker} />
        )}

        {tab === 'settings' && (
          <WorkerSettingsPanel
            worker={worker}
            settingsTab={workerSettingsTab}
            onSettingsTabChange={onWorkerSettingsTabChange}
            editSlug={editSlug}
            onEditSlugChange={onEditSlugChange}
            onSaveSlug={onSaveSlug}
            savingSlug={savingSlug}
            workerDomains={workerDomains}
            loadingWorkerDomains={loadingWorkerDomains}
            verificationInfo={verificationInfo}
            onCloseVerificationInfo={onCloseVerificationInfo}
            newWorkerDomain={newWorkerDomain}
            onNewWorkerDomainChange={onNewWorkerDomainChange}
            onAddWorkerDomain={onAddWorkerDomain}
            addingWorkerDomain={addingWorkerDomain}
            onVerifyWorkerDomain={onVerifyWorkerDomain}
            onDeleteWorkerDomain={onDeleteWorkerDomain}
            loadingWorkerSettings={loadingWorkerSettings}
            envVars={envVars}
            onEnvVarChange={onEnvVarChange}
            onRemoveEnvVar={onRemoveEnvVar}
            newEnvName={newEnvName}
            onNewEnvNameChange={onNewEnvNameChange}
            newEnvValue={newEnvValue}
            onNewEnvValueChange={onNewEnvValueChange}
            newEnvType={newEnvType}
            onNewEnvTypeChange={onNewEnvTypeChange}
            onAddEnvVar={onAddEnvVar}
            onSaveEnvVars={onSaveEnvVars}
            bindings={bindings}
            resources={resources}
            onAddBinding={onAddBinding}
            onSaveBindings={onSaveBindings}
            runtimeConfig={runtimeConfig}
            onRuntimeConfigChange={onRuntimeConfigChange}
            onSaveRuntimeConfig={onSaveRuntimeConfig}
            savingWorkerSettings={savingWorkerSettings}
            onDeleteWorker={() => onDeleteWorker(worker)}
          />
        )}
      </div>
    </div>
  );
}
