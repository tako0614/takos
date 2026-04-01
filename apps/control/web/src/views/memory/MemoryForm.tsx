import type { Setter } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import type { Memory, Reminder } from '../../types/index.ts';
import type { MemoryFormState, ReminderFormState } from '../../hooks/useMemoryData.ts';

export interface MemoryCreateFormProps {
  memoryForm: MemoryFormState;
  onFormChange: Setter<MemoryFormState>;
  onSubmit: (e: Event & { currentTarget: HTMLFormElement }) => void;
  onClose: () => void;
  getTypeIcon: (type: Memory['type']) => string;
}

export function MemoryCreateForm({
  memoryForm,
  onFormChange,
  onSubmit,
  onClose,
  getTypeIcon,
}: MemoryCreateFormProps) {
  const { t } = useI18n();

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-page-create-modal-title"
    >
      <div class="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h3 id="memory-page-create-modal-title" class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('createMemory')}</h3>
          <button type="button"
            class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <Icons.X />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div class="p-6 flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('memoryContent')}</label>
              <textarea
                class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors resize-none"
                placeholder={t('memoryContentPlaceholder')}
                value={memoryForm.content}
                onInput={e => onFormChange(prev => ({ ...prev, content: e.target.value }))}
                rows={4}
                required
                autofocus
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('memoryType')}</label>
              <select
                class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                value={memoryForm.type}
                onChange={e => onFormChange(prev => ({ ...prev, type: e.target.value as Memory['type'] }))}
              >
                <option value="semantic">{getTypeIcon('semantic')} {t('memorySemantic')}</option>
                <option value="episode">{getTypeIcon('episode')} {t('memoryEpisode')}</option>
                <option value="procedural">{getTypeIcon('procedural')} {t('memoryProcedural')}</option>
              </select>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('memoryCategory')}</label>
              <input
                type="text"
                class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                placeholder={t('memoryCategoryPlaceholder')}
                value={memoryForm.category}
                onInput={e => onFormChange(prev => ({ ...prev, category: e.target.value }))}
              />
            </div>
          </div>
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
            <button type="button" class="px-4 py-2 rounded-lg font-medium text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors" onClick={onClose}>
              {t('cancel')}
            </button>
            <button type="submit" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" disabled={memoryForm.saving || !memoryForm.content.trim()}>
              {memoryForm.saving ? t('saving') : t('create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface ReminderCreateFormProps {
  reminderForm: ReminderFormState;
  onFormChange: Setter<ReminderFormState>;
  onSubmit: (e: Event & { currentTarget: HTMLFormElement }) => void;
  onClose: () => void;
  getTriggerIcon: (type: Reminder['trigger_type']) => string;
}

export function ReminderCreateForm({
  reminderForm,
  onFormChange,
  onSubmit,
  onClose,
  getTriggerIcon,
}: ReminderCreateFormProps) {
  const { t } = useI18n();

  return (
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-page-reminder-modal-title"
    >
      <div class="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
        <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
          <h3 id="memory-page-reminder-modal-title" class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('createReminder')}</h3>
          <button type="button"
            class="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            <Icons.X />
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <div class="p-6 flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('reminderContent')}</label>
              <textarea
                class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors resize-none"
                placeholder={t('reminderContentPlaceholder')}
                value={reminderForm.content}
                onInput={e => onFormChange(prev => ({ ...prev, content: e.target.value }))}
                rows={3}
                required
                autofocus
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('triggerType')}</label>
              <select
                class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                value={reminderForm.triggerType}
                onChange={e => onFormChange(prev => ({ ...prev, triggerType: e.target.value as Reminder['trigger_type'] }))}
              >
                <option value="time">{getTriggerIcon('time')} {t('reminderTime')}</option>
                <option value="condition">{getTriggerIcon('condition')} {t('reminderCondition')}</option>
                <option value="context">{getTriggerIcon('context')} {t('reminderContext')}</option>
              </select>
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('triggerValue')}</label>
              <input
                type="text"
                class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                placeholder={reminderForm.triggerType === 'time' ? t('triggerValueTimePlaceholder') : t('triggerValueConditionPlaceholder')}
                value={reminderForm.triggerValue}
                onInput={e => onFormChange(prev => ({ ...prev, triggerValue: e.target.value }))}
                required
              />
            </div>
            <div class="flex flex-col gap-2">
              <label class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('priority')}</label>
              <select
                class="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                value={reminderForm.priority}
                onChange={e => onFormChange(prev => ({ ...prev, priority: e.target.value as Reminder['priority'] }))}
              >
                <option value="low">{t('priorityLow')}</option>
                <option value="normal">{t('priorityNormal')}</option>
                <option value="high">{t('priorityHigh')}</option>
              </select>
            </div>
          </div>
          <div class="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
            <button type="button" class="px-4 py-2 rounded-lg font-medium text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors" onClick={onClose}>
              {t('cancel')}
            </button>
            <button
              type="submit"
              class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={reminderForm.saving || !reminderForm.content.trim() || !reminderForm.triggerValue.trim()}
            >
              {reminderForm.saving ? t('saving') : t('create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
