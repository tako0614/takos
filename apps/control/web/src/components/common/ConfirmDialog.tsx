import { useState, useCallback, useMemo, type CSSProperties } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { Modal, ModalFooter, Button } from '../ui';

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

const iconContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.5rem',
  height: '2.5rem',
  borderRadius: 'var(--radius-full)',
  backgroundColor: 'var(--color-surface-secondary)',
  flexShrink: 0,
};

const contentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  gap: '1rem',
  padding: '0.5rem 0',
};

const titleStyle: CSSProperties = {
  fontSize: '1.125rem',
  fontWeight: 600,
  color: 'var(--color-text-primary)',
  margin: 0,
};

const messageStyle: CSSProperties = {
  fontSize: '0.875rem',
  color: 'var(--color-text-secondary)',
  margin: 0,
  lineHeight: 1.5,
};

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();

  const iconStyle: CSSProperties = {
    ...iconContainerStyle,
    color: danger ? 'var(--color-error)' : 'var(--color-text-primary)',
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      size="sm"
      showCloseButton={false}
      closeOnOverlayClick={true}
      closeOnEscape={true}
    >
      <div style={contentStyle}>
        <div style={iconStyle}>
          <Icons.AlertTriangle style={{ width: '1.25rem', height: '1.25rem' }} />
        </div>
        <h3 style={titleStyle}>{title}</h3>
        <p style={messageStyle}>{message}</p>
      </div>
      <ModalFooter style={{ justifyContent: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
        <Button variant="secondary" onClick={onCancel}>
          {cancelText || t('cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmText || t('confirm')}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export function useConfirmDialog() {
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const confirm = useCallback((options: {
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
  }): Promise<boolean> => {
    return new Promise(resolve => {
      setDialogState({
        isOpen: true,
        ...options,
        onConfirm: () => {
          setDialogState(prev => ({ ...prev, isOpen: false }));
          resolve(true);
        },
      });
    });
  }, []);

  const cancel = useCallback(() => {
    setDialogState(prev => ({ ...prev, isOpen: false }));
  }, []);

  const DialogComponent = useMemo(() => (
    <ConfirmDialog
      isOpen={dialogState.isOpen}
      title={dialogState.title}
      message={dialogState.message}
      confirmText={dialogState.confirmText}
      cancelText={dialogState.cancelText}
      danger={dialogState.danger}
      onConfirm={dialogState.onConfirm}
      onCancel={cancel}
    />
  ), [dialogState, cancel]);

  return { confirm, DialogComponent };
}
