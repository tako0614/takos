import { Show } from 'solid-js';
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

export function FileContentRenderer(props: FileContentRendererProps) {
  const { t } = useI18n();

  return (
    <>
      <Show when={props.isImage}>
        <div class="flex items-center justify-center p-8">
          <img
            src={`data:${props.mimeType};base64,${props.fileContent}`}
            alt={props.fileName}
            class="max-w-full max-h-full object-contain"
          />
        </div>
      </Show>

      <Show when={!props.isImage && props.isPdf}>
        <div class="w-full h-full">
          <iframe
            title={props.fileName}
            src={`data:${props.mimeType};base64,${props.fileContent}`}
            sandbox=""
            class="w-full h-full"
          />
        </div>
      </Show>

      <Show when={!props.isImage && !props.isPdf && props.isAudio}>
        <div class="flex items-center justify-center p-8">
          <audio controls src={`data:${props.mimeType};base64,${props.fileContent}`} />
        </div>
      </Show>

      <Show when={!props.isImage && !props.isPdf && !props.isAudio && props.isVideo}>
        <div class="flex items-center justify-center p-8">
          <video controls class="max-w-full max-h-full" src={`data:${props.mimeType};base64,${props.fileContent}`} />
        </div>
      </Show>

      <Show when={!props.isImage && !props.isPdf && !props.isAudio && !props.isVideo && props.isBinary}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500 dark:text-zinc-400">
          <Icons.File class="w-12 h-12" />
          <p>{t('binaryFileNotDisplayed')}</p>
          <span>{t('sizeLabel', { size: formatFileSize(props.fileSize) })}</span>
        </div>
      </Show>

      <Show when={!props.isImage && !props.isPdf && !props.isAudio && !props.isVideo && !props.isBinary}>
        <CodeViewer
          lines={props.lines}
          language={props.language}
          initialLine={props.initialLine}
          blameEnabled={props.blameEnabled}
          blameError={props.blameError}
          blameData={props.blameData}
        />
      </Show>
    </>
  );
}
