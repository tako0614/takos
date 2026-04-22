import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  type Setter,
} from "solid-js";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import type { Memory, Reminder } from "../types/index.ts";

export interface MemoryFormState {
  content: string;
  type: Memory["type"];
  category: string;
  saving: boolean;
}

export interface ReminderFormState {
  content: string;
  triggerType: Reminder["trigger_type"];
  triggerValue: string;
  priority: Reminder["priority"];
  saving: boolean;
}

export interface CreateMemoryData {
  content: string;
  type: Memory["type"];
  category?: string;
  source?: string;
}

export interface CreateReminderData {
  content: string;
  trigger_type: Reminder["trigger_type"];
  trigger_value: string;
  priority: Reminder["priority"];
}

export interface UseMemoryDataReturn {
  memories: () => Memory[];
  reminders: () => Reminder[];
  loading: () => boolean;
  error: () => string | null;
  fetchMemories: () => Promise<void>;
  fetchReminders: () => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  createMemory: (data: CreateMemoryData) => Promise<void>;
  createReminder: (data: CreateReminderData) => Promise<void>;
  savingMemory: () => boolean;
  savingReminder: () => boolean;
  memoryForm: () => MemoryFormState;
  setMemoryForm: Setter<MemoryFormState>;
  reminderForm: () => ReminderFormState;
  setReminderForm: Setter<ReminderFormState>;
  handleCreateMemory: (e: Event) => Promise<void>;
  handleCreateReminder: (e: Event) => Promise<void>;
  getTypeIcon: (type: Memory["type"]) => string;
  getTypeLabel: (type: Memory["type"]) => string;
  getTriggerIcon: (type: Reminder["trigger_type"]) => string;
}

