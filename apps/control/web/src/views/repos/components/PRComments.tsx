import type { PullRequest, PRReview, PRComment } from '../../../types';
import { formatDateTime } from '../../../lib/format';
import { Card } from '../../../components/ui/Card';
import { Textarea } from '../../../components/ui/Textarea';
import { Button } from '../../../components/ui/Button';
import { Icons } from '../../../lib/Icons';
import { useI18n } from '../../../store/i18n';

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
    return <img src={author.avatar_url} alt={author.name} className={`${sizeClass} rounded-full`} />;
  }
  if (size === 'sm') return null;
  return (
    <div className={`${sizeClass} rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-700 dark:text-zinc-300 font-medium`}>
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

export function PRComments({
  pr,
  reviews,
  comments,
  newComment,
  onNewCommentChange,
  onAddComment,
  showReviewForm,
  onShowReviewForm,
  reviewComment,
  onReviewCommentChange,
  onSubmitReview,
  submittingReview,
}: PRCommentsProps) {
  const { t } = useI18n();

  return (
    <div className="mx-auto space-y-4">
      {pr.description && (
        <Card padding="md">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              {renderAvatar(pr.author)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{pr.author.name}</span>
                <span className="text-zinc-500">{formatDateTime(pr.created_at)}</span>
              </div>
              <div className="mt-2 text-zinc-600 dark:text-zinc-400">
                <p>{pr.description}</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {reviews.map(review => (
        <Card key={review.id} padding="md">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              {renderAvatar(review.author)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{review.author.name}</span>
                <span className={getReviewBadgeClasses(review.status)}>
                  {getReviewStatusIcon(review.status)}
                  {review.status.replace('_', ' ')}
                </span>
                <span className="text-zinc-500">{formatDateTime(review.created_at)}</span>
              </div>
              {review.body && (
                <div className="mt-2 text-zinc-600 dark:text-zinc-400">
                  <p>{review.body}</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}

      {comments.map(comment => (
        <Card key={comment.id} padding="md">
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              {renderAvatar(comment.author)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{comment.author.name}</span>
                <span className="text-zinc-500">{formatDateTime(comment.created_at)}</span>
              </div>
              <div className="mt-2 text-zinc-600">
                <p>{comment.body}</p>
              </div>
            </div>
          </div>
        </Card>
      ))}

      <Card padding="md">
        <Textarea
          placeholder={t('leaveAComment')}
          value={newComment}
          onChange={(e) => onNewCommentChange(e.target.value)}
          rows={3}
          style={{ resize: 'none' }}
        />
        <div className="flex justify-end mt-3">
          <Button
            variant="primary"
            size="sm"
            onClick={onAddComment}
            disabled={!newComment.trim()}
          >
            {t('comment')}
          </Button>
        </div>
      </Card>

      {pr.status === 'open' && showReviewForm && (
        <Card padding="md">
          <h4 className="text-sm font-medium text-zinc-900 mb-3">{t('prSubmitReview')}</h4>
          <Textarea
            placeholder={t('prReviewCommentPlaceholder')}
            value={reviewComment}
            onChange={(e) => onReviewCommentChange(e.target.value)}
            rows={3}
            style={{ resize: 'none' }}
          />
          <div className="flex items-center gap-2 mt-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSubmitReview('comment')}
              disabled={submittingReview}
              leftIcon={<Icons.MessageSquare className="w-4 h-4" />}
            >
              {t('prCommentOnly')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSubmitReview('request_changes')}
              disabled={submittingReview}
              leftIcon={<Icons.AlertTriangle className="w-4 h-4" />}
            >
              {t('prRequestChanges')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSubmitReview('approve')}
              disabled={submittingReview}
              isLoading={submittingReview}
              leftIcon={<Icons.Check className="w-4 h-4" />}
            >
              {t('prApprove')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onShowReviewForm(false)}
            >
              {t('cancel')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
