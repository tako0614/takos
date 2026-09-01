import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import type { TranslationKey } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  ModalFooter,
  Select,
  Textarea,
} from "../../components/ui/index.ts";
import type { Reminder } from "../../types/index.ts";
import {
  MAX_REMINDER_CONTENT_CHARACTERS,
  MAX_REMINDER_TRIGGER_VALUE_CHARACTERS,
} from "takos-api-contract/shared/types";

function getTriggerIcon(type: Reminder["trigger_type"]) {
  switch (type) {
    case "time":
      return "⏰";
    case "condition":
      return "🎯";
    case "context":
      return "💬";
  }
}

function getTriggerLabel(
  type: Reminder["trigger_type"],
  t: (key: TranslationKey) => string,
) {
  switch (type) {
    case "time":
      return t("reminderTime");
    case "condition":
      return t("reminderCondition");
    case "context":
      return t("reminderContext");
  }
}

function getStatusLabel(
  status: Reminder["status"],
  t: (key: TranslationKey) => string,
) {
  switch (status) {
    case "pending":
      return t("reminderPending");
    case "triggered":
      return t("reminderTriggered");
    default:
      return t("reminderDismissed");
  }
}

function getPriorityBorderStyle(
  priority: Reminder["priority"],
): JSX.CSSProperties {
  switch (priority) {
    case "critical":
      return { "border-left": "4px solid var(--color-error)" };
    case "high":
      return { "border-left": "4px solid var(--color-warning)" };
    case "normal":
      return { "border-left": "4px solid var(--color-border-primary)" };
    case "low":
      return { "border-left": "4px solid var(--color-border-secondary)" };
  }
}

