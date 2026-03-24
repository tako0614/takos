import { useState } from 'react';
import { useI18n } from '../../../providers/I18nProvider';
import { useConfirmDialog } from '../../../providers/ConfirmDialogProvider';
import { Icons } from '../../../lib/Icons';
import type { EnvVar } from '../types';

export interface EnvironmentTabProps {
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
  savingWorkerSettings: boolean;
}

export function EnvironmentTab({
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
  savingWorkerSettings,
}: EnvironmentTabProps) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const [showSecrets, setShowSecrets] = useState<Record<number, boolean>>({});

  const plainTextVars = envVars.filter(env => env.type === 'plain_text');
  const secretVars = envVars.filter(env => env.type === 'secret_text');

  const handleRemoveEnvVar = async (index: number, isSecret: boolean) => {
    const confirmed = await confirm({
      title: isSecret ? t('deleteSecret') : t('deleteEnvVar'),
      message: isSecret ? t('confirmDeleteSecret') : t('confirmDeleteEnvVar'),
      confirmText: t('delete'),
      danger: true,
    });
    if (confirmed) {
      onRemoveEnvVar(index);
    }
  };

  const toggleSecretVisibility = (index: number) => {
    setShowSecrets(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const getOriginalIndex = (env: EnvVar): number => {
    return envVars.indexOf(env);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Icons.Edit className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('environmentVariables')}</h3>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('envVarsDescription')}</p>
        <div className="space-y-2">
          {plainTextVars.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">{t('noEnvVars')}</p>
          ) : (
            plainTextVars.map((env) => {
              const originalIndex = getOriginalIndex(env);
              return (
                <div key={originalIndex} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="min-w-[150px]">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 font-mono">{env.name}</span>
                  </div>
                  <input type="text" className="flex-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50 font-mono" value={env.value} onChange={(e) => onEnvVarChange(originalIndex, e.target.value)} placeholder={t('varValue')} />
                  <button className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors" onClick={() => handleRemoveEnvVar(originalIndex, false)} aria-label={t('deleteEnvVar')}><Icons.Trash className="w-4 h-4" /></button>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Icons.Lock className="w-4 h-4 text-zinc-500" />
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('secrets')}</h3>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('secretsDescription')}</p>
        <div className="space-y-2">
          {secretVars.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 py-4">{t('noSecrets')}</p>
          ) : (
            secretVars.map((env) => {
              const originalIndex = getOriginalIndex(env);
              const isVisible = showSecrets[originalIndex];
              return (
                <div key={originalIndex} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="min-w-[150px] flex items-center gap-2">
                    <Icons.Lock className="w-3 h-3 text-zinc-400" />
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 font-mono">{env.name}</span>
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <input type={isVisible ? 'text' : 'password'} className="flex-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50 font-mono" value={env.value} onChange={(e) => onEnvVarChange(originalIndex, e.target.value)} placeholder="********" />
                    <button className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors" onClick={() => toggleSecretVisibility(originalIndex)} title={isVisible ? t('hideSecret') : t('showSecret')} aria-label={isVisible ? t('hideSecret') : t('showSecret')}>{isVisible ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}</button>
                  </div>
                  <button className="p-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg transition-colors" onClick={() => handleRemoveEnvVar(originalIndex, true)} aria-label={t('deleteSecret')}><Icons.Trash className="w-4 h-4" /></button>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="space-y-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('addNewVariable')}</h3>
        <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <input type="text" className="w-40 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50 font-mono" value={newEnvName} onChange={(e) => onNewEnvNameChange(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))} placeholder={t('varName')} />
          <input type={newEnvType === 'secret_text' ? 'password' : 'text'} className="flex-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50 font-mono" value={newEnvValue} onChange={(e) => onNewEnvValueChange(e.target.value)} placeholder={t('varValue')} />
          <select className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50" value={newEnvType} onChange={(e) => onNewEnvTypeChange(e.target.value as EnvVar['type'])}><option value="plain_text">{t('plainText')}</option><option value="secret_text">{t('secret')}</option></select>
          <button className="p-2 bg-zinc-100 dark:bg-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-600 text-zinc-500 dark:text-zinc-400 rounded-lg transition-colors disabled:opacity-50" onClick={onAddEnvVar} disabled={!newEnvName.trim()} aria-label={t('addNewVariable')}><Icons.Plus className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex justify-end pt-4">
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50" onClick={onSaveEnvVars} disabled={savingWorkerSettings}>{savingWorkerSettings ? (<><Icons.Loader className="w-4 h-4 animate-spin" /><span>{t('saving')}</span></>) : (<span>{t('saveEnvVars')}</span>)}</button>
      </div>
    </div>
  );
}
