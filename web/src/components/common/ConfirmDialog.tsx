import { createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import {
  useConfirmDialogActions,
  useConfirmDialogState,
} from "../../store/confirm-dialog.ts";
import { Button, Modal, ModalFooter } from "../ui/index.ts";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  confirmationText?: string;
  confirmationLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const iconContainerStyle: JSX.CSSProperties = {
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  width: "2.5rem",
  height: "2.5rem",
  "border-radius": "var(--radius-full)",
  "background-color": "var(--color-surface-secondary)",
  "flex-shrink": 0,
};

const contentStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  "align-items": "center",
  "text-align": "center",
  gap: "1rem",
  padding: "0.5rem 0",
};

const titleStyle: JSX.CSSProperties = {
  "font-size": "1.125rem",
  "font-weight": 600,
  color: "var(--color-text-primary)",
  margin: 0,
};

const messageStyle: JSX.CSSProperties = {
  "font-size": "0.875rem",
  color: "var(--color-text-secondary)",
  margin: 0,
  "line-height": 1.5,
};

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useI18n();
  const [confirmationValue, setConfirmationValue] = createSignal("");

  createEffect(() => {
    if (props.isOpen) setConfirmationValue("");
  });

  const confirmationMatches = () =>
    !props.confirmationText || confirmationValue() === props.confirmationText;

  const iconStyle = (): JSX.CSSProperties => ({
    ...iconContainerStyle,
    color: props.danger ? "var(--color-error)" : "var(--color-text-primary)",
  });

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onCancel}
      size="sm"
      showCloseButton={false}
      closeOnOverlayClick
      closeOnEscape
    >
      <div style={contentStyle}>
        <div style={iconStyle()}>
          <Icons.AlertTriangle
            style={{ width: "1.25rem", height: "1.25rem" }}
          />
        </div>
        <h3 style={titleStyle}>{props.title}</h3>
        <p style={messageStyle}>{props.message}</p>
        {props.confirmationText && (
          <div class="w-full text-left space-y-2">
            <label
              for="confirm-dialog-confirmation"
              class="block text-sm font-medium text-[var(--color-text-primary)]"
            >
              {props.confirmationLabel || t("typeToConfirm")}
            </label>
            <input
              id="confirm-dialog-confirmation"
              name="destructive-confirmation"
              type="text"
              value={confirmationValue()}
              onInput={(event) =>
                setConfirmationValue(event.currentTarget.value)}
              autocomplete="off"
              class="w-full rounded-[var(--radius-md)] border border-[var(--color-border-primary)] bg-[var(--color-surface-primary)] px-3 py-2 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
            />
          </div>
        )}
      </div>
      <ModalFooter
        style={{
          "justify-content": "center",
          gap: "0.75rem",
          "margin-top": "0.5rem",
        }}
      >
        <Button variant="secondary" onClick={props.onCancel}>
          {props.cancelText || t("cancel")}
        </Button>
        <Button
          variant={props.danger ? "danger" : "primary"}
          onClick={props.onConfirm}
          disabled={!confirmationMatches()}
        >
          {props.confirmText || t("confirm")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

/**
 * Global confirm-dialog renderer driven by Solid signals.
 * Mount this once near the app root.
 */
export function ConfirmDialogRenderer() {
  const state = useConfirmDialogState();
  const { handleConfirm, handleCancel } = useConfirmDialogActions();

  onCleanup(handleCancel);

  return (
    <ConfirmDialog
      isOpen={state().isOpen}
      title={state().title}
      message={state().message}
      confirmText={state().confirmText}
      cancelText={state().cancelText}
      danger={state().danger}
      confirmationText={state().confirmationText}
      confirmationLabel={state().confirmationLabel}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
