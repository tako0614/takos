import { useI18n } from "../../store/i18n.ts";
import { Modal } from "../../components/ui/Modal.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icons } from "../../lib/Icons.tsx";

export interface ChatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: "markdown" | "json" | "pdf") => void;
}

export function ChatExportModal(props: ChatExportModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t("download")}
      size="md"
    >
      <div class="space-y-3">
        <Button
          variant="secondary"
          onClick={() => props.onExport("markdown")}
          leftIcon={<Icons.Download class="w-4 h-4" />}
        >
          Markdown
        </Button>
        <Button
          variant="secondary"
          onClick={() => props.onExport("json")}
          leftIcon={<Icons.Download class="w-4 h-4" />}
        >
          JSON
        </Button>
        <Button
          variant="secondary"
          onClick={() => props.onExport("pdf")}
          leftIcon={<Icons.Download class="w-4 h-4" />}
        >
          PDF
        </Button>
        <div class="text-xs text-zinc-500 dark:text-zinc-400">
          {t("download")}
        </div>
      </div>
    </Modal>
  );
}