export function useMemoryData(
  spaceId: Accessor<string | undefined>,
): UseMemoryDataReturn {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const currentSpaceId = () => spaceId() ?? "";

  const [memories, setMemories] = createSignal<Memory[]>([]);
  const [reminders, setReminders] = createSignal<Reminder[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  let memoriesSeqRef = 0;
  let remindersSeqRef = 0;

  const [memoryForm, setMemoryForm] = createSignal<MemoryFormState>({
    content: "",
    type: "semantic",
    category: "",
    saving: false,
  });

  const [reminderForm, setReminderForm] = createSignal<ReminderFormState>({
    content: "",
    triggerType: "time",
    triggerValue: "",
    priority: "normal",
    saving: false,
  });

  const fetchMemories = async () => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      setMemories([]);
      setLoading(false);
      return;
    }
    const seq = ++memoriesSeqRef;
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.spaces[":spaceId"].memories.$get({
        param: { spaceId: targetSpaceId },
        query: {},
      });
      if (seq !== memoriesSeqRef) return;
      const data = await rpcJson<{ memories: Memory[] }>(res);
      if (seq !== memoriesSeqRef) return;
      setMemories(data.memories || []);
    } catch (err) {
      if (seq !== memoriesSeqRef) return;
      setError(err instanceof Error ? err.message : t("failedToFetchMemories"));
      setMemories([]);
    } finally {
      if (seq === memoriesSeqRef) {
        setLoading(false);
      }
    }
  };

  const fetchReminders = async () => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) {
      setReminders([]);
      return;
    }
    const seq = ++remindersSeqRef;
    try {
      const res = await rpc.spaces[":spaceId"].reminders.$get({
        param: { spaceId: targetSpaceId },
        query: {},
      });
      if (seq !== remindersSeqRef) return;
      const data = await rpcJson<{ reminders: Reminder[] }>(res);
      if (seq !== remindersSeqRef) return;
      setReminders(data.reminders || []);
    } catch (err) {
      if (seq !== remindersSeqRef) return;
      setError(
        err instanceof Error ? err.message : t("failedToFetchReminders"),
      );
      setReminders([]);
    }
  };

  createEffect(on(spaceId, (nextSpaceId) => {
    ++memoriesSeqRef;
    ++remindersSeqRef;
    setMemories([]);
    setReminders([]);
    setError(null);
    if (nextSpaceId) {
      void fetchMemories();
      void fetchReminders();
    } else {
      setLoading(false);
    }
  }));

  const deleteMemory = async (id: string) => {
    const confirmed = await confirm({
      title: t("confirmDelete"),
      message: t("confirmDeleteMemory"),
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await rpc.memories[":id"].$delete({ param: { id } });
      await rpcJson(res);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      showToast("success", t("memoryDeleted"));
    } catch {
      showToast("error", t("failedToDelete"));
    }
  };

  const deleteReminder = async (id: string) => {
    const confirmed = await confirm({
      title: t("confirmDelete"),
      message: t("confirmDeleteReminder"),
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return;
    try {
      const res = await rpc.reminders[":id"].$delete({ param: { id } });
      await rpcJson(res);
      setReminders((prev) => prev.filter((r) => r.id !== id));
      showToast("success", t("deleted"));
    } catch {
      showToast("error", t("failedToDelete"));
    }
  };

  const createMemory = async (data: CreateMemoryData) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) return;
    setMemoryForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].memories.$post({
        param: { spaceId: targetSpaceId },
        json: {
          content: data.content.trim(),
          type: data.type,
          category: data.category?.trim() || undefined,
          source: data.source,
        },
      });
      const result = await rpcJson<{ memory: Memory }>(res);
      setMemories((prev) => [result.memory, ...prev]);
      showToast("success", t("memoryCreated"));
    } catch {
      showToast("error", t("failedToCreate"));
    } finally {
      setMemoryForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const createReminder = async (data: CreateReminderData) => {
    const targetSpaceId = currentSpaceId();
    if (!targetSpaceId) return;
    setReminderForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].reminders.$post({
        param: { spaceId: targetSpaceId },
        json: {
          content: data.content.trim(),
          trigger_type: data.trigger_type,
          trigger_value: data.trigger_value.trim(),
          priority: data.priority,
        },
      });
      const result = await rpcJson<{ reminder: Reminder }>(res);
      setReminders((prev) => [result.reminder, ...prev]);
      showToast("success", t("reminderCreated"));
    } catch {
      showToast("error", t("failedToCreate"));
    } finally {
      setReminderForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleCreateMemory = async (e: Event) => {
    e.preventDefault();
    const form = memoryForm();
    const targetSpaceId = currentSpaceId();
    if (!form.content.trim() || !targetSpaceId) return;
    setMemoryForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].memories.$post({
        param: { spaceId: targetSpaceId },
        json: {
          content: form.content.trim(),
          type: form.type,
          category: form.category.trim() || undefined,
        },
      });
      const data = await rpcJson<{ memory: Memory }>(res);
      setMemories((prev) => [data.memory, ...prev]);
      setMemoryForm((prev) => ({ ...prev, content: "", category: "" }));
      showToast("success", t("memoryCreated"));
    } catch {
      showToast("error", t("failedToCreate"));
    } finally {
      setMemoryForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleCreateReminder = async (e: Event) => {
    e.preventDefault();
    const form = reminderForm();
    const targetSpaceId = currentSpaceId();
    if (!form.content.trim() || !form.triggerValue.trim() || !targetSpaceId) {
      return;
    }
    setReminderForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].reminders.$post({
        param: { spaceId: targetSpaceId },
        json: {
          content: form.content.trim(),
          trigger_type: form.triggerType,
          trigger_value: form.triggerValue.trim(),
          priority: form.priority,
        },
      });
      const data = await rpcJson<{ reminder: Reminder }>(res);
      setReminders((prev) => [data.reminder, ...prev]);
      setReminderForm((prev) => ({ ...prev, content: "", triggerValue: "" }));
      showToast("success", t("reminderCreated"));
    } catch {
      showToast("error", t("failedToCreate"));
    } finally {
      setReminderForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const getTypeIcon = (type: Memory["type"]) => {
    switch (type) {
      case "episode":
        return "\u{1F4C5}";
      case "semantic":
        return "\u{1F4A1}";
      case "procedural":
        return "\u{1F4CB}";
    }
  };

  const getTypeLabel = (type: Memory["type"]) => {
    switch (type) {
      case "episode":
        return t("memoryEpisode");
      case "semantic":
        return t("memorySemantic");
      case "procedural":
        return t("memoryProcedural");
    }
  };

  const getTriggerIcon = (type: Reminder["trigger_type"]) => {
    switch (type) {
      case "time":
        return "\u23F0";
      case "condition":
        return "\u{1F3AF}";
      case "context":
        return "\u{1F4AC}";
    }
  };

  return {
    memories,
    reminders,
    loading,
    error,
    fetchMemories,
    fetchReminders,
    deleteMemory,
    deleteReminder,
    createMemory,
    createReminder,
    savingMemory: () => memoryForm().saving,
    savingReminder: () => reminderForm().saving,
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
