import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { rpc, rpcJson } from '../lib/rpc';
import { useI18n } from '../store/i18n';
import { useToast } from './useToast';
import { useConfirmDialog } from '../store/confirm-dialog';
import type { Memory, Reminder } from '../types';

export interface MemoryFormState {
  content: string;
  type: Memory['type'];
  category: string;
  saving: boolean;
}

export interface ReminderFormState {
  content: string;
  triggerType: Reminder['trigger_type'];
  triggerValue: string;
  priority: Reminder['priority'];
  saving: boolean;
}

export interface CreateMemoryData {
  content: string;
  type: Memory['type'];
  category?: string;
  source?: string;
}

export interface CreateReminderData {
  content: string;
  trigger_type: Reminder['trigger_type'];
  trigger_value: string;
  priority: Reminder['priority'];
}

export interface UseMemoryDataReturn {
  memories: Memory[];
  reminders: Reminder[];
  loading: boolean;
  fetchMemories: () => Promise<void>;
  fetchReminders: () => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  createMemory: (data: CreateMemoryData) => Promise<void>;
  createReminder: (data: CreateReminderData) => Promise<void>;
  savingMemory: boolean;
  savingReminder: boolean;
  memoryForm: MemoryFormState;
  setMemoryForm: React.Dispatch<React.SetStateAction<MemoryFormState>>;
  reminderForm: ReminderFormState;
  setReminderForm: React.Dispatch<React.SetStateAction<ReminderFormState>>;
  handleCreateMemory: (e: FormEvent) => Promise<void>;
  handleCreateReminder: (e: FormEvent) => Promise<void>;
  getTypeIcon: (type: Memory['type']) => string;
  getTypeLabel: (type: Memory['type']) => string;
  getTriggerIcon: (type: Reminder['trigger_type']) => string;
}

export function useMemoryData(spaceId: string): UseMemoryDataReturn {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [memories, setMemories] = useState<Memory[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const [memoryForm, setMemoryForm] = useState<MemoryFormState>({
    content: '',
    type: 'semantic',
    category: '',
    saving: false,
  });

  const [reminderForm, setReminderForm] = useState<ReminderFormState>({
    content: '',
    triggerType: 'time',
    triggerValue: '',
    priority: 'normal',
    saving: false,
  });

  const fetchMemories = useCallback(async () => {
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
  }, [spaceId]);

  const fetchReminders = useCallback(async () => {
    try {
      const res = await rpc.spaces[':spaceId'].reminders.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{ reminders: Reminder[] }>(res);
      setReminders(data.reminders || []);
    } catch {
      setReminders([]);
    }
  }, [spaceId]);

  useEffect(() => {
    if (spaceId) {
      fetchMemories();
      fetchReminders();
    }
  }, [spaceId, fetchMemories, fetchReminders]);

  const deleteMemory = useCallback(async (id: string) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('confirmDeleteMemory'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await rpc.memories[':id'].$delete({ param: { id } });
      await rpcJson(res);
      setMemories(prev => prev.filter(m => m.id !== id));
      showToast('success', t('memoryDeleted'));
    } catch {
      showToast('error', t('failedToDelete'));
    }
  }, [confirm, showToast, t]);

  const deleteReminder = useCallback(async (id: string) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('confirmDeleteReminder'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await rpc.reminders[':id'].$delete({ param: { id } });
      await rpcJson(res);
      setReminders(prev => prev.filter(r => r.id !== id));
      showToast('success', t('deleted'));
    } catch {
      showToast('error', t('failedToDelete'));
    }
  }, [confirm, showToast, t]);

  const createMemory = useCallback(async (data: CreateMemoryData) => {
    setMemoryForm(prev => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[':spaceId'].memories.$post({
        param: { spaceId },
        json: {
          content: data.content.trim(),
          type: data.type,
          category: data.category?.trim() || undefined,
          source: data.source,
        },
      });
      const result = await rpcJson<{ memory: Memory }>(res);
      setMemories(prev => [result.memory, ...prev]);
      showToast('success', t('memoryCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setMemoryForm(prev => ({ ...prev, saving: false }));
    }
  }, [spaceId, showToast, t]);

  const createReminder = useCallback(async (data: CreateReminderData) => {
    setReminderForm(prev => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[':spaceId'].reminders.$post({
        param: { spaceId },
        json: {
          content: data.content.trim(),
          trigger_type: data.trigger_type,
          trigger_value: data.trigger_value.trim(),
          priority: data.priority,
        },
      });
      const result = await rpcJson<{ reminder: Reminder }>(res);
      setReminders(prev => [result.reminder, ...prev]);
      showToast('success', t('reminderCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setReminderForm(prev => ({ ...prev, saving: false }));
    }
  }, [spaceId, showToast, t]);

  const handleCreateMemory = useCallback(async (e: FormEvent) => {
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
      setMemories(prev => [data.memory, ...prev]);
      setMemoryForm(prev => ({ ...prev, content: '', category: '' }));
      showToast('success', t('memoryCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setMemoryForm(prev => ({ ...prev, saving: false }));
    }
  }, [memoryForm.content, memoryForm.type, memoryForm.category, spaceId, showToast, t]);

  const handleCreateReminder = useCallback(async (e: FormEvent) => {
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
      const data = await rpcJson<{ reminder: Reminder }>(res);
      setReminders(prev => [data.reminder, ...prev]);
      setReminderForm(prev => ({ ...prev, content: '', triggerValue: '' }));
      showToast('success', t('reminderCreated'));
    } catch {
      showToast('error', t('failedToCreate'));
    } finally {
      setReminderForm(prev => ({ ...prev, saving: false }));
    }
  }, [reminderForm.content, reminderForm.triggerType, reminderForm.triggerValue, reminderForm.priority, spaceId, showToast, t]);

  const getTypeIcon = useCallback((type: Memory['type']) => {
    switch (type) {
      case 'episode': return '\u{1F4C5}';
      case 'semantic': return '\u{1F4A1}';
      case 'procedural': return '\u{1F4CB}';
    }
  }, []);

  const getTypeLabel = useCallback((type: Memory['type']) => {
    switch (type) {
      case 'episode': return t('memoryEpisode');
      case 'semantic': return t('memorySemantic');
      case 'procedural': return t('memoryProcedural');
    }
  }, [t]);

  const getTriggerIcon = useCallback((type: Reminder['trigger_type']) => {
    switch (type) {
      case 'time': return '\u23F0';
      case 'condition': return '\u{1F3AF}';
      case 'context': return '\u{1F4AC}';
    }
  }, []);

  return {
    memories,
    reminders,
    loading,
    fetchMemories,
    fetchReminders,
    deleteMemory,
    deleteReminder,
    createMemory,
    createReminder,
    savingMemory: memoryForm.saving,
    savingReminder: reminderForm.saving,
    memoryForm,
    setMemoryForm,
    reminderForm,
    setReminderForm,
    handleCreateMemory,
    handleCreateReminder,
    getTypeIcon,
    getTypeLabel,
    getTriggerIcon,
  };
}
