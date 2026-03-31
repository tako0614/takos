import { createSignal } from 'solid-js';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../store/toast';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  createFolder: (name: string) => Promise<unknown>;
}

export function CreateFolderModal(props: CreateFolderModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [newFolderName, setNewFolderName] = createSignal('');

  const handleClose = () => {
    props.onClose();
    setNewFolderName('');
  };

  const handleCreate = async () => {
    if (!newFolderName().trim()) return;

    const result = await props.createFolder(newFolderName().trim());
    if (result) {
      showToast('success', t('folderCreated').replace('{name}', newFolderName()));
      handleClose();
    } else {
      showToast('error', t('failedToCreateFolder'));
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={handleClose}
      title={t('createNewFolder')}
    >
      <div class="space-y-4">
        <Input
          value={newFolderName()}
          onInput={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
          placeholder={t('folderName')}
          autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newFolderName().trim()) {
              handleCreate();
            }
          }}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!newFolderName().trim()}
          >
            {t('create')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
