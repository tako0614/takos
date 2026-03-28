import { memo, useMemo, useState } from 'react';
import type { Message, ToolExecution } from '../../types';
import { Icons } from '../../lib/Icons';
import { MarkdownRenderer } from './MarkdownRenderer';
import { PersistedToolCalls } from './Tooling';
import { useI18n } from '../../store/i18n';
import { parseChatMessageMetadata } from './messageMetadata';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

interface MessageBubbleProps {
  message: Message;
  showToolExecutions?: boolean;
  spaceId?: string;
}

function AttachmentImage({
  attachment,
  spaceId,
}: {
  attachment: { file_id?: string; path?: string; name: string; mime_type?: string | null; size?: number };
  spaceId: string;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);

  if (failed || !attachment.file_id) {
    return <AttachmentChip attachment={attachment} />;
  }

  const src = `/api/spaces/${spaceId}/storage/download/${attachment.file_id}`;

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={src}
        alt={attachment.name}
        className="max-w-xs max-h-64 rounded-xl object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
        title={t('imagePreview')}
      />
    </a>
  );
}

function AttachmentChip({
  attachment,
}: {
  attachment: { file_id?: string; path?: string; name: string; mime_type?: string | null; size?: number };
}) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
      <Icons.Paperclip className="h-4 w-4 flex-shrink-0" />
      <div className="min-w-0">
        <div className="truncate font-medium">{attachment.name}</div>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
          {attachment.path || attachment.file_id || attachment.mime_type || ''}
        </div>
      </div>
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  showToolExecutions = true,
  spaceId,
}: MessageBubbleProps) {
  const { t } = useI18n();
  const { copied, copyFailed, copy } = useCopyToClipboard();

  if (message.role === 'tool') return null;
  if (message.role === 'assistant' && !message.content && message.tool_calls) return null;

  const isUser = message.role === 'user';

  const { attachments, toolExecutions } = useMemo<{
    attachments: Array<{ file_id?: string; path?: string; name: string; mime_type?: string | null; size?: number }>;
    toolExecutions: ToolExecution[];
  }>(() => {
    const parsed = parseChatMessageMetadata(message.metadata);
    return {
      attachments: parsed.attachments,
      toolExecutions: isUser ? [] : parsed.toolExecutions,
    };
  }, [isUser, message.metadata]);

  const isImage = (att: { mime_type?: string | null }) =>
    att.mime_type?.startsWith('image/');

  if (isUser) {
    return (
      <div id={`message-${message.id}`} className="py-3 px-4">
        <div className="flex justify-end">
          <div className="bg-zinc-200 dark:bg-zinc-700 rounded-2xl px-4 py-2 max-w-[80%]">
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((attachment, index) =>
                  isImage(attachment) && spaceId && attachment.file_id ? (
                    <AttachmentImage
                      key={`${attachment.file_id || attachment.path || attachment.name}-${index}`}
                      attachment={attachment}
                      spaceId={spaceId}
                    />
                  ) : (
                    <AttachmentChip
                      key={`${attachment.file_id || attachment.path || attachment.name}-${index}`}
                      attachment={attachment}
                    />
                  )
                )}
              </div>
            )}
            {message.content && (
              <div className="text-zinc-900 dark:text-zinc-100 whitespace-pre-wrap">
                {message.content}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id={`message-${message.id}`} className="py-3 px-4">
      {showToolExecutions && toolExecutions.length > 0 && (
        <PersistedToolCalls toolExecutions={toolExecutions} />
      )}

      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((attachment, index) =>
            isImage(attachment) && spaceId && attachment.file_id ? (
              <AttachmentImage
                key={`${attachment.file_id || attachment.path || attachment.name}-${index}`}
                attachment={attachment}
                spaceId={spaceId}
              />
            ) : (
              <div
                key={`${attachment.file_id || attachment.path || attachment.name}-${index}`}
                className="inline-flex max-w-full items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <Icons.Paperclip className="h-4 w-4 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{attachment.name}</div>
                  <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {attachment.path || attachment.file_id || attachment.mime_type || ''}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {message.content && (
        <div className="prose dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100">
          <MarkdownRenderer content={message.content} />
        </div>
      )}

      {message.content && (
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            className="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center justify-center gap-1"
            onClick={() => copy(message.content)}
            aria-label={copyFailed ? t('copyFailed') : copied ? t('copied') : t('copy')}
          >
            {copyFailed ? (
              <span className="text-xs text-red-600 dark:text-red-400">{t('copyFailed')}</span>
            ) : copied ? (
              <>
                <Icons.Check className="w-4 h-4 text-zinc-700 dark:text-zinc-300" />
                <span className="text-xs text-zinc-700 dark:text-zinc-300">{t('copied')}</span>
              </>
            ) : (
              <Icons.Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      )}
    </div>
  );
});
