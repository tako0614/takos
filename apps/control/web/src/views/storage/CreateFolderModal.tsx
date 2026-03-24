import { useState, useCallback } from 'react';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  createFolder: (name: string) => Promise<unknown>;
}

export function CreateFolderModal({ isOpen, onClose, createFolder }: CreateFolderModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [newFolderName, setNewFolderName] = useState('');

  const handleClose = useCallback(() => {
    onClose();
    setNewFolderName('');
  }, [onClose]);

  const handleCreate = useCallback(async () => {
    if (!newFolderName.trim()) return;

    const result = await createFolder(newFolderName.trim());
    if (result) {
      showToast('success', t('folderCreated').replace('{name}', newFolderName));
      handleClose();
    } else {
      showToast('error', t('failedToCreateFolder'));
    }
  }, [newFolderName, createFolder, showToast, t, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('createNewFolder')}
    >
      <div className="space-y-4">
        <Input
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder={t('folderName')}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFolderName.trim()) {
              handleCreate();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!newFolderName.trim()}
          >
            {t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
