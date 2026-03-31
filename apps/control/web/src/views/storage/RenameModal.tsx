import { useI18n } from '../../store/i18n';
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

export function RenameModal(props: RenameModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={`${t('renameTitle')}: ${props.renameTarget?.name}`}
    >
      <div class="space-y-4">
        <Input
          value={props.newName}
          onInput={(e) => props.onNewNameChange((e.target as HTMLInputElement).value)}
          placeholder={t('newName')}
          autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && props.newName.trim()) {
              props.onRename();
            }
          }}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={props.onRename}
            disabled={!props.newName.trim() || props.newName === props.renameTarget?.name}
          >
            {t('rename')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
