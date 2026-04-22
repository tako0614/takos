import { useI18n } from "../../../store/i18n.ts";
import type { TranslationKey } from "../../../store/i18n.ts";
import { Icons } from "../../../lib/Icons.tsx";
import type { Resource, Worker } from "../../../types/index.ts";
import type {
  Binding,
  EnvVar,
  RuntimeConfig,
  VerificationInfo,
  WorkerDomain,
  WorkerSettingsTab,
} from "../worker-models.ts";
import { GeneralTab } from "./GeneralTab.tsx";
import { DomainsTab } from "./DomainsTab.tsx";
import { EnvironmentTab } from "./EnvironmentTab.tsx";
import { BindingsTab } from "./BindingsTab.tsx";
import { RuntimeConfigTab } from "./RuntimeConfigTab.tsx";
import { DangerZone } from "./DangerZone.tsx";

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
  newEnvType: EnvVar["type"];
  onNewEnvTypeChange: (value: EnvVar["type"]) => void;
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

export function WorkerSettingsPanel(props: WorkerSettingsPanelProps) {
  const { t } = useI18n();

  const SETTINGS_TABS: Array<
    { id: WorkerSettingsTab; labelKey: TranslationKey }
  > = [
    { id: "general", labelKey: "general" },
    { id: "domains", labelKey: "domains" },
    { id: "env", labelKey: "envVars" },
    { id: "bindings", labelKey: "bindings" },
    { id: "runtime", labelKey: "runtime" },
  ];

  const settingsTabClass = (isActive: boolean): string =>
    `px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
      isActive
        ? "border-b-2 border-zinc-900 dark:border-zinc-100 text-zinc-900 dark:text-zinc-100"
        : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
    }`;

  return (
    <div class="space-y-6">
      <div class="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 overflow-x-auto">
        {SETTINGS_TABS.map(({ id, labelKey }) => (
          <button
            type="button"
            class={settingsTabClass(props.settingsTab === id)}
            onClick={() => props.onSettingsTabChange(id)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {props.settingsTab === "general" && (
        <GeneralTab
          worker={props.worker}
          editSlug={props.editSlug}
          onEditSlugChange={props.onEditSlugChange}
          onSaveSlug={props.onSaveSlug}
          savingSlug={props.savingSlug}
        />
      )}

      {props.settingsTab === "domains" && (
        <DomainsTab
          worker={props.worker}
          workerDomains={props.workerDomains}
          loadingWorkerDomains={props.loadingWorkerDomains}
          verificationInfo={props.verificationInfo}
          onCloseVerificationInfo={props.onCloseVerificationInfo}
          newWorkerDomain={props.newWorkerDomain}
          onNewWorkerDomainChange={props.onNewWorkerDomainChange}
          onAddWorkerDomain={props.onAddWorkerDomain}
          addingWorkerDomain={props.addingWorkerDomain}
          onVerifyWorkerDomain={props.onVerifyWorkerDomain}
          onDeleteWorkerDomain={props.onDeleteWorkerDomain}
        />
      )}

      {props.loadingWorkerSettings
        ? (
          <div class="flex items-center gap-2 text-zinc-500">
            <Icons.Loader class="w-4 h-4 animate-spin" />
            <span>{t("loading")}</span>
          </div>
        )
        : (
          <>
            {props.settingsTab === "env" && (
              <EnvironmentTab
                envVars={props.envVars}
                onEnvVarChange={props.onEnvVarChange}
                onRemoveEnvVar={props.onRemoveEnvVar}
                newEnvName={props.newEnvName}
                onNewEnvNameChange={props.onNewEnvNameChange}
                newEnvValue={props.newEnvValue}
                onNewEnvValueChange={props.onNewEnvValueChange}
                newEnvType={props.newEnvType}
                onNewEnvTypeChange={props.onNewEnvTypeChange}
                onAddEnvVar={props.onAddEnvVar}
                onSaveEnvVars={props.onSaveEnvVars}
                savingWorkerSettings={props.savingWorkerSettings}
              />
            )}

            {props.settingsTab === "bindings" && (
              <BindingsTab
                bindings={props.bindings}
                resources={props.resources}
                onAddBinding={props.onAddBinding}
                onSaveBindings={props.onSaveBindings}
                savingWorkerSettings={props.savingWorkerSettings}
              />
            )}

            {props.settingsTab === "runtime" && (
              <RuntimeConfigTab
                runtimeConfig={props.runtimeConfig}
                onRuntimeConfigChange={props.onRuntimeConfigChange}
                onSaveRuntimeConfig={props.onSaveRuntimeConfig}
                savingWorkerSettings={props.savingWorkerSettings}
              />
            )}
          </>
        )}

      <DangerZone onDeleteWorker={props.onDeleteWorker} />
    </div>
  );
}
