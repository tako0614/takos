import { useI18n } from '../../../store/i18n';
import type { TranslationKey } from '../../../store/i18n';
import { Icons } from '../../../lib/Icons';
import type { Resource, Worker } from '../../../types';
import type {
  Binding,
  EnvVar,
  RuntimeConfig,
  WorkerDomain,
  WorkerSettingsTab,
  VerificationInfo,
} from '../types';
import { EnvironmentTab } from './EnvironmentTab';
import {
  getWorkerDisplayHostname,
  getWorkerStatusIndicatorClass,
  getWorkerUrl,
} from '../utils/workerUtils';

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
  const platformDomain = worker.hostname?.includes('.') ? worker.hostname.split('.').slice(1).join('.') : '';
  const workerHostname = getWorkerDisplayHostname(worker);
  const workerUrl = getWorkerUrl(worker);

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
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-700 overflow-x-auto">
        {SETTINGS_TABS.map(({ id, labelKey }) => (
          <button
            key={id}
            className={settingsTabClass(settingsTab === id)}
            onClick={() => onSettingsTabChange(id)}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {settingsTab === 'general' && (
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('subdomain')}</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50"
                value={editSlug}
                onChange={(e) => onEditSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="my-app"
              />
              {platformDomain && (
                <span className="text-sm text-zinc-500 dark:text-zinc-400">.{platformDomain}</span>
              )}
            </div>
            <button
              className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              onClick={onSaveSlug}
              disabled={savingSlug || !editSlug.trim() || editSlug === (worker.slug ?? '')}
            >
              {savingSlug ? t('saving') : t('saveSubdomain')}
            </button>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('currentUrl')}</label>
            <div className="flex items-center gap-2">
              {workerUrl ? (
                <a
                  href={workerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-900 dark:text-zinc-100 hover:underline flex items-center gap-1"
                >
                  <Icons.Globe className="w-4 h-4" />
                  <span>{workerUrl}</span>
                  <Icons.ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-zinc-500 dark:text-zinc-400">{workerHostname}</span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('status')}</label>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${getWorkerStatusIndicatorClass(worker.status)}`} />
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{worker.status}</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('workerId')}</label>
            <div className="flex items-center gap-2">
              <code className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500 dark:text-zinc-400 font-mono">{worker.id}</code>
            </div>
          </div>
        </div>
      )}

      {settingsTab === 'domains' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('platformDomain')}</h4>
            {workerUrl ? (
              <a
                href={workerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-900 dark:text-zinc-100 hover:underline flex items-center gap-1"
              >
                <Icons.Globe className="w-4 h-4" />
                <span>{workerHostname}</span>
                <Icons.ExternalLink className="w-3 h-3" />
              </a>
            ) : (
              <div className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                <Icons.Globe className="w-4 h-4" />
                <span>{workerHostname}</span>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('customDomains')}</h4>

            {loadingWorkerDomains ? (
              <div className="flex items-center gap-2 text-zinc-500"><Icons.Loader className="w-4 h-4 animate-spin" /><span>{t('loading')}</span></div>
            ) : (
              <>
                {workerDomains.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noCustomDomains')}</p>
                ) : (
                  <div className="space-y-2">
                    {workerDomains.map(domain => (
                      <div key={domain.id} className="p-4 bg-zinc-50 dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Icons.Globe className="w-4 h-4 text-zinc-500" />
                            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{domain.domain}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs border ${
                              domain.status === 'active' ? 'bg-zinc-900 text-white border-zinc-900' :
                              domain.status === 'pending' ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-300 dark:border-zinc-600' :
                              'bg-white text-zinc-500 border-zinc-400'
                            }`}>
                              {domain.status === 'active' ? t('domainActive') : domain.status === 'pending' ? t('domainPending') : domain.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {domain.status === 'pending' && (
                              <button
                                className="px-3 py-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-xs font-medium transition-colors"
                                onClick={() => onVerifyWorkerDomain(domain.id)}
                              >
                                {t('verifyDomain')}
                              </button>
                            )}
                            <button
                              className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-lg transition-colors"
                              onClick={() => onDeleteWorkerDomain(domain.id)}
                            >
                              <Icons.Trash className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        {domain.status === 'pending' && (
                          <div className="mt-3 p-3 bg-white rounded-lg">
                            <p className="text-xs text-zinc-500">{t('cnameInstruction')}</p>
                            <code className="block mt-1 text-xs text-zinc-700 font-mono">
                              {domain.verification_method === 'cname'
                                ? `_acme-challenge.${domain.domain} CNAME`
                                : `_takos-verify.${domain.domain} TXT`}
                            </code>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {verificationInfo && (
                  <div className="p-4 bg-zinc-50 border border-zinc-300 rounded-xl">
                    <h5 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('dnsSetup')}</h5>
                    <p className="text-xs text-zinc-700 mb-2">{verificationInfo.instructions}</p>
                    <div className="space-y-1">
                      <div className="flex gap-2 text-xs">
                        <span className="text-zinc-500">Record:</span>
                        <code className="text-zinc-700 font-mono">{verificationInfo.record}</code>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <span className="text-zinc-500">Target:</span>
                        <code className="text-zinc-700 font-mono">{verificationInfo.target}</code>
                      </div>
                    </div>
                    <button
                      className="mt-2 text-xs text-zinc-500 hover:text-zinc-900"
                      onClick={onCloseVerificationInfo}
                    >
                      {t('close')}
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <input
                    type="text"
                    className="flex-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
                    value={newWorkerDomain}
                    onChange={(e) => onNewWorkerDomainChange(e.target.value.toLowerCase())}
                    placeholder="example.com"
                  />
                  <button
                    className="px-4 py-1.5 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    onClick={onAddWorkerDomain}
                    disabled={addingWorkerDomain || !newWorkerDomain.trim()}
                  >
                    {addingWorkerDomain ? t('adding') : t('addDomain')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {loadingWorkerSettings ? (
        <div className="flex items-center gap-2 text-zinc-500"><Icons.Loader className="w-4 h-4 animate-spin" /><span>{t('loading')}</span></div>
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
            <div className="space-y-4">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('bindingsHint')}</p>
              <div className="space-y-2">
                {bindings.length === 0 ? (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('noBindings')}</p>
                ) : (
                  bindings.map((binding, index) => (
                    <div key={index} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                      <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                        {binding.type === 'd1' && <Icons.Database className="w-4 h-4" />}
                        {binding.type === 'r2_bucket' && <Icons.Bucket className="w-4 h-4" />}
                        {binding.type === 'kv_namespace' && <Icons.Key className="w-4 h-4" />}
                        {binding.type === 'service' && <Icons.Server className="w-4 h-4" />}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{binding.name}</span>
                        <span className="ml-2 text-xs text-zinc-500">{binding.type}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center gap-3">
                <select
                  className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
                  onChange={(e) => {
                    const res = resources.find(r => r.name === e.target.value);
                    if (res) {
                      onAddBinding(res);
                    }
                  }}
                  value=""
                >
                  <option value="">{t('addBinding')}</option>
                  {resources.filter(r => ['d1', 'r2', 'kv'].includes(r.type)).map(r => (
                    <option key={r.name} value={r.name}>{r.name} ({r.type})</option>
                  ))}
                </select>
                <button
                  className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  onClick={onSaveBindings}
                  disabled={savingWorkerSettings}
                >
                  {savingWorkerSettings ? t('saving') : t('saveBindings')}
                </button>
              </div>
            </div>
          )}

          {settingsTab === 'runtime' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('compatibilityDate')}</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
                  value={runtimeConfig.compatibility_date || ''}
                  onChange={(e) => onRuntimeConfigChange({ ...runtimeConfig, compatibility_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('compatibilityFlags')}</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
                  value={(runtimeConfig.compatibility_flags || []).join(', ')}
                  onChange={(e) => onRuntimeConfigChange({
                    ...runtimeConfig,
                    compatibility_flags: e.target.value.split(',').map(f => f.trim()).filter(Boolean),
                  })}
                  placeholder="nodejs_compat, url_standard"
                />
                <span className="text-xs text-zinc-500">{t('compatibilityFlagsHint')}</span>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('cpuLimit')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="w-32 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
                    value={runtimeConfig.cpu_ms || ''}
                    onChange={(e) => onRuntimeConfigChange({ ...runtimeConfig, cpu_ms: parseInt(e.target.value, 10) || undefined })}
                    placeholder="50"
                    min="10"
                    max="30000"
                  />
                  <span className="text-xs text-zinc-500">ms</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('subrequestsLimit')}</label>
                <input
                  type="number"
                  className="w-32 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
                  value={runtimeConfig.subrequests || ''}
                  onChange={(e) => onRuntimeConfigChange({ ...runtimeConfig, subrequests: parseInt(e.target.value, 10) || undefined })}
                  placeholder="50"
                  min="1"
                  max="1000"
                />
                <span className="text-xs text-zinc-500">{t('subrequestsHint')}</span>
              </div>
              <button
                className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                onClick={onSaveRuntimeConfig}
                disabled={savingWorkerSettings}
              >
                {savingWorkerSettings ? t('saving') : t('saveRuntime')}
              </button>
            </div>
          )}
        </>
      )}

      <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 mt-8">
        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('dangerZone')}</h4>
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors" onClick={onDeleteWorker}>
          <Icons.Trash className="w-4 h-4" />
          <span>{t('deleteWorker')}</span>
        </button>
      </div>
    </div>
  );
}
