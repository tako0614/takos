import { useState } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui';
import { useMemoryData } from '../../hooks/useMemoryData';
import { MemoryList } from './MemoryList';
import { ReminderList } from './ReminderList';

export function MemoryTab({ spaceId }: { spaceId: string }) {
  const { t } = useI18n();
  const [showReminders, setShowReminders] = useState(false);

  const {
    memories, reminders, loading,
    deleteMemory, deleteReminder,
    createMemory, createReminder,
    savingMemory, savingReminder,
  } = useMemoryData(spaceId);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)', gap: '0.75rem' }}>
        <Icons.Loader className="w-5 h-5 animate-spin" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', backgroundColor: 'var(--color-surface-secondary)', borderRadius: 'var(--radius-lg)', padding: '0.25rem' }}>
          <Button
            variant={!showReminders ? 'primary' : 'ghost'}
            size="sm"
            leftIcon={<Icons.HardDrive />}
            onClick={() => setShowReminders(false)}
          >
            {t('memories')} ({memories.length})
          </Button>
          <Button
            variant={showReminders ? 'primary' : 'ghost'}
            size="sm"
            leftIcon={<Icons.Bell />}
            onClick={() => setShowReminders(true)}
          >
            {t('reminders')} ({reminders.length})
          </Button>
        </div>
      </div>

      {!showReminders ? (
        <MemoryList
          memories={memories}
          onDelete={deleteMemory}
          onCreateMemory={(data) => createMemory({ ...data, source: 'user' })}
          savingMemory={savingMemory}
        />
      ) : (
        <ReminderList
          reminders={reminders}
          onDelete={deleteReminder}
          onCreateReminder={createReminder}
          savingReminder={savingReminder}
        />
      )}
    </div>
  );
}
