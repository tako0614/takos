import { type KeyboardEvent } from 'react';
import { useI18n } from '../../../store/i18n';
import { Icons } from '../../../lib/Icons';
import type { Resource } from '../../../types';

export interface CreateResourceModalProps {
  resourceName: string;
  onResourceNameChange: (value: string) => void;
  resourceType: Resource['type'];
  onResourceTypeChange: (value: Resource['type']) => void;
  creating: boolean;
  onCreate: () => void;
  onClose: () => void;
}

export function CreateResourceModal({
  resourceName,
  onResourceNameChange,
  resourceType,
  onResourceTypeChange,
  creating,
  onCreate,
  onClose,
}: CreateResourceModalProps) {
  const { t } = useI18n();

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose} onKeyDown={handleKeyDown}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-resource-modal-title"
        className="w-full max-w-md mx-4 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-700"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h3 id="create-resource-modal-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('createResource')}</h3>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            onClick={onClose}
            aria-label={t('close') || 'Close'}
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <label htmlFor="resource-name" className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t('name')} <span className="text-zinc-500 dark:text-zinc-400">*</span>
            </label>
            <input
              id="resource-name"
              type="text"
              className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors"
              value={resourceName}
              onChange={(e) => onResourceNameChange(e.target.value)}
              placeholder="my-database"
              aria-required="true"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="resource-type" className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('type')}</label>
            <select
              id="resource-type"
              className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors"
              value={resourceType}
              onChange={(e) => onResourceTypeChange(e.target.value as Resource['type'])}
            >
              <option value="d1">{t('d1Database')}</option>
              <option value="r2">{t('r2Storage')}</option>
              <option value="kv">{t('kvStore')}</option>
              <option value="vectorize">{t('vectorizeIndex')}</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
          <button
            type="button"
            className="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500"
            onClick={onClose}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-zinc-900"
            onClick={onCreate}
            disabled={creating || !resourceName.trim()}
            aria-disabled={creating || !resourceName.trim()}
          >
            {creating ? t('creating') : t('create')}
          </button>
        </div>
      </div>
    </div>
  );
}
