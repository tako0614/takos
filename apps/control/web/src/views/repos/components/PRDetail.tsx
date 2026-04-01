import { createSignal, createEffect, on, Show } from 'solid-js';
import { Icons } from '../../../lib/Icons.tsx';
import type { PullRequest, PRReview, PRComment, FileDiff } from '../../../types/index.ts';
import { rpc, rpcJson } from '../../../lib/rpc.ts';
import { useI18n } from '../../../store/i18n.ts';
import { PRHeader } from './PRHeader.tsx';
import { PRComments } from './PRComments.tsx';
import { PRDiffView } from './PRDiffView.tsx';
import { PRActions } from './PRActions.tsx';

type ReviewAction = 'approve' | 'request_changes' | 'comment';
type TabType = 'conversation' | 'files';

interface PRDetailProps {
  repoId: string;
  pr: PullRequest;
  onBack: () => void;
  onUpdate: (pr: PullRequest) => void;
}

export function PRDetail(props: PRDetailProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = createSignal<TabType>('conversation');
  const [reviews, setReviews] = createSignal<PRReview[]>([]);
  const [comments, setComments] = createSignal<PRComment[]>([]);
  const [diffs, setDiffs] = createSignal<FileDiff[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [merging, setMerging] = createSignal(false);
  const [showConflictResolver, setShowConflictResolver] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  const [submittingReview, setSubmittingReview] = createSignal(false);
  const [aiReviewing, setAiReviewing] = createSignal(false);
  const [newComment, setNewComment] = createSignal('');
  const [reviewComment, setReviewComment] = createSignal('');
  const [showReviewForm, setShowReviewForm] = createSignal(false);
  const [expandedFiles, setExpandedFiles] = createSignal<Set<string>>(new Set());

  const fetchPRDetails = async () => {
    try {
      setLoading(true);
      const prNumber = String(props.pr.number);
      const [reviewsRes, commentsRes, diffsRes] = await Promise.all([
        rpc.repos[':repoId'].pulls[':prNumber'].reviews.$get({ param: { repoId: props.repoId, prNumber } }),
        rpc.repos[':repoId'].pulls[':prNumber'].comments.$get({ param: { repoId: props.repoId, prNumber } }),
        rpc.repos[':repoId'].pulls[':prNumber'].diff.$get({ param: { repoId: props.repoId, prNumber } }),
      ]);
      if (reviewsRes.ok) {
        const data = await rpcJson<{ reviews?: PRReview[] }>(reviewsRes);
        setReviews(data.reviews || []);
      }
      if (commentsRes.ok) {
        const data = await rpcJson<{ comments?: PRComment[] }>(commentsRes);
        setComments(data.comments || []);
      }
      if (diffsRes.ok) {
        const data = await rpcJson<{ files?: FileDiff[] }>(diffsRes);
        const files: FileDiff[] = data.files ?? [];
        setDiffs(files);
        setExpandedFiles(new Set<string>(files.slice(0, 3).map((f) => f.path)));
      }
    } catch (_err) {
      // fetch failed
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(() => props.pr.id, () => {
    fetchPRDetails();
  }));

  const handleMerge = async () => {
    if (!props.pr.is_mergeable || merging()) return;
    try {
      setMerging(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].merge.$post({
        param: { repoId: props.repoId, prNumber: String(props.pr.number) }, json: {},
      });
      const data = await rpcJson<{ pull_request?: PullRequest }>(res);
      props.onUpdate(data.pull_request ?? { ...props.pr, status: 'merged', merged_at: new Date().toISOString() });
    } catch (_err) { /* merge failed */ } finally { setMerging(false); }
  };

  const handleAddComment = async () => {
    if (!newComment().trim()) return;
    try {
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].comments.$post({
        param: { repoId: props.repoId, prNumber: String(props.pr.number) }, json: { body: newComment() },
      });
      const data = await rpcJson<{ comment: PRComment }>(res);
      setComments([...comments(), data.comment]);
      setNewComment('');
    } catch (_err) { /* comment failed */ }
  };

  const handleClose = async () => {
    if (closing() || props.pr.status !== 'open') return;
    try {
      setClosing(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].close.$post({
        param: { repoId: props.repoId, prNumber: String(props.pr.number) },
      });
      const data = await rpcJson<{ pull_request?: PullRequest }>(res);
      props.onUpdate(data.pull_request ?? { ...props.pr, status: 'closed', closed_at: new Date().toISOString() });
    } catch (_err) { /* close failed */ } finally { setClosing(false); }
  };

  const handleAiReview = async () => {
    if (aiReviewing() || props.pr.status !== 'open') return;
    try {
      setAiReviewing(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber']['ai-review'].$post({
        param: { repoId: props.repoId, prNumber: String(props.pr.number) },
      });
      await rpcJson(res);
      await fetchPRDetails();
      setActiveTab('conversation');
    } catch (_err) { /* AI review failed */ } finally { setAiReviewing(false); }
  };

  const handleSubmitReview = async (action: ReviewAction) => {
    if (submittingReview()) return;
    try {
      setSubmittingReview(true);
      const status = action === 'approve' ? 'approved' : action === 'request_changes' ? 'changes_requested' : 'commented';
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].reviews.$post({
        param: { repoId: props.repoId, prNumber: String(props.pr.number) },
        json: { status, body: reviewComment() || undefined },
      });
      const data = await rpcJson<{ review: PRReview }>(res);
      setReviews([...reviews(), data.review]);
      setReviewComment('');
      setShowReviewForm(false);
    } catch (_err) { /* review failed */ } finally { setSubmittingReview(false); }
  };

  const toggleFileExpand = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const totalChanges = () => diffs().reduce(
    (acc, file) => ({ additions: acc.additions + file.additions, deletions: acc.deletions + file.deletions }),
    { additions: 0, deletions: 0 },
  );

  return (
    <div class="flex flex-col h-full" style={{ "background-color": 'var(--color-bg-secondary)' }}>
      <PRHeader pr={props.pr} diffsCount={diffs().length} totalAdditions={totalChanges().additions} totalDeletions={totalChanges().deletions} onBack={props.onBack} />

      <div class="flex border-b" style={{ "border-color": 'var(--color-border-primary)', "background-color": 'var(--color-surface-primary)' }}>
        <button type="button"
          class={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab() === 'conversation' ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100' : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'}`}
          onClick={() => setActiveTab('conversation')}
        >
          <Icons.MessageSquare />
          <span>{t('conversationTab')}</span>
          <span class="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs border border-zinc-200 dark:border-zinc-700">{comments().length}</span>
        </button>
        <button type="button"
          class={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab() === 'files' ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100' : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'}`}
          onClick={() => setActiveTab('files')}
        >
          <Icons.File />
          <span>{t('filesChangedTab')}</span>
          <span class="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs border border-zinc-200 dark:border-zinc-700">{diffs().length}</span>
        </button>
      </div>

      <div class="flex-1 overflow-auto p-6">
        <Show when={loading()}>
          <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
            <div class="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
            <span class="mt-3">Loading...</span>
          </div>
        </Show>

        <Show when={!loading() && activeTab() === 'conversation'}>
          <PRComments
            pr={props.pr} reviews={reviews()} comments={comments()}
            newComment={newComment()} onNewCommentChange={setNewComment} onAddComment={handleAddComment}
            showReviewForm={showReviewForm()} onShowReviewForm={setShowReviewForm}
            reviewComment={reviewComment()} onReviewCommentChange={setReviewComment}
            onSubmitReview={handleSubmitReview} submittingReview={submittingReview()}
          />
          <Show when={props.pr.status === 'open'}>
            <div class="mt-4">
              <PRActions
                repoId={props.repoId} pr={props.pr}
                merging={merging()} closing={closing()} aiReviewing={aiReviewing()}
                showConflictResolver={showConflictResolver()} showReviewForm={showReviewForm()}
                onMerge={handleMerge} onClose={handleClose} onAiReview={handleAiReview}
                onShowConflictResolver={setShowConflictResolver} onShowReviewForm={setShowReviewForm}
                onConflictResolved={() => { setShowConflictResolver(false); props.onUpdate({ ...props.pr, status: 'merged' }); }}
              />
            </div>
          </Show>
        </Show>

        <Show when={!loading() && activeTab() === 'files'}>
          <PRDiffView diffs={diffs()} expandedFiles={expandedFiles()} onToggleFile={toggleFileExpand} />
        </Show>
      </div>
    </div>
  );
}
