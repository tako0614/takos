import { Icons } from '../../../lib/Icons';
import { formatFileSize } from '../../../lib/format';
import { useI18n } from '../../../store/i18n';
import { CodeViewer } from './CodeViewer';
import type { BlameResponse } from './CodeViewer';

interface FileContentRendererProps {
  fileName: string;
  fileContent: string;
  fileSize: number;
  mimeType: string;
  isImage: boolean;
  isPdf: boolean;
  isAudio: boolean;
  isVideo: boolean;
  isBinary: boolean;
  lines: string[];
  language: string;
  initialLine?: number;
  blameEnabled: boolean;
  blameError: string | null;
  blameData: BlameResponse | null;
}

export function FileContentRenderer({
  fileName,
  fileContent,
  fileSize,
  mimeType,
  isImage,
  isPdf,
  isAudio,
  isVideo,
  isBinary,
  lines,
  language,
  initialLine,
  blameEnabled,
  blameError,
  blameData,
}: FileContentRendererProps) {
  const { t } = useI18n();

  if (isImage) {
    return (
      <div className="flex items-center justify-center p-8">
        <img
          src={`data:${mimeType};base64,${fileContent}`}
          alt={fileName}
          className="max-w-full max-h-full object-contain"
        />
      </div>
    );
  }

  if (isPdf) {
    return (
      <div className="w-full h-full">
        <iframe
          title={fileName}
          src={`data:${mimeType};base64,${fileContent}`}
          sandbox=""
          className="w-full h-full"
        />
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="flex items-center justify-center p-8">
        <audio controls src={`data:${mimeType};base64,${fileContent}`} />
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="flex items-center justify-center p-8">
        <video controls className="max-w-full max-h-full" src={`data:${mimeType};base64,${fileContent}`} />
      </div>
    );
  }

  if (isBinary) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
        <Icons.File className="w-12 h-12" />
        <p>{t('binaryFileNotDisplayed')}</p>
        <span>{t('sizeLabel', { size: formatFileSize(fileSize) })}</span>
      </div>
    );
  }

  return (
    <CodeViewer
      lines={lines}
      language={language}
      initialLine={initialLine}
      blameEnabled={blameEnabled}
      blameError={blameError}
      blameData={blameData}
    />
  );
}
