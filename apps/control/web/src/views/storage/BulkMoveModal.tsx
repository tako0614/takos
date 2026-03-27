import { useI18n } from '../../store/i18n';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

interface BulkMoveModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  bulkMovePath: string;
  onPathChange: (path: string) => void;
  onMove: () => void;
  moving: boolean;
  normalizePath: (path: string) => string;
}

export function BulkMoveModal({
  isOpen,
  onClose,
  selectedCount,
  bulkMovePath,
  onPathChange,
  onMove,
  moving,
  normalizePath,
}: BulkMoveModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('move') || 'Move'}
    >
      <div className="space-y-4">
        <Input
          value={bulkMovePath}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder="/path/to/folder"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && bulkMovePath.trim()) {
              onMove();
            }
          }}
        />
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          Move {selectedCount} items to <code className="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">{normalizePath(bulkMovePath || '/')}</code>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={onMove}
            disabled={!bulkMovePath.trim() || moving}
            isLoading={moving}
          >
            {t('move') || 'Move'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
