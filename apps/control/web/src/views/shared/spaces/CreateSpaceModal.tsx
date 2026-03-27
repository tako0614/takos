import { useI18n } from '../../../providers/I18nProvider';
import { useCreateSpaceForm } from '../../../hooks/useCreateSpaceForm';
import { Icons } from '../../../lib/Icons';

interface CreateSpaceModalProps {
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}

export function CreateSpaceModal({ onClose, onCreate }: CreateSpaceModalProps) {
  const { t } = useI18n();
  const {
    name,
    setName,
    description,
    setDescription,
    loading,
    error,
    clearError,
    handleSubmit,
  } = useCreateSpaceForm({
    onCreate,
    nameRequiredMessage: t('nameRequired'),
    failedToCreateMessage: t('failedToCreate'),
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-space-title"
    >
      <div className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl w-full max-w-md mx-4 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h3 id="create-space-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('createSpace')}</h3>
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
            onClick={onClose}
            aria-label={t('close')}
          >
            <Icons.X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 space-y-4">
            <div className="space-y-2">
              <label htmlFor="space-name" className="block text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {t('spaceName')} <span className="text-zinc-500" aria-hidden="true">*</span>
              </label>
              <input
                id="space-name"
                type="text"
                className={`w-full px-3 py-2 bg-white dark:bg-zinc-700 border rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors ${error && !name.trim() ? 'border-zinc-500 dark:border-zinc-400' : 'border-zinc-200 dark:border-zinc-600'}`}
                placeholder={t('spaceNamePlaceholder')}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) clearError();
                }}
                autoFocus
                required
                aria-required="true"
                aria-invalid={error && !name.trim() ? 'true' : 'false'}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="space-description" className="block text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {t('description')} <span className="text-zinc-600 dark:text-zinc-500 text-xs">({t('optional') || 'optional'})</span>
              </label>
              <textarea
                id="space-description"
                className="w-full px-3 py-2 bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 transition-colors resize-none"
                placeholder={t('descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            {error && (
              <div className="text-sm text-zinc-700 dark:text-zinc-300 flex items-center gap-2" role="alert">
                <Icons.AlertTriangle className="w-4 h-4" />
                {error}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
            <button type="button" className="px-4 py-2 bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500" onClick={onClose}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-lg hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100"
              disabled={loading || !name.trim()}
              aria-disabled={loading || !name.trim()}
            >
              {loading ? t('creating') : t('create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