export function ReminderList(props: {
  reminders: Reminder[];
  onDelete: (id: string) => void;
  onCreateReminder: (data: {
    content: string;
    trigger_type: Reminder["trigger_type"];
    trigger_value: string;
    priority: Reminder["priority"];
  }) => Promise<boolean>;
  onUpdateReminder: (
    id: string,
    data: {
      content: string;
      trigger_value: string;
      priority: Reminder["priority"];
    },
  ) => Promise<boolean>;
  savingReminder: boolean;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const [showCreateReminder, setShowCreateReminder] = createSignal(false);
  const [editingReminderId, setEditingReminderId] = createSignal<string | null>(
    null,
  );

  const [reminderContent, setReminderContent] = createSignal("");
  const [triggerType, setTriggerType] = createSignal<Reminder["trigger_type"]>(
    "time",
  );
  const [triggerValue, setTriggerValue] = createSignal("");
  const [priority, setPriority] = createSignal<Reminder["priority"]>("normal");

  const handleCreateReminder = async (
    e: Event & { currentTarget: HTMLFormElement },
  ) => {
    e.preventDefault();
    if (
      !props.canEdit || !reminderContent().trim() || !triggerValue().trim()
    ) return;
    const currentId = editingReminderId();
    const saved = currentId
      ? await props.onUpdateReminder(currentId, {
        content: reminderContent().trim(),
        trigger_value: triggerValue().trim(),
        priority: priority(),
      })
      : await props.onCreateReminder({
        content: reminderContent().trim(),
        trigger_type: triggerType(),
        trigger_value: triggerValue().trim(),
        priority: priority(),
      });
    if (!saved) return;
    setReminderContent("");
    setTriggerValue("");
    setEditingReminderId(null);
    setShowCreateReminder(false);
  };

  const openCreateReminder = () => {
    if (!props.canEdit) return;
    setEditingReminderId(null);
    setReminderContent("");
    setTriggerType("time");
    setTriggerValue("");
    setPriority("normal");
    setShowCreateReminder(true);
  };

  const openEditReminder = (reminder: Reminder) => {
    if (!props.canEdit) return;
    setEditingReminderId(reminder.id);
    setReminderContent(reminder.content);
    setTriggerType(reminder.trigger_type);
    setTriggerValue(reminder.trigger_value ?? "");
    setPriority(reminder.priority);
    setShowCreateReminder(true);
  };

  return (
    <>
      <div
        style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}
      >
        {props.reminders.length === 0
          ? (
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                "align-items": "center",
                "justify-content": "center",
                padding: "3rem 0",
                color: "var(--color-text-tertiary)",
                gap: "0.75rem",
              }}
            >
              <Icons.Bell />
              <p>{t("noReminders")}</p>
            </div>
          )
          : (
            props.reminders.map((reminder) => (
              <Card
                padding="md"
                style={getPriorityBorderStyle(reminder.priority)}
              >
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    "margin-bottom": "0.5rem",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "0.5rem",
                      "font-size": "0.875rem",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {getTriggerIcon(reminder.trigger_type)}
                    <span>{getTriggerLabel(reminder.trigger_type, t)}</span>
                  </span>
                  <Badge variant="default">
                    {getStatusLabel(reminder.status, t)}
                  </Badge>
                </div>
                <div
                  style={{
                    color: "var(--color-text-primary)",
                    "font-size": "0.875rem",
                    "line-height": "1.6",
                  }}
                >
                  {reminder.content}
                </div>
                <div
                  style={{
                    "font-size": "0.75rem",
                    color: "var(--color-text-tertiary)",
                    "margin-top": "0.5rem",
                    padding: "0.25rem 0.5rem",
                    "background-color": "var(--color-bg-tertiary)",
                    "border-radius": "var(--radius-sm)",
                  }}
                >
                  {reminder.trigger_value}
                </div>
                <div
                  style={{
                    display: "flex",
                    "align-items": "center",
                    "justify-content": "space-between",
                    "margin-top": "0.75rem",
                    "padding-top": "0.75rem",
                    "border-top": "1px solid var(--color-border-primary)",
                  }}
                >
                  <span
                    style={{
                      "font-size": "0.75rem",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {new Date(reminder.created_at).toLocaleDateString()}
                  </span>
                  {props.canEdit && (
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditReminder(reminder)}
                      title={t("editReminder")}
                      aria-label={t("editReminder")}
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      <Icons.Edit />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => props.onDelete(reminder.id)}
                      title={t("delete")}
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      <Icons.Trash />
                    </Button>
                  </div>
                  )}
                </div>
              </Card>
            ))
          )}
      </div>

      {props.canEdit && (
        <Button
          variant="secondary"
          leftIcon={<Icons.Plus />}
          onClick={openCreateReminder}
          style={{
            width: "100%",
            "margin-top": "0.5rem",
            border: "2px dashed var(--color-border-primary)",
          }}
        >
          {t("createReminder")}
        </Button>
      )}

      <Modal
        isOpen={props.canEdit && showCreateReminder()}
        onClose={() => {
          if (!props.savingReminder) setShowCreateReminder(false);
        }}
        title={editingReminderId() ? t("editReminder") : t("createReminder")}
      >
        <form onSubmit={handleCreateReminder}>
          <div
            style={{ display: "flex", "flex-direction": "column", gap: "1rem" }}
          >
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <label
                for="agent-reminder-content"
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("reminderContent")}
              </label>
              <Textarea
                id="agent-reminder-content"
                name="agent-reminder-content"
                placeholder={t("reminderContentPlaceholder")}
                value={reminderContent()}
                onInput={(e) => setReminderContent(e.currentTarget.value)}
                rows={3}
                maxLength={MAX_REMINDER_CONTENT_CHARACTERS}
                autocomplete="off"
                disabled={props.savingReminder}
                required
                autofocus
              />
            </div>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <label
                for="agent-reminder-trigger-type"
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("triggerType")}
              </label>
              <Select
                id="agent-reminder-trigger-type"
                name="agent-reminder-trigger-type"
                aria-label={t("triggerType")}
                disabled={editingReminderId() !== null || props.savingReminder}
                value={triggerType()}
                onChange={(value) =>
                  setTriggerType(value as Reminder["trigger_type"])}
                options={[
                  {
                    value: "time",
                    label: `${getTriggerIcon("time")} ${t("reminderTime")}`,
                  },
                  {
                    value: "condition",
                    label: `${getTriggerIcon("condition")} ${
                      t("reminderCondition")
                    }`,
                  },
                  {
                    value: "context",
                    label: `${getTriggerIcon("context")} ${
                      t("reminderContext")
                    }`,
                  },
                ]}
              />
            </div>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <label
                for="agent-reminder-trigger-value"
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("triggerValue")}
              </label>
              <Input
                id="agent-reminder-trigger-value"
                name="agent-reminder-trigger-value"
                placeholder={triggerType() === "time"
                  ? t("triggerValueTimePlaceholder")
                  : t("triggerValueConditionPlaceholder")}
                value={triggerValue()}
                maxLength={MAX_REMINDER_TRIGGER_VALUE_CHARACTERS}
                autocomplete="off"
                disabled={props.savingReminder}
                onInput={(e) => setTriggerValue(e.currentTarget.value)}
                required
              />
            </div>
            <div
              style={{
                display: "flex",
                "flex-direction": "column",
                gap: "0.5rem",
              }}
            >
              <label
                for="agent-reminder-priority"
                style={{
                  "font-size": "0.875rem",
                  "font-weight": 500,
                  color: "var(--color-text-secondary)",
                }}
              >
                {t("priority")}
              </label>
              <Select
                id="agent-reminder-priority"
                name="agent-reminder-priority"
                aria-label={t("priority")}
                disabled={props.savingReminder}
                value={priority()}
                onChange={(value) => setPriority(value as Reminder["priority"])}
                options={[
                  { value: "low", label: t("priorityLow") },
                  { value: "normal", label: t("priorityNormal") },
                  { value: "high", label: t("priorityHigh") },
                  { value: "critical", label: t("priorityCritical") },
                ]}
              />
            </div>
          </div>
          <ModalFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={props.savingReminder}
              onClick={() => {
                if (!props.savingReminder) setShowCreateReminder(false);
              }}
            >
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              isLoading={props.savingReminder}
              disabled={!reminderContent().trim() || !triggerValue().trim()}
            >
              {editingReminderId() ? t("save") : t("create")}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
}
