import { useI18n } from '../../providers/I18nProvider';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import type { StorageFile } from '../../types';

interface RenameModalProps {
  isOpen: boolean;
  renameTarget: StorageFile | null;
  newName: string;
  onNewNameChange: (value: string) => void;
  onClose: () => void;
  onRename: () => void;
}

export function RenameModal({
  isOpen,
  renameTarget,
  newName,
  onNewNameChange,
  onClose,
  onRename,
}: RenameModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('renameTitle')}: ${renameTarget?.name}`}
    >
      <div className="space-y-4">
        <Input
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder={t('newName')}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) {
              onRename();
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={onRename}
            disabled={!newName.trim() || newName === renameTarget?.name}
          >
            {t('rename')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
