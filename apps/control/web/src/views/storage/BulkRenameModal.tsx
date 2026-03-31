import { For, Show } from 'solid-js';
import type { Setter } from 'solid-js';
import { useI18n } from '../../store/i18n';
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
  onRenamesChange: Setter<BulkRenameItem[]>;
  onRename: () => void;
  renaming: boolean;
}

export function BulkRenameModal(props: BulkRenameModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t('rename')}
      size="lg"
    >
      <div class="space-y-4">
        <Show when={props.bulkRenames.length > 0} fallback={
          <div class="text-sm text-zinc-500 dark:text-zinc-400">
            {t('noFilesYet')}
          </div>
        }>
          <div class="space-y-3">
            <For each={props.bulkRenames}>{(r) => (
              <div class="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
                <div class="text-sm text-zinc-600 dark:text-zinc-300 truncate" title={r.old_name}>
                  {r.old_name}
                </div>
                <Input
                  value={r.name}
                  onInput={(e) => {
                    const next = (e.target as HTMLInputElement).value;
                    props.onRenamesChange((prev) => prev.map((x) => (x.file_id === r.file_id ? { ...x, name: next } : x)));
                  }}
                  placeholder={t('newName')}
                />
              </div>
            )}</For>
          </div>
        </Show>

        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={props.onRename}
            disabled={props.renaming || props.bulkRenames.every((r) => !r.name.trim() || r.name.trim() === r.old_name)}
            isLoading={props.renaming}
          >
            {t('rename')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
