import { useState, useEffect } from 'react';
import { Icons } from '../../../lib/Icons';
import type { PullRequest, PRReview, PRComment, FileDiff } from '../../../types';
import { rpc, rpcJson } from '../../../lib/rpc';
import { useI18n } from '../../../store/i18n';
import { PRHeader } from './PRHeader';
import { PRComments } from './PRComments';
import { PRDiffView } from './PRDiffView';
import { PRActions } from './PRActions';

type ReviewAction = 'approve' | 'request_changes' | 'comment';
type TabType = 'conversation' | 'files';

interface PRDetailProps {
  repoId: string;
  pr: PullRequest;
  onBack: () => void;
  onUpdate: (pr: PullRequest) => void;
}

export function PRDetail({ repoId, pr, onBack, onUpdate }: PRDetailProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabType>('conversation');
  const [reviews, setReviews] = useState<PRReview[]>([]);
  const [comments, setComments] = useState<PRComment[]>([]);
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [showConflictResolver, setShowConflictResolver] = useState(false);
  const [closing, setClosing] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [aiReviewing, setAiReviewing] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchPRDetails();
  }, [pr.id]);

  const fetchPRDetails = async () => {
    try {
      setLoading(true);
      const prNumber = String(pr.number);
      const [reviewsRes, commentsRes, diffsRes] = await Promise.all([
        rpc.repos[':repoId'].pulls[':prNumber'].reviews.$get({ param: { repoId, prNumber } }),
        rpc.repos[':repoId'].pulls[':prNumber'].comments.$get({ param: { repoId, prNumber } }),
        rpc.repos[':repoId'].pulls[':prNumber'].diff.$get({ param: { repoId, prNumber } }),
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

  const handleMerge = async () => {
    if (!pr.is_mergeable || merging) return;
    try {
      setMerging(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].merge.$post({
        param: { repoId, prNumber: String(pr.number) }, json: {},
      });
      const data = await rpcJson<{ pull_request?: PullRequest }>(res);
      onUpdate(data.pull_request ?? { ...pr, status: 'merged', merged_at: new Date().toISOString() });
    } catch (_err) { /* merge failed */ } finally { setMerging(false); }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    try {
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].comments.$post({
        param: { repoId, prNumber: String(pr.number) }, json: { body: newComment },
      });
      const data = await rpcJson<{ comment: PRComment }>(res);
      setComments([...comments, data.comment]);
      setNewComment('');
    } catch (_err) { /* comment failed */ }
  };

  const handleClose = async () => {
    if (closing || pr.status !== 'open') return;
    try {
      setClosing(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].close.$post({
        param: { repoId, prNumber: String(pr.number) },
      });
      const data = await rpcJson<{ pull_request?: PullRequest }>(res);
      onUpdate(data.pull_request ?? { ...pr, status: 'closed', closed_at: new Date().toISOString() });
    } catch (_err) { /* close failed */ } finally { setClosing(false); }
  };

  const handleAiReview = async () => {
    if (aiReviewing || pr.status !== 'open') return;
    try {
      setAiReviewing(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber']['ai-review'].$post({
        param: { repoId, prNumber: String(pr.number) },
      });
      await rpcJson(res);
      await fetchPRDetails();
      setActiveTab('conversation');
    } catch (_err) { /* AI review failed */ } finally { setAiReviewing(false); }
  };

  const handleSubmitReview = async (action: ReviewAction) => {
    if (submittingReview) return;
    try {
      setSubmittingReview(true);
      const status = action === 'approve' ? 'approved' : action === 'request_changes' ? 'changes_requested' : 'commented';
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].reviews.$post({
        param: { repoId, prNumber: String(pr.number) },
        json: { status, body: reviewComment || undefined },
      });
      const data = await rpcJson<{ review: PRReview }>(res);
      setReviews([...reviews, data.review]);
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

  const totalChanges = diffs.reduce(
    (acc, file) => ({ additions: acc.additions + file.additions, deletions: acc.deletions + file.deletions }),
    { additions: 0, deletions: 0 },
  );

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <PRHeader pr={pr} diffsCount={diffs.length} totalAdditions={totalChanges.additions} totalDeletions={totalChanges.deletions} onBack={onBack} />

      <div className="flex border-b" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-surface-primary)' }}>
        <button
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'conversation' ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100' : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'}`}
          onClick={() => setActiveTab('conversation')}
        >
          <Icons.MessageSquare />
          <span>{t('conversationTab')}</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs border border-zinc-200 dark:border-zinc-700">{comments.length}</span>
        </button>
        <button
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === 'files' ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100' : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'}`}
          onClick={() => setActiveTab('files')}
        >
          <Icons.File />
          <span>{t('filesChangedTab')}</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs border border-zinc-200 dark:border-zinc-700">{diffs.length}</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
            <span className="mt-3">Loading...</span>
          </div>
        ) : activeTab === 'conversation' ? (
          <>
            <PRComments
              pr={pr} reviews={reviews} comments={comments}
              newComment={newComment} onNewCommentChange={setNewComment} onAddComment={handleAddComment}
              showReviewForm={showReviewForm} onShowReviewForm={setShowReviewForm}
              reviewComment={reviewComment} onReviewCommentChange={setReviewComment}
              onSubmitReview={handleSubmitReview} submittingReview={submittingReview}
            />
            {pr.status === 'open' && (
              <div className="mt-4">
                <PRActions
                  repoId={repoId} pr={pr}
                  merging={merging} closing={closing} aiReviewing={aiReviewing}
                  showConflictResolver={showConflictResolver} showReviewForm={showReviewForm}
                  onMerge={handleMerge} onClose={handleClose} onAiReview={handleAiReview}
                  onShowConflictResolver={setShowConflictResolver} onShowReviewForm={setShowReviewForm}
                  onConflictResolved={() => { setShowConflictResolver(false); onUpdate({ ...pr, status: 'merged' }); }}
                />
              </div>
            )}
          </>
        ) : (
          <PRDiffView diffs={diffs} expandedFiles={expandedFiles} onToggleFile={toggleFileExpand} />
        )}
      </div>
    </div>
  );
}
