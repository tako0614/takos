import { createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Button, Card, Badge, Input, Textarea, Select, Modal, ModalFooter } from '../../components/ui/index.ts';
import type { Reminder } from '../../types/index.ts';

function getTriggerIcon(type: Reminder['trigger_type']) {
  switch (type) {
    case 'time': return '⏰';
    case 'condition': return '🎯';
    case 'context': return '💬';
  }
}

function getTriggerLabel(type: Reminder['trigger_type'], t: (key: any) => string) {
  switch (type) {
    case 'time': return t('reminderTime');
    case 'condition': return t('reminderCondition');
    case 'context': return t('reminderContext');
  }
}

function getStatusLabel(status: Reminder['status'], t: (key: any) => string) {
  switch (status) {
    case 'pending': return t('reminderPending');
    case 'triggered': return t('reminderTriggered');
    default: return t('reminderDismissed');
  }
}

function getPriorityBorderStyle(priority: Reminder['priority']): JSX.CSSProperties {
  switch (priority) {
    case 'critical': return { "border-left": '4px solid var(--color-error)' };
    case 'high': return { "border-left": '4px solid var(--color-warning)' };
    case 'normal': return { "border-left": '4px solid var(--color-border-primary)' };
    case 'low': return { "border-left": '4px solid var(--color-border-secondary)' };
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
  const [showCreateReminder, setShowCreateReminder] = createSignal(false);

  const [reminderContent, setReminderContent] = createSignal('');
  const [triggerType, setTriggerType] = createSignal<Reminder['trigger_type']>('time');
  const [triggerValue, setTriggerValue] = createSignal('');
  const [priority, setPriority] = createSignal<Reminder['priority']>('normal');

  const handleCreateReminder = async (e: Event & { currentTarget: HTMLFormElement }) => {
    e.preventDefault();
    if (!reminderContent().trim() || !triggerValue().trim()) return;
    await onCreateReminder({
      content: reminderContent().trim(),
      trigger_type: triggerType(),
      trigger_value: triggerValue().trim(),
      priority: priority(),
    });
    setReminderContent('');
    setTriggerValue('');
    setShowCreateReminder(false);
  };

  return (
    <>
      <div style={{ display: 'flex', "flex-direction": 'column', gap: '0.75rem' }}>
        {reminders.length === 0 ? (
          <div style={{ display: 'flex', "flex-direction": 'column', "align-items": 'center', "justify-content": 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)', gap: '0.75rem' }}>
            <Icons.Bell />
            <p>{t('noReminders')}</p>
          </div>
        ) : (
          reminders.map(reminder => (
            <Card padding="md" style={getPriorityBorderStyle(reminder.priority)}>
              <div style={{ display: 'flex', "align-items": 'center', "justify-content": 'space-between', "margin-bottom": '0.5rem' }}>
                <span style={{ display: 'flex', "align-items": 'center', gap: '0.5rem', "font-size": '0.875rem', color: 'var(--color-text-tertiary)' }}>
                  {getTriggerIcon(reminder.trigger_type)}
                  <span>{getTriggerLabel(reminder.trigger_type, t)}</span>
                </span>
                <Badge variant="default">
                  {getStatusLabel(reminder.status, t)}
                </Badge>
              </div>
              <div style={{ color: 'var(--color-text-primary)', "font-size": '0.875rem', "line-height": '1.6' }}>
                {reminder.content}
              </div>
              <div style={{ "font-size": '0.75rem', color: 'var(--color-text-tertiary)', "margin-top": '0.5rem', padding: '0.25rem 0.5rem', "background-color": 'var(--color-bg-tertiary)', "border-radius": 'var(--radius-sm)' }}>
                {reminder.trigger_value}
              </div>
              <div style={{ display: 'flex', "align-items": 'center', "justify-content": 'space-between', "margin-top": '0.75rem', "padding-top": '0.75rem', "border-top": '1px solid var(--color-border-primary)' }}>
                <span style={{ "font-size": '0.75rem', color: 'var(--color-text-tertiary)' }}>
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
        style={{ width: '100%', "margin-top": '0.5rem', border: '2px dashed var(--color-border-primary)' }}
      >
        {t('createReminder')}
      </Button>

      <Modal
        isOpen={showCreateReminder()}
        onClose={() => setShowCreateReminder(false)}
        title={t('createReminder')}
      >
        <form onSubmit={handleCreateReminder}>
          <div style={{ display: 'flex', "flex-direction": 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', "flex-direction": 'column', gap: '0.5rem' }}>
              <label style={{ "font-size": '0.875rem', "font-weight": 500, color: 'var(--color-text-secondary)' }}>{t('reminderContent')}</label>
              <Textarea
                placeholder={t('reminderContentPlaceholder')}
                value={reminderContent()}
                onInput={e => setReminderContent(e.target.value)}
                rows={3}
                required
                autofocus
              />
            </div>
            <div style={{ display: 'flex', "flex-direction": 'column', gap: '0.5rem' }}>
              <label style={{ "font-size": '0.875rem', "font-weight": 500, color: 'var(--color-text-secondary)' }}>{t('triggerType')}</label>
              <Select
                value={triggerType()}
                onChange={(value) => setTriggerType(value as Reminder['trigger_type'])}
                options={[
                  { value: 'time', label: `${getTriggerIcon('time')} ${t('reminderTime')}` },
                  { value: 'condition', label: `${getTriggerIcon('condition')} ${t('reminderCondition')}` },
                  { value: 'context', label: `${getTriggerIcon('context')} ${t('reminderContext')}` },
                ]}
              />
            </div>
            <div style={{ display: 'flex', "flex-direction": 'column', gap: '0.5rem' }}>
              <label style={{ "font-size": '0.875rem', "font-weight": 500, color: 'var(--color-text-secondary)' }}>{t('triggerValue')}</label>
              <Input
                placeholder={triggerType() === 'time' ? t('triggerValueTimePlaceholder') : t('triggerValueConditionPlaceholder')}
                value={triggerValue()}
                onInput={e => setTriggerValue(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', "flex-direction": 'column', gap: '0.5rem' }}>
              <label style={{ "font-size": '0.875rem', "font-weight": 500, color: 'var(--color-text-secondary)' }}>{t('priority')}</label>
              <Select
                value={priority()}
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
            <Button type="submit" variant="primary" isLoading={savingReminder} disabled={!reminderContent().trim() || !triggerValue().trim()}>
              {t('create')}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
