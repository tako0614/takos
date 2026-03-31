import { Show } from 'solid-js';
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

export function PRActions(props: PRActionsProps) {
  const { t } = useI18n();

  return (
    <Card padding="md">
      <div class="flex items-center gap-2 text-sm mb-3">
        <Show when={props.pr.is_mergeable} fallback={
          <>
            <Icons.AlertTriangle class="w-4 h-4 text-zinc-500" />
            <span class="text-zinc-600 dark:text-zinc-400">{t('prHasConflicts')}</span>
          </>
        }>
          <Icons.Check class="w-4 h-4 text-zinc-900 dark:text-zinc-100" />
          <span class="text-zinc-700 dark:text-zinc-300">{t('prNoConflicts')}</span>
        </Show>
      </div>

      <Show when={props.showConflictResolver && !props.pr.is_mergeable}>
        <div style={{ "margin-bottom": '0.75rem' }}>
          <ConflictResolver
            repoId={props.repoId}
            prNumber={props.pr.number}
            baseBranch={props.pr.target_branch}
            headBranch={props.pr.source_branch}
            onResolved={props.onConflictResolved}
            onCancel={() => props.onShowConflictResolver(false)}
          />
        </div>
      </Show>

      <div class="flex items-center gap-2">
        <Button
          variant="primary"
          class="flex-1"
          onClick={props.pr.is_mergeable ? props.onMerge : () => props.onShowConflictResolver(true)}
          disabled={props.merging || props.showConflictResolver}
          isLoading={props.merging}
          leftIcon={!props.merging ? <Icons.GitMerge /> : undefined}
        >
          {props.merging ? t('prMerging') : props.pr.is_mergeable ? t('prMergePullRequest') : t('resolveConflicts')}
        </Button>
        <Button
          variant="secondary"
          onClick={props.onAiReview}
          disabled={props.aiReviewing}
          isLoading={props.aiReviewing}
          leftIcon={<Icons.Wand class="w-4 h-4" />}
          title={t('aiReviewTitle')}
        >
          {t('aiReview')}
        </Button>
        <Show when={!props.showReviewForm}>
          <Button
            variant="secondary"
            onClick={() => props.onShowReviewForm(true)}
            leftIcon={<Icons.Eye class="w-4 h-4" />}
          >
            {t('prReview')}
          </Button>
        </Show>
        <Button
          variant="ghost"
          onClick={props.onClose}
          disabled={props.closing}
          isLoading={props.closing}
        >
          {props.closing ? t('prClosing') : t('prClosePullRequest')}
        </Button>
      </div>
    </Card>
  );
}
