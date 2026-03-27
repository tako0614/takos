import { useState, useCallback, type FormEvent } from 'react';
import { Icons } from '../lib/Icons';
import { useI18n } from '../store/i18n';
import { useMemoryData } from '../hooks/useMemoryData';
import { MemoryList } from './memory/MemoryList';
import { MemoryCreateForm, ReminderCreateForm } from './memory/MemoryForm';
import type { Reminder } from '../types';

export interface MemoryPageProps {
  spaceId: string;
  onBack: () => void;
}

const getPriorityClasses = (pri: Reminder['priority']) => {
  switch (pri) {
    case 'high': return 'border-l-4 border-l-danger';
    case 'normal': return 'border-l-4 border-l-accent';
    case 'low': return 'border-l-4 border-l-text-zinc-500';
    default: return 'border-l-4 border-l-accent';
  }
};

export function MemoryPage({ spaceId, onBack }: MemoryPageProps) {
  const { t } = useI18n();
  const [showReminders, setShowReminders] = useState(false);
  const [showCreateMemory, setShowCreateMemory] = useState(false);
  const [showCreateReminder, setShowCreateReminder] = useState(false);

  const {
    memories, reminders, loading,
    deleteMemory, deleteReminder,
    memoryForm, setMemoryForm,
    reminderForm, setReminderForm,
    handleCreateMemory: baseCreateMemory,
    handleCreateReminder: baseCreateReminder,
    getTypeIcon, getTypeLabel, getTriggerIcon,
  } = useMemoryData(spaceId);

  const handleCreateMemory = useCallback(async (e: FormEvent) => {
    await baseCreateMemory(e);
    if (memoryForm.content.trim()) {
      setShowCreateMemory(false);
    }
  }, [baseCreateMemory, memoryForm.content]);

  const handleCreateReminder = useCallback(async (e: FormEvent) => {
    await baseCreateReminder(e);
    if (reminderForm.content.trim() && reminderForm.triggerValue.trim()) {
      setShowCreateReminder(false);
    }
  }, [baseCreateReminder, reminderForm.content, reminderForm.triggerValue]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
        <button
          className="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={onBack}
        >
          <Icons.ArrowLeft />
        </button>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-100">
          <Icons.HardDrive />
          <span>Memory</span>
        </h1>
        <div className="ml-auto">
          <button
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors cursor-pointer"
            onClick={() => showReminders ? setShowCreateReminder(true) : setShowCreateMemory(true)}
          >
            <Icons.Plus />
            <span>{showReminders ? t('createReminder') : t('createMemory')}</span>
          </button>
        </div>
      </header>

      <MemoryList
        memories={memories}
        reminders={reminders}
        loading={loading}
        showReminders={showReminders}
        onShowRemindersChange={setShowReminders}
        onDeleteMemory={deleteMemory}
        onDeleteReminder={deleteReminder}
        getTypeIcon={getTypeIcon}
        getTypeLabel={getTypeLabel}
        getTriggerIcon={getTriggerIcon}
        getPriorityClasses={getPriorityClasses}
      />

      {showCreateMemory && (
        <MemoryCreateForm
          memoryForm={memoryForm}
          onFormChange={setMemoryForm}
          onSubmit={handleCreateMemory}
          onClose={() => setShowCreateMemory(false)}
          getTypeIcon={getTypeIcon}
        />
      )}

      {showCreateReminder && (
        <ReminderCreateForm
          reminderForm={reminderForm}
          onFormChange={setReminderForm}
          onSubmit={handleCreateReminder}
          onClose={() => setShowCreateReminder(false)}
          getTriggerIcon={getTriggerIcon}
        />
      )}
    </div>
  );
}
