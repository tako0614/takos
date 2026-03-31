import { Show, For } from 'solid-js';
import type { PullRequest, PRReview, PRComment } from '../../../types/index.ts';
import { formatDateTime } from '../../../lib/format.ts';
import { Card } from '../../../components/ui/Card.tsx';
import { Textarea } from '../../../components/ui/Textarea.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Icons } from '../../../lib/Icons.tsx';
import { useI18n } from '../../../store/i18n.ts';

type ReviewAction = 'approve' | 'request_changes' | 'comment';

interface PRCommentsProps {
  pr: PullRequest;
  reviews: PRReview[];
  comments: PRComment[];
  newComment: string;
  onNewCommentChange: (value: string) => void;
  onAddComment: () => void;
  showReviewForm: boolean;
  onShowReviewForm: (show: boolean) => void;
  reviewComment: string;
  onReviewCommentChange: (value: string) => void;
  onSubmitReview: (action: ReviewAction) => void;
  submittingReview: boolean;
}

function renderAvatar(author: { name: string; avatar_url?: string }, size: 'sm' | 'md' = 'md') {
  const sizeClass = size === 'sm' ? 'w-5 h-5' : 'w-10 h-10';
  if (author.avatar_url) {
    return <img src={author.avatar_url} alt={author.name} class={`${sizeClass} rounded-full`} />;
  }
  if (size === 'sm') return null;
  return (
    <div class={`${sizeClass} rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300 font-medium`}>
      {author.name.charAt(0).toUpperCase()}
    </div>
  );
}

function getReviewStatusIcon(status: PRReview['status']) {
  switch (status) {
    case 'approved':
      return <Icons.Check />;
    case 'changes_requested':
      return <Icons.AlertTriangle />;
    default:
      return <Icons.MessageSquare />;
  }
}

function getReviewBadgeClasses(status: PRReview['status']) {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium capitalize';
  switch (status) {
    case 'approved':
      return `${base} bg-zinc-900 text-white`;
    case 'changes_requested':
      return `${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-600`;
    default:
      return `${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400`;
  }
}

export function PRComments(props: PRCommentsProps) {
  const { t } = useI18n();

  return (
    <div class="mx-auto space-y-4">
      <Show when={props.pr.description}>
        <Card padding="md">
          <div class="flex gap-4">
            <div class="flex-shrink-0">
              {renderAvatar(props.pr.author)}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-sm">
                <span class="font-medium text-zinc-900 dark:text-zinc-100">{props.pr.author.name}</span>
                <span class="text-zinc-500">{formatDateTime(props.pr.created_at)}</span>
              </div>
              <div class="mt-2 text-zinc-600 dark:text-zinc-400">
                <p>{props.pr.description}</p>
              </div>
            </div>
          </div>
        </Card>
      </Show>

      <For each={props.reviews}>{(review) => (
        <Card padding="md">
          <div class="flex gap-4">
            <div class="flex-shrink-0">
              {renderAvatar(review.author)}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-sm flex-wrap">
                <span class="font-medium text-zinc-900 dark:text-zinc-100">{review.author.name}</span>
                <span class={getReviewBadgeClasses(review.status)}>
                  {getReviewStatusIcon(review.status)}
                  {review.status.replace('_', ' ')}
                </span>
                <span class="text-zinc-500">{formatDateTime(review.created_at)}</span>
              </div>
              <Show when={review.body}>
                <div class="mt-2 text-zinc-600 dark:text-zinc-400">
                  <p>{review.body}</p>
                </div>
              </Show>
            </div>
          </div>
        </Card>
      )}</For>

      <For each={props.comments}>{(comment) => (
        <Card padding="md">
          <div class="flex gap-4">
            <div class="flex-shrink-0">
              {renderAvatar(comment.author)}
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-sm">
                <span class="font-medium text-zinc-900 dark:text-zinc-100">{comment.author.name}</span>
                <span class="text-zinc-500">{formatDateTime(comment.created_at)}</span>
              </div>
              <div class="mt-2 text-zinc-600">
                <p>{comment.body}</p>
              </div>
            </div>
          </div>
        </Card>
      )}</For>

      <Card padding="md">
        <Textarea
          placeholder={t('leaveAComment')}
          value={props.newComment}
          onInput={(e: Event & { currentTarget: HTMLTextAreaElement }) => props.onNewCommentChange(e.currentTarget.value)}
          rows={3}
          style={{ resize: 'none' }}
        />
        <div class="flex justify-end mt-3">
          <Button
            variant="primary"
            size="sm"
            onClick={props.onAddComment}
            disabled={!props.newComment.trim()}
          >
            {t('comment')}
          </Button>
        </div>
      </Card>

      <Show when={props.pr.status === 'open' && props.showReviewForm}>
        <Card padding="md">
          <h4 class="text-sm font-medium text-zinc-900 mb-3">{t('prSubmitReview')}</h4>
          <Textarea
            placeholder={t('prReviewCommentPlaceholder')}
            value={props.reviewComment}
            onInput={(e: Event & { currentTarget: HTMLTextAreaElement }) => props.onReviewCommentChange(e.currentTarget.value)}
            rows={3}
            style={{ resize: 'none' }}
          />
          <div class="flex items-center gap-2 mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.onSubmitReview('comment')}
              disabled={props.submittingReview}
              leftIcon={<Icons.MessageSquare class="w-4 h-4" />}
            >
              {t('prCommentOnly')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => props.onSubmitReview('request_changes')}
              disabled={props.submittingReview}
              leftIcon={<Icons.AlertTriangle class="w-4 h-4" />}
            >
              {t('prRequestChanges')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => props.onSubmitReview('approve')}
              disabled={props.submittingReview}
              isLoading={props.submittingReview}
              leftIcon={<Icons.Check class="w-4 h-4" />}
            >
              {t('prApprove')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => props.onShowReviewForm(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </Card>
      </Show>
    </div>
  );
}
