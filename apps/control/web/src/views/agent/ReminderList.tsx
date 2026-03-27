import { useState, type FormEvent } from 'react';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { Button, Card, Badge, Input, Textarea, Select, Modal, ModalFooter } from '../../components/ui';
import type { Reminder } from '../../types';

function getTriggerIcon(type: Reminder['trigger_type']) {
  switch (type) {
    case 'time': return '⏰';
    case 'condition': return '🎯';
    case 'context': return '💬';
  }
}

function getTriggerLabel(type: Reminder['trigger_type'], t: (key: string) => string) {
  switch (type) {
    case 'time': return t('reminderTime');
    case 'condition': return t('reminderCondition');
    case 'context': return t('reminderContext');
  }
}

function getStatusLabel(status: Reminder['status'], t: (key: string) => string) {
  switch (status) {
    case 'pending': return t('reminderPending');
    case 'triggered': return t('reminderTriggered');
    default: return t('reminderDismissed');
  }
}

function getPriorityBorderStyle(priority: Reminder['priority']): React.CSSProperties {
  switch (priority) {
    case 'critical': return { borderLeft: '4px solid var(--color-error)' };
    case 'high': return { borderLeft: '4px solid var(--color-warning)' };
    case 'normal': return { borderLeft: '4px solid var(--color-border-primary)' };
    case 'low': return { borderLeft: '4px solid var(--color-border-secondary)' };
  }
}

export function ReminderList({
  reminders,
  onDelete,
  onCreateReminder,
  savingReminder,
}: {
  reminders: Reminder[];
  onDelete: (id: string) => void;
  onCreateReminder: (data: {
    content: string;
    trigger_type: Reminder['trigger_type'];
    trigger_value: string;
    priority: Reminder['priority'];
  }) => Promise<void>;
  savingReminder: boolean;
}) {
  const { t } = useI18n();
  const [showCreateReminder, setShowCreateReminder] = useState(false);

  const [reminderContent, setReminderContent] = useState('');
  const [triggerType, setTriggerType] = useState<Reminder['trigger_type']>('time');
  const [triggerValue, setTriggerValue] = useState('');
  const [priority, setPriority] = useState<Reminder['priority']>('normal');

  const handleCreateReminder = async (e: FormEvent) => {
    e.preventDefault();
    if (!reminderContent.trim() || !triggerValue.trim()) return;
    await onCreateReminder({
      content: reminderContent.trim(),
      trigger_type: triggerType,
      trigger_value: triggerValue.trim(),
      priority,
    });
    setReminderContent('');
    setTriggerValue('');
    setShowCreateReminder(false);
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {reminders.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)', gap: '0.75rem' }}>
            <Icons.Bell />
            <p>{t('noReminders')}</p>
          </div>
        ) : (
          reminders.map(reminder => (
            <Card key={reminder.id} padding="md" style={getPriorityBorderStyle(reminder.priority)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: 'var(--color-text-tertiary)' }}>
                  {getTriggerIcon(reminder.trigger_type)}
                  <span>{getTriggerLabel(reminder.trigger_type, t)}</span>
                </span>
                <Badge variant="default">
                  {getStatusLabel(reminder.status, t)}
                </Badge>
              </div>
              <div style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem', lineHeight: '1.6' }}>
                {reminder.content}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '0.5rem', padding: '0.25rem 0.5rem', backgroundColor: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                {reminder.trigger_value}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border-primary)' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                  {new Date(reminder.created_at).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(reminder.id)}
                  title={t('delete')}
                  style={{ color: 'var(--color-text-tertiary)' }}
                >
                  <Icons.Trash />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      <Button
        variant="secondary"
        leftIcon={<Icons.Plus />}
        onClick={() => setShowCreateReminder(true)}
        style={{ width: '100%', marginTop: '0.5rem', border: '2px dashed var(--color-border-primary)' }}
      >
        {t('createReminder')}
      </Button>

      <Modal
        isOpen={showCreateReminder}
        onClose={() => setShowCreateReminder(false)}
        title={t('createReminder')}
      >
        <form onSubmit={handleCreateReminder}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('reminderContent')}</label>
              <Textarea
                placeholder={t('reminderContentPlaceholder')}
                value={reminderContent}
                onChange={e => setReminderContent(e.target.value)}
                rows={3}
                required
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('triggerType')}</label>
              <Select
                value={triggerType}
                onChange={(value) => setTriggerType(value as Reminder['trigger_type'])}
                options={[
                  { value: 'time', label: `${getTriggerIcon('time')} ${t('reminderTime')}` },
                  { value: 'condition', label: `${getTriggerIcon('condition')} ${t('reminderCondition')}` },
                  { value: 'context', label: `${getTriggerIcon('context')} ${t('reminderContext')}` },
                ]}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('triggerValue')}</label>
              <Input
                placeholder={triggerType === 'time' ? t('triggerValueTimePlaceholder') : t('triggerValueConditionPlaceholder')}
                value={triggerValue}
                onChange={e => setTriggerValue(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('priority')}</label>
              <Select
                value={priority}
                onChange={(value) => setPriority(value as Reminder['priority'])}
                options={[
                  { value: 'low', label: t('priorityLow') },
                  { value: 'normal', label: t('priorityNormal') },
                  { value: 'high', label: t('priorityHigh') },
                  { value: 'critical', label: t('priorityCritical') },
                ]}
              />
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setShowCreateReminder(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" isLoading={savingReminder} disabled={!reminderContent.trim() || !triggerValue.trim()}>
              {t('create')}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
