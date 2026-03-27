import type { PullRequest } from '../../../types';
import { Icons } from '../../../lib/Icons';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { ConflictResolver } from './ConflictResolver';
import { useI18n } from '../../../store/i18n';

interface PRActionsProps {
  repoId: string;
  pr: PullRequest;
  merging: boolean;
  closing: boolean;
  aiReviewing: boolean;
  showConflictResolver: boolean;
  showReviewForm: boolean;
  onMerge: () => void;
  onClose: () => void;
  onAiReview: () => void;
  onShowConflictResolver: (show: boolean) => void;
  onShowReviewForm: (show: boolean) => void;
  onConflictResolved: () => void;
}

export function PRActions({
  repoId,
  pr,
  merging,
  closing,
  aiReviewing,
  showConflictResolver,
  showReviewForm,
  onMerge,
  onClose,
  onAiReview,
  onShowConflictResolver,
  onShowReviewForm,
  onConflictResolved,
}: PRActionsProps) {
  const { t } = useI18n();

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 text-sm mb-3">
        {pr.is_mergeable ? (
          <>
            <Icons.Check className="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
            <span className="text-zinc-700 dark:text-zinc-300">{t('prNoConflicts')}</span>
          </>
        ) : (
          <>
            <Icons.AlertTriangle className="w-4 h-4 text-zinc-500" />
            <span className="text-zinc-600 dark:text-zinc-400">{t('prHasConflicts')}</span>
          </>
        )}
      </div>

      {showConflictResolver && !pr.is_mergeable && (
        <div style={{ marginBottom: '0.75rem' }}>
          <ConflictResolver
            repoId={repoId}
            prNumber={pr.number}
            baseBranch={pr.target_branch}
            headBranch={pr.source_branch}
            onResolved={onConflictResolved}
            onCancel={() => onShowConflictResolver(false)}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={pr.is_mergeable ? onMerge : () => onShowConflictResolver(true)}
          disabled={merging || showConflictResolver}
          isLoading={merging}
          leftIcon={!merging ? <Icons.GitMerge /> : undefined}
        >
          {merging ? t('prMerging') : pr.is_mergeable ? t('prMergePullRequest') : t('resolveConflicts')}
        </Button>
        <Button
          variant="secondary"
          onClick={onAiReview}
          disabled={aiReviewing}
          isLoading={aiReviewing}
          leftIcon={<Icons.Wand className="w-4 h-4" />}
          title={t('aiReviewTitle')}
        >
          {t('aiReview')}
        </Button>
        {!showReviewForm && (
          <Button
            variant="secondary"
            onClick={() => onShowReviewForm(true)}
            leftIcon={<Icons.Eye className="w-4 h-4" />}
          >
            {t('prReview')}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={onClose}
          disabled={closing}
          isLoading={closing}
        >
          {closing ? t('prClosing') : t('prClosePullRequest')}
        </Button>
      </div>
    </Card>
  );
}
