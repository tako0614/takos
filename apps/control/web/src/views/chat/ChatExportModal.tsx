import { useI18n } from '../../store/i18n';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Icons } from '../../lib/Icons';

export interface ChatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: 'markdown' | 'json' | 'pdf') => void;
}

export function ChatExportModal({ isOpen, onClose, onExport }: ChatExportModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('download')}
      size="md"
    >
      <div className="space-y-3">
        <Button variant="secondary" onClick={() => onExport('markdown')} leftIcon={<Icons.Download className="w-4 h-4" />}>
          Markdown
        </Button>
        <Button variant="secondary" onClick={() => onExport('json')} leftIcon={<Icons.Download className="w-4 h-4" />}>
          JSON
        </Button>
        <Button variant="secondary" onClick={() => onExport('pdf')} leftIcon={<Icons.Download className="w-4 h-4" />}>
          PDF
        </Button>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('download')}
        </div>
      </div>
    </Modal>
  );
}
