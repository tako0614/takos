import { useState, useEffect, type FormEvent } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { useConfirmDialog } from '../../providers/ConfirmDialogProvider';
import { rpc, rpcJson } from '../../lib/rpc';
import { Icons } from '../../lib/Icons';
import { Button, Card, Badge, Input, Textarea, Select, Modal, ModalFooter } from '../../components/ui';
import type { Memory, Reminder } from '../../types';

export function MemoryTab({ spaceId }: { spaceId: string }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'episode' | 'semantic' | 'procedural'>('all');
  const [showReminders, setShowReminders] = useState(false);
  const [showCreateMemory, setShowCreateMemory] = useState(false);
  const [showCreateReminder, setShowCreateReminder] = useState(false);

  const [memoryContent, setMemoryContent] = useState('');
  const [memoryType, setMemoryType] = useState<Memory['type']>('semantic');
  const [memoryCategory, setMemoryCategory] = useState('');
  const [savingMemory, setSavingMemory] = useState(false);

  const [reminderContent, setReminderContent] = useState('');
  const [triggerType, setTriggerType] = useState<Reminder['trigger_type']>('time');
  const [triggerValue, setTriggerValue] = useState('');
  const [priority, setPriority] = useState<Reminder['priority']>('normal');
  const [savingReminder, setSavingReminder] = useState(false);

  useEffect(() => {
    fetchMemories();
    fetchReminders();
  }, [spaceId]);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const res = await rpc.spaces[':spaceId'].memories.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{ memories: Memory[] }>(res);
      setMemories(data.memories || []);
    } catch {
      setMemories([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchReminders = async () => {
    try {
      const res = await rpc.spaces[':spaceId'].reminders.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{ reminders: Reminder[] }>(res);
      setReminders(data.reminders || []);
    } catch {
      setReminders([]);
    }
  };

  const deleteMemory = async (id: string) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('confirmDeleteMemory'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.memories[':id'].$delete({
        param: { id },
      });
      await rpcJson(res);
      setMemories(memories.filter(m => m.id !== id));
      showToast('success', t('memoryDeleted'));
    } catch {
      showToast('error', t('failedToDelete'));
    }
  };

  const deleteReminder = async (id: string) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('confirmDeleteReminder'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.reminders[':id'].$delete({
        param: { id },
      });
      await rpcJson(res);
      setReminders(reminders.filter(r => r.id !== id));
      showToast('success', t('deleted'));
    } catch {
      showToast('error', t('failedToDelete'));
    }
  };

  const handleCreateMemory = async (e: FormEvent) => {
    e.preventDefault();
    if (!memoryContent.trim()) return;

    setSavingMemory(true);
    try {
      const res = await rpc.spaces[':spaceId'].memories.$post({
        param: { spaceId },
        json: {
          content: memoryContent.trim(),
          type: memoryType,
          category: memoryCategory.trim() || undefined,
          source: 'user',
        },
      });
      const data = await rpcJson<{ memory: Memory }>(res);
      setMemories([data.memory, ...memories]);
      setMemoryContent('');
      setMemoryCategory('');
      setShowCreateMemory(false);
      showToast('success', t('memoryCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setSavingMemory(false);
    }
  };

  const handleCreateReminder = async (e: FormEvent) => {
    e.preventDefault();
    if (!reminderContent.trim() || !triggerValue.trim()) return;

    setSavingReminder(true);
    try {
      const res = await rpc.spaces[':spaceId'].reminders.$post({
        param: { spaceId },
        json: {
          content: reminderContent.trim(),
          trigger_type: triggerType,
          trigger_value: triggerValue.trim(),
          priority,
        },
      });
      const data = await rpcJson<{ reminder: Reminder }>(res);
      setReminders([data.reminder, ...reminders]);
      setReminderContent('');
      setTriggerValue('');
      setShowCreateReminder(false);
      showToast('success', t('reminderCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setSavingReminder(false);
    }
  };

  const getTypeIcon = (type: Memory['type']) => {
    switch (type) {
      case 'episode': return '📅';
      case 'semantic': return '💡';
      case 'procedural': return '📋';
    }
  };

  const getTypeLabel = (type: Memory['type']) => {
    switch (type) {
      case 'episode': return t('memoryEpisode');
      case 'semantic': return t('memorySemantic');
      case 'procedural': return t('memoryProcedural');
    }
  };

  const getTriggerIcon = (type: Reminder['trigger_type']) => {
    switch (type) {
      case 'time': return '⏰';
      case 'condition': return '🎯';
      case 'context': return '💬';
    }
  };

  const getTriggerLabel = (type: Reminder['trigger_type']) => {
    switch (type) {
      case 'time': return t('reminderTime');
      case 'condition': return t('reminderCondition');
      case 'context': return t('reminderContext');
    }
  };

  const getStatusLabel = (status: Reminder['status']) => {
    switch (status) {
      case 'pending': return t('reminderPending');
      case 'triggered': return t('reminderTriggered');
      default: return t('reminderDismissed');
    }
  };

  const getPriorityBorderStyle = (priority: Reminder['priority']): React.CSSProperties => {
    switch (priority) {
      case 'critical': return { borderLeft: '4px solid var(--color-error)' };
      case 'high': return { borderLeft: '4px solid var(--color-warning)' };
      case 'normal': return { borderLeft: '4px solid var(--color-border-primary)' };
      case 'low': return { borderLeft: '4px solid var(--color-border-secondary)' };
    }
  };

  const filteredMemories = memories.filter(m => {
    const matchesFilter = activeFilter === 'all' || m.type === activeFilter;
    const matchesSearch = !searchQuery ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.category && m.category.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

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
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Input
              placeholder={t('memorySearch')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Icons.Search style={{ width: '1rem', height: '1rem' }} />}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {(['all', 'episode', 'semantic', 'procedural'] as const).map(filter => (
                <Button
                  key={filter}
                  variant={activeFilter === filter ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter === 'all' ? t('taskFilterAll') : `${getTypeIcon(filter)} ${getTypeLabel(filter)}`}
                </Button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {filteredMemories.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem 0', color: 'var(--color-text-tertiary)', gap: '0.75rem' }}>
                <Icons.HardDrive />
                <p>{t('noMemories')}</p>
              </div>
            ) : (
              filteredMemories.map(memory => (
                <Card key={memory.id} padding="md">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    <Badge variant="default">
                      {getTypeIcon(memory.type)} {getTypeLabel(memory.type)}
                    </Badge>
                    {memory.category && (
                      <Badge variant="default">{memory.category}</Badge>
                    )}
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem', marginLeft: 'auto' }} title={t('memoryImportance')}>
                      {'★'.repeat(Math.round(memory.importance * 5))}
                      {'☆'.repeat(5 - Math.round(memory.importance * 5))}
                    </span>
                  </div>
                  <div style={{ color: 'var(--color-text-primary)', fontSize: '0.875rem', lineHeight: '1.6' }}>
                    {memory.content}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border-primary)' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                      {t('memoryAccessCount')}: {memory.access_count}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                      {new Date(memory.created_at).toLocaleDateString()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMemory(memory.id)}
                      title={t('deleteMemory')}
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
            onClick={() => setShowCreateMemory(true)}
            style={{ width: '100%', marginTop: '0.5rem', border: '2px dashed var(--color-border-primary)' }}
          >
            {t('createMemory')}
          </Button>
        </>
      ) : (
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
                      <span>{getTriggerLabel(reminder.trigger_type)}</span>
                    </span>
                    <Badge variant="default">
                      {getStatusLabel(reminder.status)}
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
                      onClick={() => deleteReminder(reminder.id)}
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
        </>
      )}

      <Modal
        isOpen={showCreateMemory}
        onClose={() => setShowCreateMemory(false)}
        title={t('createMemory')}
      >
        <form onSubmit={handleCreateMemory}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('memoryContent')}</label>
              <Textarea
                placeholder={t('memoryContentPlaceholder')}
                value={memoryContent}
                onChange={e => setMemoryContent(e.target.value)}
                rows={4}
                required
                autoFocus
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('memoryType')}</label>
              <Select
                value={memoryType}
                onChange={(value) => setMemoryType(value as Memory['type'])}
                options={[
                  { value: 'semantic', label: `${getTypeIcon('semantic')} ${t('memorySemantic')}` },
                  { value: 'episode', label: `${getTypeIcon('episode')} ${t('memoryEpisode')}` },
                  { value: 'procedural', label: `${getTypeIcon('procedural')} ${t('memoryProcedural')}` },
                ]}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{t('memoryCategory')}</label>
              <Input
                placeholder={t('memoryCategoryPlaceholder')}
                value={memoryCategory}
                onChange={e => setMemoryCategory(e.target.value)}
              />
            </div>
          </div>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setShowCreateMemory(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="primary" isLoading={savingMemory} disabled={!memoryContent.trim()}>
              {t('create')}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

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
    </div>
  );
}
