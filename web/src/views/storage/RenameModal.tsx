import { useI18n } from "../../store/i18n.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import type { StorageFile } from "../../types/index.ts";

interface RenameModalProps {
  isOpen: boolean;
  renameTarget: StorageFile | null;
  newName: string;
  renaming?: boolean;
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
      title={`${t("renameTitle")}: ${props.renameTarget?.name}`}
    >
      <div class="space-y-4">
        <Input
          value={props.newName}
          onInput={(e) =>
            props.onNewNameChange((e.target as HTMLInputElement).value)}
          placeholder={t("newName")}
          autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && !props.renaming &&
              props.newName.trim() && props.newName.trim() !== props.renameTarget?.name) {
              props.onRename();
            }
          }}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={props.onRename}
            disabled={props.renaming || !props.newName.trim() ||
              props.newName.trim() === props.renameTarget?.name}
          >
            {t("rename")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
