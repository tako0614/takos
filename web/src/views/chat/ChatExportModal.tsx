import { useI18n } from "../../store/i18n.ts";
import { Modal } from "../../components/ui/Modal.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icons } from "../../lib/Icons.tsx";
import type { ThreadExportDownloadFormat } from "takos-api-contract/thread-export";

export interface ChatExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  exportingFormat: ThreadExportDownloadFormat | null;
  onExport: (format: ThreadExportDownloadFormat) => void;
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
          disabled={props.exportingFormat !== null}
          isLoading={props.exportingFormat === "markdown"}
          leftIcon={<Icons.Download class="w-4 h-4" />}
        >
          Markdown
        </Button>
        <Button
          variant="secondary"
          onClick={() => props.onExport("json")}
          disabled={props.exportingFormat !== null}
          isLoading={props.exportingFormat === "json"}
          leftIcon={<Icons.Download class="w-4 h-4" />}
        >
          JSON
        </Button>
        <div
          role={props.exportingFormat ? "status" : undefined}
          class="text-xs text-zinc-500 dark:text-zinc-400"
        >
          {props.exportingFormat
            ? t("threadExportPreparing")
            : t("threadExportDescription")}
        </div>
      </div>
    </Modal>
  );
}
