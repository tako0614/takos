import { useI18n } from "../../store/i18n.ts";
import { Modal } from "../../components/ui/Modal.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Button } from "../../components/ui/Button.tsx";

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

export function BulkMoveModal(props: BulkMoveModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t("move") || "Move"}
    >
      <div class="space-y-4">
        <Input
          value={props.bulkMovePath}
          onInput={(e) =>
            props.onPathChange((e.target as HTMLInputElement).value)}
          placeholder="/path/to/folder"
          autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && props.bulkMovePath.trim()) {
              props.onMove();
            }
          }}
        />
        <div class="text-xs text-zinc-500 dark:text-zinc-400">
          Move {props.selectedCount} items to{" "}
          <code class="px-1 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
            {props.normalizePath(props.bulkMovePath || "/")}
          </code>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={props.onMove}
            disabled={!props.bulkMovePath.trim() || props.moving}
            isLoading={props.moving}
          >
            {t("move") || "Move"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
