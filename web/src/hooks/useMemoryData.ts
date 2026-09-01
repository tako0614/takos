import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  type Setter,
  untrack,
} from "solid-js";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import { useI18n } from "../store/i18n.ts";
import { useToast } from "../store/toast.ts";
import { useConfirmDialog } from "../store/confirm-dialog.ts";
import type { Memory, Reminder } from "../types/index.ts";
import {
  parseMemoriesListResponse,
  parseMemoryDeleteResponse,
  parseMemoryMutationResponse,
  parseRemindersListResponse,
  parseReminderMutationResponse,
} from "./memory-mutation-response.ts";

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
}

export interface CreateReminderData {
  content: string;
  trigger_type: Reminder["trigger_type"];
  trigger_value: string;
  priority: Reminder["priority"];
}

export interface UpdateMemoryData {
  content: string;
  category?: string;
}

export interface UpdateReminderData {
  content: string;
  trigger_value: string;
  priority: Reminder["priority"];
}

export interface UseMemoryDataReturn {
  memories: () => Memory[];
  reminders: () => Reminder[];
  loading: () => boolean;
  remindersLoading: () => boolean;
  error: () => string | null;
  memoryError: () => string | null;
  reminderError: () => string | null;
  fetchMemories: () => Promise<void>;
  fetchReminders: () => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  createMemory: (data: CreateMemoryData) => Promise<boolean>;
  createReminder: (data: CreateReminderData) => Promise<boolean>;
  updateMemory: (id: string, data: UpdateMemoryData) => Promise<boolean>;
  updateReminder: (id: string, data: UpdateReminderData) => Promise<boolean>;
  savingMemory: () => boolean;
  savingReminder: () => boolean;
  memoryForm: () => MemoryFormState;
  setMemoryForm: Setter<MemoryFormState>;
  reminderForm: () => ReminderFormState;
  setReminderForm: Setter<ReminderFormState>;
  handleCreateMemory: (e: Event) => Promise<boolean>;
  handleCreateReminder: (e: Event) => Promise<boolean>;
  getTypeIcon: (type: Memory["type"]) => string;
  getTypeLabel: (type: Memory["type"]) => string;
  getTriggerIcon: (type: Reminder["trigger_type"]) => string;
}

