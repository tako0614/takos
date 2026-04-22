import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import type { Resource, Worker } from "../../types/index.ts";
import { Breadcrumb } from "../../components/ui/Breadcrumb.tsx";
import { WorkerOverviewTab } from "./detail/WorkerOverviewTab.tsx";
import { WorkerSettingsPanel } from "./detail/WorkerSettingsPanel.tsx";
import { DeploymentLogsTab } from "./detail/DeploymentLogsTab.tsx";
import type {
  Binding,
  EnvVar,
  RuntimeConfig,
  VerificationInfo,
  WorkerDetailTab,
  WorkerDomain,
  WorkerSettingsTab,
} from "./worker-models.ts";
import {
  getWorkerDisplayHostname,
  getWorkerDisplayName,
  getWorkerStatusIndicatorClass,
  getWorkerUrl,
} from "./utils/workerUtils.ts";

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
}

function StatusDot(props: { status: Worker["status"] }) {
  return (
    <span
      class={`w-2 h-2 rounded-full ${
        getWorkerStatusIndicatorClass(props.status)
      }`}
    />
  );
}

export function WorkerDetail(props: WorkerDetailProps) {
  const { t } = useI18n();
  const workerName = () => getWorkerDisplayName(props.worker);
  const workerHostname = () => getWorkerDisplayHostname(props.worker);
  const workerUrl = () => getWorkerUrl(props.worker);

  const breadcrumbItems = () => [
    { label: t("workers"), onClick: props.onBack },
    { label: workerName() },
  ];

  return (
    <div class="flex flex-col h-full bg-white dark:bg-zinc-900">
      <header class="flex flex-col gap-3 px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800">
        <Breadcrumb items={breadcrumbItems()} />
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-3 flex-1">
            <span class="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300">
              <Icons.Server class="w-5 h-5" />
            </span>
            <div>
              <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {workerName()}
              </h1>
              {workerUrl()
                ? (
                  <a
                    href={workerUrl()!}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-sm text-zinc-900 dark:text-zinc-100 hover:underline"
                  >
                    <Icons.Globe class="w-3 h-3" />
                    <span>{workerHostname()}</span>
                    <Icons.ExternalLink class="w-3 h-3" />
                  </a>
                )
                : (
                  <div class="inline-flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400">
                    <Icons.Globe class="w-3 h-3" />
                    <span>{workerHostname()}</span>
                  </div>
                )}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <StatusDot status={props.worker.status} />
            <span class="text-sm text-zinc-500 dark:text-zinc-400">
              {props.worker.status}
            </span>
          </div>
        </div>
      </header>

      <div class="flex gap-1 px-6 pt-4 border-b border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            props.tab === "overview"
              ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          }`}
          onClick={() => props.onTabChange("overview")}
        >
          {t("overview")}
        </button>
        <button
          type="button"
          class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            props.tab === "deployments"
              ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          }`}
          onClick={() => props.onTabChange("deployments")}
        >
          {t("deploymentHistory")}
        </button>
        <button
          type="button"
          class={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
            props.tab === "settings"
              ? "bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700"
          }`}
          onClick={() => props.onTabChange("settings")}
        >
          {t("settings")}
        </button>
      </div>

      <div class="flex-1 overflow-auto p-6">
        {props.tab === "overview" && (
          <WorkerOverviewTab
            worker={props.worker}
          />
        )}

        {props.tab === "deployments" && (
          <DeploymentLogsTab worker={props.worker} />
        )}

        {props.tab === "settings" && (
          <WorkerSettingsPanel
            worker={props.worker}
            settingsTab={props.workerSettingsTab}
            onSettingsTabChange={props.onWorkerSettingsTabChange}
            editSlug={props.editSlug}
            onEditSlugChange={props.onEditSlugChange}
            onSaveSlug={props.onSaveSlug}
            savingSlug={props.savingSlug}
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
            loadingWorkerSettings={props.loadingWorkerSettings}
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
            bindings={props.bindings}
            resources={props.resources}
            onAddBinding={props.onAddBinding}
            onSaveBindings={props.onSaveBindings}
            runtimeConfig={props.runtimeConfig}
            onRuntimeConfigChange={props.onRuntimeConfigChange}
            onSaveRuntimeConfig={props.onSaveRuntimeConfig}
            savingWorkerSettings={props.savingWorkerSettings}
            onDeleteWorker={() => props.onDeleteWorker(props.worker)}
          />
        )}
      </div>
    </div>
  );
}
