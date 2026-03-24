import { useI18n } from '../../providers/I18nProvider';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface BulkRenameItem {
  file_id: string;
  old_name: string;
  name: string;
}

interface BulkRenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  bulkRenames: BulkRenameItem[];
  onRenamesChange: React.Dispatch<React.SetStateAction<BulkRenameItem[]>>;
  onRename: () => void;
  renaming: boolean;
}

export function BulkRenameModal({
  isOpen,
  onClose,
  bulkRenames,
  onRenamesChange,
  onRename,
  renaming,
}: BulkRenameModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('rename')}
      size="lg"
    >
      <div className="space-y-4">
        {bulkRenames.length === 0 ? (
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('noFilesYet')}
          </div>
        ) : (
          <div className="space-y-3">
            {bulkRenames.map((r) => (
              <div key={r.file_id} className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
                <div className="text-sm text-zinc-600 dark:text-zinc-300 truncate" title={r.old_name}>
                  {r.old_name}
                </div>
                <Input
                  value={r.name}
                  onChange={(e) => {
                    const next = e.target.value;
                    onRenamesChange((prev) => prev.map((x) => (x.file_id === r.file_id ? { ...x, name: next } : x)));
                  }}
                  placeholder={t('newName')}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={onRename}
            disabled={renaming || bulkRenames.every((r) => !r.name.trim() || r.name.trim() === r.old_name)}
            isLoading={renaming}
          >
            {t('rename')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