export function useMemoryData(
  spaceIdentifier: Accessor<string | undefined>,
  spaceRecordId: Accessor<string | undefined>,
): UseMemoryDataReturn {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const currentSpaceIdentifier = () => spaceIdentifier() ?? "";
  const currentSpaceRecordId = () => spaceRecordId() ?? "";
  const isCurrentSpace = (identifier: string, recordId: string) =>
    currentSpaceIdentifier() === identifier &&
    currentSpaceRecordId() === recordId;

  const [memories, setMemories] = createSignal<Memory[]>([]);
  const [reminders, setReminders] = createSignal<Reminder[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [remindersLoading, setRemindersLoading] = createSignal(true);
  const [memoryError, setMemoryError] = createSignal<string | null>(null);
  const [reminderError, setReminderError] = createSignal<string | null>(null);
  const latestMemories = createLatestRequest();
  const latestReminders = createLatestRequest();
  const deletingMemoryIds = new Set<string>();
  const deletingReminderIds = new Set<string>();

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
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (!targetSpaceIdentifier || !targetSpaceRecordId) {
      setMemories([]);
      setLoading(false);
      return;
    }
    const claim = latestMemories.claim();
    setLoading(untrack(memories).length === 0);
    setMemoryError(null);
    try {
      const res = await rpc.spaces[":spaceId"].memories.$get({
        param: { spaceId: targetSpaceIdentifier },
        query: {},
      });
      if (!claim.won()) return;
      const data = parseMemoriesListResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
      );
      if (!claim.won()) return;
      setMemories(data);
    } catch {
      if (!claim.won()) return;
      setMemoryError(t("failedToFetchMemories"));
    } finally {
      if (claim.won()) {
        setLoading(false);
      }
    }
  };

  const fetchReminders = async () => {
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (!targetSpaceIdentifier || !targetSpaceRecordId) {
      setReminders([]);
      setRemindersLoading(false);
      return;
    }
    const claim = latestReminders.claim();
    setRemindersLoading(untrack(reminders).length === 0);
    setReminderError(null);
    try {
      const res = await rpc.spaces[":spaceId"].reminders.$get({
        param: { spaceId: targetSpaceIdentifier },
        query: {},
      });
      if (!claim.won()) return;
      const data = parseRemindersListResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
      );
      if (!claim.won()) return;
      setReminders(data);
    } catch {
      if (!claim.won()) return;
      setReminderError(t("failedToFetchReminders"));
    } finally {
      if (claim.won()) {
        setRemindersLoading(false);
      }
    }
  };

  createEffect(on(
    () => [spaceIdentifier(), spaceRecordId()] as const,
    ([nextSpaceIdentifier, nextSpaceRecordId]) => {
    latestMemories.next();
    latestReminders.next();
    setMemories([]);
    setReminders([]);
    setMemoryError(null);
    setReminderError(null);
    if (nextSpaceIdentifier && nextSpaceRecordId) {
      void fetchMemories();
      void fetchReminders();
    } else {
      setLoading(false);
      setRemindersLoading(false);
    }
    },
  ));

  const deleteMemory = async (id: string) => {
    if (deletingMemoryIds.has(id)) return;
    deletingMemoryIds.add(id);
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    try {
      const confirmed = await confirm({
        title: t("confirmDelete"),
        message: t("confirmDeleteMemory"),
        confirmText: t("delete"),
        danger: true,
      });
      if (!confirmed) return;
      const res = await rpc.memories[":id"].$delete({ param: { id } });
      parseMemoryDeleteResponse(await rpcJson<unknown>(res));
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setMemories((prev) => prev.filter((m) => m.id !== id));
      }
      showToast("success", t("memoryDeleted"));
    } catch {
      showToast("error", t("failedToDelete"));
    } finally {
      deletingMemoryIds.delete(id);
    }
  };

  const deleteReminder = async (id: string) => {
    if (deletingReminderIds.has(id)) return;
    deletingReminderIds.add(id);
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    try {
      const confirmed = await confirm({
        title: t("confirmDelete"),
        message: t("confirmDeleteReminder"),
        confirmText: t("delete"),
        danger: true,
      });
      if (!confirmed) return;
      const res = await rpc.reminders[":id"].$delete({ param: { id } });
      parseMemoryDeleteResponse(await rpcJson<unknown>(res));
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setReminders((prev) => prev.filter((r) => r.id !== id));
      }
      showToast("success", t("deleted"));
    } catch {
      showToast("error", t("failedToDelete"));
    } finally {
      deletingReminderIds.delete(id);
    }
  };

  const createMemory = async (data: CreateMemoryData) => {
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (!targetSpaceIdentifier || !targetSpaceRecordId || memoryForm().saving) {
      return false;
    }
    setMemoryForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].memories.$post({
        param: { spaceId: targetSpaceIdentifier },
        json: {
          content: data.content.trim(),
          type: data.type,
          category: data.category?.trim() || undefined,
        },
      });
      const memory = parseMemoryMutationResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
      );
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setMemories((prev) => [memory, ...prev]);
      }
      showToast("success", t("memoryCreated"));
      return true;
    } catch {
      showToast("error", t("failedToCreate"));
      return false;
    } finally {
      setMemoryForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const createReminder = async (data: CreateReminderData) => {
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (
      !targetSpaceIdentifier || !targetSpaceRecordId || reminderForm().saving
    ) {
      return false;
    }
    setReminderForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].reminders.$post({
        param: { spaceId: targetSpaceIdentifier },
        json: {
          content: data.content.trim(),
          trigger_type: data.trigger_type,
          trigger_value: data.trigger_value.trim(),
          priority: data.priority,
        },
      });
      const reminder = parseReminderMutationResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
      );
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setReminders((prev) => [reminder, ...prev]);
      }
      showToast("success", t("reminderCreated"));
      return true;
    } catch {
      showToast("error", t("failedToCreate"));
      return false;
    } finally {
      setReminderForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const updateMemory = async (id: string, data: UpdateMemoryData) => {
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (!targetSpaceIdentifier || !targetSpaceRecordId || memoryForm().saving) {
      return false;
    }
    setMemoryForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.memories[":id"].$patch({
        param: { id },
        json: {
          content: data.content.trim(),
          category: data.category?.trim() || null,
        },
      });
      const memory = parseMemoryMutationResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
        id,
      );
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setMemories((prev) =>
          prev.map((current) => current.id === memory.id ? memory : current)
        );
      }
      showToast("success", t("memoryUpdated"));
      return true;
    } catch {
      showToast("error", t("failedToUpdate"));
      return false;
    } finally {
      setMemoryForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const updateReminder = async (id: string, data: UpdateReminderData) => {
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (
      !targetSpaceIdentifier || !targetSpaceRecordId || reminderForm().saving
    ) {
      return false;
    }
    setReminderForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.reminders[":id"].$patch({
        param: { id },
        json: {
          content: data.content.trim(),
          trigger_value: data.trigger_value.trim(),
          priority: data.priority,
        },
      });
      const reminder = parseReminderMutationResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
        id,
      );
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setReminders((prev) =>
          prev.map((current) =>
            current.id === reminder.id ? reminder : current
          )
        );
      }
      showToast("success", t("reminderUpdated"));
      return true;
    } catch {
      showToast("error", t("failedToUpdate"));
      return false;
    } finally {
      setReminderForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleCreateMemory = async (e: Event) => {
    e.preventDefault();
    const form = memoryForm();
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (
      !form.content.trim() || !targetSpaceIdentifier || !targetSpaceRecordId ||
      form.saving
    ) return false;
    setMemoryForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].memories.$post({
        param: { spaceId: targetSpaceIdentifier },
        json: {
          content: form.content.trim(),
          type: form.type,
          category: form.category.trim() || undefined,
        },
      });
      const memory = parseMemoryMutationResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
      );
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setMemories((prev) => [memory, ...prev]);
      }
      setMemoryForm((prev) => ({ ...prev, content: "", category: "" }));
      showToast("success", t("memoryCreated"));
      return true;
    } catch {
      showToast("error", t("failedToCreate"));
      return false;
    } finally {
      setMemoryForm((prev) => ({ ...prev, saving: false }));
    }
  };

  const handleCreateReminder = async (e: Event) => {
    e.preventDefault();
    const form = reminderForm();
    const targetSpaceIdentifier = currentSpaceIdentifier();
    const targetSpaceRecordId = currentSpaceRecordId();
    if (
      !form.content.trim() || !form.triggerValue.trim() ||
      !targetSpaceIdentifier || !targetSpaceRecordId || form.saving
    ) {
      return false;
    }
    setReminderForm((prev) => ({ ...prev, saving: true }));
    try {
      const res = await rpc.spaces[":spaceId"].reminders.$post({
        param: { spaceId: targetSpaceIdentifier },
        json: {
          content: form.content.trim(),
          trigger_type: form.triggerType,
          trigger_value: form.triggerValue.trim(),
          priority: form.priority,
        },
      });
      const reminder = parseReminderMutationResponse(
        await rpcJson<unknown>(res),
        targetSpaceRecordId,
      );
      if (isCurrentSpace(targetSpaceIdentifier, targetSpaceRecordId)) {
        setReminders((prev) => [reminder, ...prev]);
      }
      setReminderForm((prev) => ({ ...prev, content: "", triggerValue: "" }));
      showToast("success", t("reminderCreated"));
      return true;
    } catch {
      showToast("error", t("failedToCreate"));
      return false;
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
    remindersLoading,
    error: () => memoryError() ?? reminderError(),
    memoryError,
    reminderError,
    fetchMemories,
    fetchReminders,
    deleteMemory,
    deleteReminder,
    createMemory,
    createReminder,
    updateMemory,
    updateReminder,
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
