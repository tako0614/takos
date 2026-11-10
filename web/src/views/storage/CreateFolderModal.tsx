import { createEffect, createSignal, onCleanup } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { Modal } from "../../components/ui/Modal.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Button } from "../../components/ui/Button.tsx";
import type { StorageFile } from "../../types/index.ts";

export interface CreateFolderSession {
  scope: symbol;
}

interface CreateFolderModalProps {
  session: CreateFolderSession | undefined;
  getScope: () => symbol | undefined;
  onClose: () => void;
  createFolder: (name: string, isCurrentOperation?: () => boolean) => Promise<StorageFile | null>;
}

export function CreateFolderModal(props: CreateFolderModalProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [newFolderName, setNewFolderName] = createSignal("");
  const [pendingScopes, setPendingScopes] = createSignal(new Set<symbol>());
  let disposed = false;
  onCleanup(() => { disposed = true; });
  const isCurrent = (session: CreateFolderSession | undefined) =>
    !disposed && session !== undefined && props.session === session && props.getScope() === session.scope;
  const creating = () => isCurrent(props.session) && pendingScopes().has(props.session!.scope);
  createEffect(() => { if (props.session) setNewFolderName(""); });

  const handleClose = () => {
    props.onClose();
    setNewFolderName("");
  };

  const handleCreate = async () => {
    const session = props.session, draft = newFolderName(), name = draft.trim();
    if (!session || !isCurrent(session) || !name || pendingScopes().has(session.scope)) return;
    setPendingScopes(previous => new Set(previous).add(session.scope));
    try {
      const result = await props.createFolder(name, () => isCurrent(session));
      if (!isCurrent(session)) return;
      if (result) {
        showToast("success", t("folderCreated").replace("{name}", result.name));
        if (newFolderName() === draft) handleClose();
      } else {
        showToast("error", t("failedToCreateFolder"));
      }
    } finally {
      setPendingScopes(previous => { const next = new Set(previous);next.delete(session.scope);return next; });
    }
  };

  return (
    <Modal
      isOpen={isCurrent(props.session)}
      onClose={handleClose}
      title={t("createNewFolder")}
    >
      <div class="space-y-4">
        <Input
          value={newFolderName()}
          onInput={(e) =>
            setNewFolderName((e.target as HTMLInputElement).value)}
          placeholder={t("folderName")}
          autofocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229 && newFolderName().trim() && !creating()) {
              handleCreate();
            }
          }}
        />
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={!newFolderName().trim() || creating()}
          >
            {t("create")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
