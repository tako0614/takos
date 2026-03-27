import { formatFileSize } from '../../lib/format';
import { Icons } from '../../lib/Icons';
import { Button } from '../../components/ui/Button';
import type { StorageFile } from '../../types';

export function StorageEmptyState({
  file,
  downloadUrl,
  t,
  label,
}: {
  file: StorageFile;
  downloadUrl: string | null;
  t: (key: string) => string;
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400 gap-4">
      <Icons.File className="w-16 h-16 opacity-50" />
      <p className="text-lg font-medium">{label || file.name}</p>
      <p className="text-sm">{formatFileSize(file.size)} &middot; {file.mime_type || t('unknownType')}</p>
      {downloadUrl && (
        <Button
          variant="primary"
          onClick={() => window.open(downloadUrl, '_blank', 'noopener,noreferrer')}
          leftIcon={<Icons.Download className="w-4 h-4" />}
        >
          {t('download')}
        </Button>
      )}
    </div>
  );
}
