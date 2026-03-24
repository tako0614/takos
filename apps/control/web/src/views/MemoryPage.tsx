import { useState, useEffect, type FormEvent } from 'react';
import { Icons } from '../lib/Icons';
import { rpc, rpcJson } from '../lib/rpc';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from '../hooks/useToast';
import { useConfirmDialog } from '../providers/ConfirmDialogProvider';
import { Memory, Reminder } from '../types';

export interface MemoryPageProps {
  spaceId: string;
  onBack: () => void;
}

export function MemoryPage({ spaceId, onBack }: MemoryPageProps) {
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { showToast } = useToast();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | Memory['type']>('all');
  const [showReminders, setShowReminders] = useState(false);
  const [showCreateMemory, setShowCreateMemory] = useState(false);
  const [showCreateReminder, setShowCreateReminder] = useState(false);

  const [memoryForm, setMemoryForm] = useState<{
    content: string;
    type: Memory['type'];
    category: string;
    saving: boolean;
  }>({ content: '', type: 'semantic', category: '', saving: false });

  const [reminderForm, setReminderForm] = useState<{
    content: string;
    triggerType: Reminder['trigger_type'];
    triggerValue: string;
    priority: Reminder['priority'];
    saving: boolean;
  }>({ content: '', triggerType: 'time', triggerValue: '', priority: 'normal', saving: false });

  useEffect(() => {
    if (spaceId) {
      fetchMemories();
      fetchReminders();
    }
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
    if (!memoryForm.content.trim()) return;
    setMemoryForm(prev => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[':spaceId'].memories.$post({
        param: { spaceId },
        json: {
          content: memoryForm.content.trim(),
          type: memoryForm.type,
          category: memoryForm.category.trim() || undefined,
        },
      });
      const data = await rpcJson<{ memory: Memory }>(res);
      setMemories([data.memory, ...memories]);
      setMemoryForm(prev => ({ ...prev, content: '', category: '' }));
      setShowCreateMemory(false);
      showToast('success', t('memoryCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setMemoryForm(prev => ({ ...prev, saving: false }));
    }
  };

  const handleCreateReminder = async (e: FormEvent) => {
    e.preventDefault();
    if (!reminderForm.content.trim() || !reminderForm.triggerValue.trim()) return;
    setReminderForm(prev => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[':spaceId'].reminders.$post({
        param: { spaceId },
        json: {
          content: reminderForm.content.trim(),
          trigger_type: reminderForm.triggerType,
          trigger_value: reminderForm.triggerValue.trim(),
          priority: reminderForm.priority,
        },
      });
      const data = await rpcJson<Reminder>(res);
      if (!data) throw new Error('No reminder returned');
      setReminders([data, ...reminders]);
      setReminderForm(prev => ({ ...prev, content: '', triggerValue: '' }));
      setShowCreateReminder(false);
      showToast('success', t('reminderCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setReminderForm(prev => ({ ...prev, saving: false }));
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

  const getPriorityClasses = (pri: Reminder['priority']) => {
    switch (pri) {
      case 'high': return 'border-l-4 border-l-danger';
      case 'normal': return 'border-l-4 border-l-accent';
      case 'low': return 'border-l-4 border-l-text-zinc-500';
      default: return 'border-l-4 border-l-accent';
    }
  };

  const filteredMemories = memories.filter(m => {
    const matchesFilter = activeFilter === 'all' || m.type === activeFilter;
    const matchesSearch = !searchQuery ||
      m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.category && m.category.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

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

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex gap-2 mb-6 border-b border-zinc-200 dark:border-zinc-700">
          <button
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              !showReminders
                ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100'
                : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
            onClick={() => setShowReminders(false)}
          >
            <Icons.HardDrive />
            <span>{t('memories')} ({memories.length})</span>
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              showReminders
                ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100'
                : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
            onClick={() => setShowReminders(true)}
          >
            <Icons.Bell />
            <span>{t('reminders')} ({reminders.length})</span>
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
            <div className="w-8 h-8 border-2 border-zinc-900 dark:border-zinc-100 border-t-transparent rounded-full animate-spin mb-4" />
            <span>{t('loading')}</span>
          </div>
        ) : !showReminders ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <div className="relative flex items-center">
                <Icons.Search className="w-5 h-5 absolute left-3 text-zinc-500 dark:text-zinc-400" />
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                  placeholder={t('memorySearch')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {(['all', 'episode', 'semantic', 'procedural'] as const).map(filter => (
                  <button
                    key={filter}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activeFilter === filter
                        ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100'
                    }`}
                    onClick={() => setActiveFilter(filter)}
                  >
                    {filter === 'all' ? 'All' : getTypeIcon(filter)} {filter === 'all' ? '' : getTypeLabel(filter)}
                  </button>
                ))}
              </div>
            </div>

            {filteredMemories.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
                <Icons.HardDrive className="w-12 h-12 mb-4" />
                <p>{t('noMemories')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredMemories.map(memory => (
                  <div key={memory.id} className="bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 flex flex-col gap-3 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {getTypeIcon(memory.type)} {getTypeLabel(memory.type)}
                      </span>
                      {memory.category && (
                        <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-700 rounded text-xs text-zinc-500 dark:text-zinc-400">{memory.category}</span>
                      )}
                    </div>
                    <div className="flex-1 text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed">
                      {memory.content}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400" title={t('memoryImportance')}>
                        {'★'.repeat(Math.round(memory.importance * 5))}
                        {'☆'.repeat(5 - Math.round(memory.importance * 5))}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(memory.created_at).toLocaleDateString()}
                      </span>
                      <button
                        className="p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        onClick={() => deleteMemory(memory.id)}
                        title={t('deleteMemory')}
                      >
                        <Icons.Trash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {reminders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-500 dark:text-zinc-400">
                <Icons.Bell className="w-12 h-12 mb-4" />
                <p>{t('noReminders')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {reminders.map(reminder => (
                  <div key={reminder.id} className={`bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 flex flex-col gap-3 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors ${getPriorityClasses(reminder.priority)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                        {getTriggerIcon(reminder.trigger_type)}
                        <span>
                          {reminder.trigger_type === 'time' ? t('reminderTime') :
                           reminder.trigger_type === 'condition' ? t('reminderCondition') :
                           t('reminderContext')}
                        </span>
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        reminder.status === 'pending' ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300' :
                        reminder.status === 'triggered' ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900' :
                        'bg-zinc-100 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
                      }`}>
                        {reminder.status === 'pending' ? t('reminderPending') :
                         reminder.status === 'triggered' ? t('reminderTriggered') :
                         t('reminderDismissed')}
                      </span>
                    </div>
                    <div className="flex-1 text-sm text-zinc-900 dark:text-zinc-100 leading-relaxed">
                      {reminder.content}
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-700 px-2 py-1 rounded">
                      {reminder.trigger_value}
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {new Date(reminder.created_at).toLocaleDateString()}
                      </span>
                      <button
                        className="p-1.5 rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        onClick={() => deleteReminder(reminder.id)}
                        title={t('delete')}
                      >
                        <Icons.Trash />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showCreateMemory && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowCreateMemory(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-page-create-modal-title"
        >
          <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h3 id="memory-page-create-modal-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('createMemory')}</h3>
              <button
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                onClick={() => setShowCreateMemory(false)}
                aria-label="Close"
              >
                <Icons.X />
              </button>
            </div>
            <form onSubmit={handleCreateMemory}>
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('memoryContent')}</label>
                  <textarea
                    className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors resize-none"
                    placeholder={t('memoryContentPlaceholder')}
                    value={memoryForm.content}
                    onChange={e => setMemoryForm(prev => ({ ...prev, content: e.target.value }))}
                    rows={4}
                    required
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('memoryType')}</label>
                  <select
                    className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                    value={memoryForm.type}
                    onChange={e => setMemoryForm(prev => ({ ...prev, type: e.target.value as Memory['type'] }))}
                  >
                    <option value="semantic">{getTypeIcon('semantic')} {t('memorySemantic')}</option>
                    <option value="episode">{getTypeIcon('episode')} {t('memoryEpisode')}</option>
                    <option value="procedural">{getTypeIcon('procedural')} {t('memoryProcedural')}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('memoryCategory')}</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                    placeholder={t('memoryCategoryPlaceholder')}
                    value={memoryForm.category}
                    onChange={e => setMemoryForm(prev => ({ ...prev, category: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
                <button type="button" className="px-4 py-2 rounded-lg font-medium text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors" onClick={() => setShowCreateMemory(false)}>
                  {t('cancel')}
                </button>
                <button type="submit" className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed" disabled={memoryForm.saving || !memoryForm.content.trim()}>
                  {memoryForm.saving ? t('saving') : t('create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreateReminder && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowCreateReminder(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-page-reminder-modal-title"
        >
          <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <h3 id="memory-page-reminder-modal-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('createReminder')}</h3>
              <button
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                onClick={() => setShowCreateReminder(false)}
                aria-label="Close"
              >
                <Icons.X />
              </button>
            </div>
            <form onSubmit={handleCreateReminder}>
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('reminderContent')}</label>
                  <textarea
                    className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors resize-none"
                    placeholder={t('reminderContentPlaceholder')}
                    value={reminderForm.content}
                    onChange={e => setReminderForm(prev => ({ ...prev, content: e.target.value }))}
                    rows={3}
                    required
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('triggerType')}</label>
                  <select
                    className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                    value={reminderForm.triggerType}
                    onChange={e => setReminderForm(prev => ({ ...prev, triggerType: e.target.value as Reminder['trigger_type'] }))}
                  >
                    <option value="time">{getTriggerIcon('time')} {t('reminderTime')}</option>
                    <option value="condition">{getTriggerIcon('condition')} {t('reminderCondition')}</option>
                    <option value="context">{getTriggerIcon('context')} {t('reminderContext')}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('triggerValue')}</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                    placeholder={reminderForm.triggerType === 'time' ? t('triggerValueTimePlaceholder') : t('triggerValueConditionPlaceholder')}
                    value={reminderForm.triggerValue}
                    onChange={e => setReminderForm(prev => ({ ...prev, triggerValue: e.target.value }))}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('priority')}</label>
                  <select
                    className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-zinc-900 dark:focus:border-zinc-500 transition-colors"
                    value={reminderForm.priority}
                    onChange={e => setReminderForm(prev => ({ ...prev, priority: e.target.value as Reminder['priority'] }))}
                  >
                    <option value="low">{t('priorityLow')}</option>
                    <option value="normal">{t('priorityNormal')}</option>
                    <option value="high">{t('priorityHigh')}</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700">
                <button type="button" className="px-4 py-2 rounded-lg font-medium text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors" onClick={() => setShowCreateReminder(false)}>
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium text-sm bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={reminderForm.saving || !reminderForm.content.trim() || !reminderForm.triggerValue.trim()}
                >
                  {reminderForm.saving ? t('saving') : t('create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
