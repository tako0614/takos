import { useI18n } from '../../../store/i18n.ts';
import type { TranslationKey } from '../../../store/i18n.ts';
import { Icons } from '../../../lib/Icons.tsx';
import type { Resource, Worker } from '../../../types/index.ts';
import type {
  Binding,
  EnvVar,
  RuntimeConfig,
  WorkerDomain,
  WorkerSettingsTab,
  VerificationInfo,
} from '../worker-models.ts';
import { GeneralTab } from './GeneralTab.tsx';
import { DomainsTab } from './DomainsTab.tsx';
import { EnvironmentTab } from './EnvironmentTab.tsx';
import { BindingsTab } from './BindingsTab.tsx';
import { RuntimeConfigTab } from './RuntimeConfigTab.tsx';
import { DangerZone } from './DangerZone.tsx';

export interface WorkerSettingsPanelProps {
  worker: Worker;
  settingsTab: WorkerSettingsTab;
  onSettingsTabChange: (tab: WorkerSettingsTab) => void;
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
  onDeleteWorker: () => void;
}

export function WorkerSettingsPanel({
  worker,
  settingsTab,
  onSettingsTabChange,
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
  onDeleteWorker,
}: WorkerSettingsPanelProps) {
  const { t } = useI18n();

  const SETTINGS_TABS: Array<{ id: WorkerSettingsTab; labelKey: TranslationKey }> = [
    { id: 'general', labelKey: 'general' },
    { id: 'domains', labelKey: 'domains' },
    { id: 'env', labelKey: 'envVars' },
    { id: 'bindings', labelKey: 'bindings' },
    { id: 'runtime', labelKey: 'runtime' },
  ];

  const settingsTabClass = (isActive: boolean): string =>
    `px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
      isActive
        ? 'border-b-2 border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100'
        : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
    }`;

  return (
    <div class="space-y-6">
      <div class="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 overflow-x-auto">
        {SETTINGS_TABS.map(({ id, labelKey }) => (
          <button type="button"

            class={settingsTabClass(settingsTab === id)}
            onClick={() => onSettingsTabChange(id)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {settingsTab === 'general' && (
        <GeneralTab
          worker={worker}
          editSlug={editSlug}
          onEditSlugChange={onEditSlugChange}
          onSaveSlug={onSaveSlug}
          savingSlug={savingSlug}
        />
      )}

      {settingsTab === 'domains' && (
        <DomainsTab
          worker={worker}
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
        />
      )}

      {loadingWorkerSettings ? (
        <div class="flex items-center gap-2 text-zinc-500"><Icons.Loader class="w-4 h-4 animate-spin" /><span>{t('loading')}</span></div>
      ) : (
        <>
          {settingsTab === 'env' && (
            <EnvironmentTab
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
              savingWorkerSettings={savingWorkerSettings}
            />
          )}

          {settingsTab === 'bindings' && (
            <BindingsTab
              bindings={bindings}
              resources={resources}
              onAddBinding={onAddBinding}
              onSaveBindings={onSaveBindings}
              savingWorkerSettings={savingWorkerSettings}
            />
          )}

          {settingsTab === 'runtime' && (
            <RuntimeConfigTab
              runtimeConfig={runtimeConfig}
              onRuntimeConfigChange={onRuntimeConfigChange}
              onSaveRuntimeConfig={onSaveRuntimeConfig}
              savingWorkerSettings={savingWorkerSettings}
            />
          )}
        </>
      )}

      <DangerZone onDeleteWorker={onDeleteWorker} />
    </div>
  );
}
