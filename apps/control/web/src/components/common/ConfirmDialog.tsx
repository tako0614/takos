import type { JSX } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import { useConfirmDialogState, useConfirmDialogActions } from '../../store/confirm-dialog.ts';
import { Modal, ModalFooter, Button } from '../ui/index.ts';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const iconContainerStyle: JSX.CSSProperties = {
  display: 'flex',
  'align-items': 'center',
  'justify-content': 'center',
  width: '2.5rem',
  height: '2.5rem',
  'border-radius': 'var(--radius-full)',
  'background-color': 'var(--color-surface-secondary)',
  'flex-shrink': 0,
};

const contentStyle: JSX.CSSProperties = {
  display: 'flex',
  'flex-direction': 'column',
  'align-items': 'center',
  'text-align': 'center',
  gap: '1rem',
  padding: '0.5rem 0',
};

const titleStyle: JSX.CSSProperties = {
  'font-size': '1.125rem',
  'font-weight': 600,
  color: 'var(--color-text-primary)',
  margin: 0,
};

const messageStyle: JSX.CSSProperties = {
  'font-size': '0.875rem',
  color: 'var(--color-text-secondary)',
  margin: 0,
  'line-height': 1.5,
};

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useI18n();

  const iconStyle = (): JSX.CSSProperties => ({
    ...iconContainerStyle,
    color: props.danger ? 'var(--color-error)' : 'var(--color-text-primary)',
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
          <Icons.AlertTriangle style={{ width: '1.25rem', height: '1.25rem' }} />
        </div>
        <h3 style={titleStyle}>{props.title}</h3>
        <p style={messageStyle}>{props.message}</p>
      </div>
      <ModalFooter style={{ 'justify-content': 'center', gap: '0.75rem', 'margin-top': '0.5rem' }}>
        <Button variant="secondary" onClick={props.onCancel}>
          {props.cancelText || t('cancel')}
        </Button>
        <Button variant={props.danger ? 'danger' : 'primary'} onClick={props.onConfirm}>
          {props.confirmText || t('confirm')}
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

  return (
    <ConfirmDialog
      isOpen={state().isOpen}
      title={state().title}
      message={state().message}
      confirmText={state().confirmText}
      cancelText={state().cancelText}
      danger={state().danger}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );
}
