import { useState, useEffect } from 'react';
import { Icons } from '../../../lib/Icons';
import type { PullRequest, PRReview, PRComment, FileDiff } from '../../../types';
import { formatDateTime } from '../../../lib/format';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Card } from '../../../components/ui/Card';
import { Textarea } from '../../../components/ui/Textarea';
import { rpc, rpcJson } from '../../../lib/rpc';
import { useI18n } from '../../../providers/I18nProvider';
import { ConflictResolver } from './ConflictResolver';

type ReviewAction = 'approve' | 'request_changes' | 'comment';

interface PRDetailProps {
  repoId: string;
  pr: PullRequest;
  onBack: () => void;
  onUpdate: (pr: PullRequest) => void;
}

type TabType = 'conversation' | 'files';

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
        rpc.repos[':repoId'].pulls[':prNumber'].reviews.$get({
          param: { repoId, prNumber },
        }),
        rpc.repos[':repoId'].pulls[':prNumber'].comments.$get({
          param: { repoId, prNumber },
        }),
        rpc.repos[':repoId'].pulls[':prNumber'].diff.$get({
          param: { repoId, prNumber },
        }),
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
        // Expand first few files by default
        const defaultExpanded = new Set<string>(files.slice(0, 3).map((f) => f.path));
        setExpandedFiles(defaultExpanded);
      }
    } catch (err) {
      console.error('Failed to fetch PR details:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!pr.is_mergeable || merging) return;

    try {
      setMerging(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].merge.$post({
        param: { repoId, prNumber: String(pr.number) },
        json: {},
      });
      const data = await rpcJson<{ pull_request?: PullRequest }>(res);
      if (data.pull_request) {
        onUpdate(data.pull_request);
      } else {
        onUpdate({ ...pr, status: 'merged', merged_at: new Date().toISOString() });
      }
    } catch (err) {
      console.error('Failed to merge PR:', err);
    } finally {
      setMerging(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;

    try {
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].comments.$post({
        param: { repoId, prNumber: String(pr.number) },
        json: { body: newComment },
      });
      const data = await rpcJson<{ comment: PRComment }>(res);
      setComments([...comments, data.comment]);
      setNewComment('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  const handleClose = async () => {
    if (closing || pr.status !== 'open') return;
    try {
      setClosing(true);
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].close.$post({
        param: { repoId, prNumber: String(pr.number) },
      });
      const data = await rpcJson<{ pull_request?: PullRequest }>(res);
      if (data.pull_request) {
        onUpdate(data.pull_request);
      } else {
        onUpdate({ ...pr, status: 'closed', closed_at: new Date().toISOString() });
      }
    } catch (err) {
      console.error('Failed to close PR:', err);
    } finally {
      setClosing(false);
    }
  };

  const handleAiReview = async () => {
    if (aiReviewing || pr.status !== 'open') return;

    try {
      setAiReviewing(true);
      const prNumber = String(pr.number);
      const res = await rpc.repos[':repoId'].pulls[':prNumber']['ai-review'].$post({
        param: { repoId, prNumber },
      });
      await rpcJson(res);
      await fetchPRDetails();
      setActiveTab('conversation');
    } catch (err) {
      console.error('Failed to run AI review:', err);
    } finally {
      setAiReviewing(false);
    }
  };

  const handleSubmitReview = async (action: ReviewAction) => {
    if (submittingReview) return;
    try {
      setSubmittingReview(true);
      const status = action === 'approve' ? 'approved'
        : action === 'request_changes' ? 'changes_requested'
        : 'commented';
      const res = await rpc.repos[':repoId'].pulls[':prNumber'].reviews.$post({
        param: { repoId, prNumber: String(pr.number) },
        json: { status, body: reviewComment || undefined },
      });
      const data = await rpcJson<{ review: PRReview }>(res);
      setReviews([...reviews, data.review]);
      setReviewComment('');
      setShowReviewForm(false);
    } catch (err) {
      console.error('Failed to submit review:', err);
    } finally {
      setSubmittingReview(false);
    }
  };

  const toggleFileExpand = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderAvatar = (author: { name: string; avatar_url?: string }, size: 'sm' | 'md' = 'md') => {
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
  };

  const getStatusIcon = (status: PullRequest['status']) => {
    switch (status) {
      case 'open':
        return <Icons.GitMerge />;
      case 'merged':
        return <Icons.Check />;
      case 'closed':
        return <Icons.X />;
    }
  };

  const getStatusBadgeClasses = (status: PullRequest['status']) => {
    const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize';
    switch (status) {
      case 'open':
        return `${base} bg-zinc-900 text-white`;
      case 'merged':
        return `${base} bg-zinc-700 text-white`;
      case 'closed':
        return `${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-600`;
    }
  };

  const getReviewStatusIcon = (status: PRReview['status']) => {
    switch (status) {
      case 'approved':
        return <Icons.Check />;
      case 'changes_requested':
        return <Icons.AlertTriangle />;
      default:
        return <Icons.MessageSquare />;
    }
  };

  const getFileStatusIcon = (status: FileDiff['status']) => {
    switch (status) {
      case 'added':
        return <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">A</span>;
      case 'modified':
        return <span className="text-xs font-bold text-zinc-600 dark:text-zinc-400">M</span>;
      case 'deleted':
        return <span className="text-xs font-bold text-zinc-400 dark:text-zinc-500">D</span>;
      case 'renamed':
        return <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">R</span>;
    }
  };

  const getReviewBadgeClasses = (status: PRReview['status']) => {
    const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium capitalize';
    switch (status) {
      case 'approved':
        return `${base} bg-zinc-900 text-white`;
      case 'changes_requested':
        return `${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-600`;
      default:
        return `${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400`;
    }
  };

  const totalChanges = diffs.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-surface-primary)' }}>
        <div className="flex items-center gap-4">
          <button
            className="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={onBack}
          >
            <Icons.ArrowLeft />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              <span>{pr.title}</span>
              <span className="ml-2 text-zinc-500 dark:text-zinc-400 font-normal">#{pr.number}</span>
            </h1>
            <div className={getStatusBadgeClasses(pr.status)}>
              {getStatusIcon(pr.status)}
              <span>{pr.status}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b px-6 py-3" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-surface-primary)' }}>
        <div className="flex items-center gap-4 text-sm text-zinc-500 flex-wrap">
          <span className="flex items-center gap-2">
            {renderAvatar(pr.author, 'sm')}
            <span className="text-zinc-900 dark:text-zinc-100">{pr.author.name}</span>
          </span>
          <span>{t('wantsToMerge')}</span>
          <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-mono border border-zinc-200 dark:border-zinc-700">{pr.source_branch}</code>
          <span>{t('intoLabel')}</span>
          <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-mono border border-zinc-200 dark:border-zinc-700">{pr.target_branch}</code>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
          <span>{t('prCommitsCount', { count: pr.commits_count })}</span>
          <span>{t('prFilesChanged', { count: diffs.length })}</span>
          <span className="text-zinc-900 dark:text-zinc-100 font-medium">+{totalChanges.additions}</span>
          <span className="text-zinc-500 dark:text-zinc-400 font-medium">-{totalChanges.deletions}</span>
        </div>
      </div>

      <div className="flex border-b" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-surface-primary)' }}>
        <button
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'conversation'
              ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100'
              : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
          onClick={() => setActiveTab('conversation')}
        >
          <Icons.MessageSquare />
          <span>{t('conversationTab')}</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs border border-zinc-200 dark:border-zinc-700">{comments.length}</span>
        </button>
        <button
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === 'files'
              ? 'text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100'
              : 'text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
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
                onChange={(e) => setNewComment(e.target.value)}
                rows={3}
                style={{ resize: 'none' }}
              />
              <div className="flex justify-end mt-3">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAddComment}
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
                  onChange={(e) => setReviewComment(e.target.value)}
                  rows={3}
                  style={{ resize: 'none' }}
                />
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSubmitReview('comment')}
                    disabled={submittingReview}
                    leftIcon={<Icons.MessageSquare className="w-4 h-4" />}
                  >
                    {t('prCommentOnly')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleSubmitReview('request_changes')}
                    disabled={submittingReview}
                    leftIcon={<Icons.AlertTriangle className="w-4 h-4" />}
                  >
                    {t('prRequestChanges')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleSubmitReview('approve')}
                    disabled={submittingReview}
                    isLoading={submittingReview}
                    leftIcon={<Icons.Check className="w-4 h-4" />}
                  >
                    {t('prApprove')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowReviewForm(false)}
                  >
                    {t('cancel')}
                  </Button>
                </div>
              </Card>
            )}

            {pr.status === 'open' && (
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
                      onResolved={() => {
                        setShowConflictResolver(false);
                        onUpdate({ ...pr, status: 'merged' });
                      }}
                      onCancel={() => setShowConflictResolver(false)}
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={pr.is_mergeable ? handleMerge : () => setShowConflictResolver(true)}
                    disabled={merging || showConflictResolver}
                    isLoading={merging}
                    leftIcon={!merging ? <Icons.GitMerge /> : undefined}
                  >
                    {merging ? t('prMerging') : pr.is_mergeable ? t('prMergePullRequest') : t('resolveConflicts')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleAiReview}
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
                      onClick={() => setShowReviewForm(true)}
                      leftIcon={<Icons.Eye className="w-4 h-4" />}
                    >
                      {t('prReview')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={handleClose}
                    disabled={closing}
                    isLoading={closing}
                  >
                    {closing ? t('prClosing') : t('prClosePullRequest')}
                  </Button>
                </div>
              </Card>
            )}
          </div>
        ) : (
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-4 mb-4 text-sm text-zinc-500">
              <span>{t('prFilesChanged', { count: diffs.length })}</span>
              <span className="text-zinc-900 dark:text-zinc-100 font-medium">{t('additionsLabel', { count: totalChanges.additions })}</span>
              <span className="text-zinc-500 dark:text-zinc-400 font-medium">{t('deletionsLabel', { count: totalChanges.deletions })}</span>
            </div>

            <div className="space-y-2">
              {diffs.map(file => (
                <Card key={file.path} padding="none" className="overflow-hidden">
                  <div
                    className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                    onClick={() => toggleFileExpand(file.path)}
                  >
                    <div className="flex items-center gap-3">
                      {expandedFiles.has(file.path) ? (
                        <Icons.ChevronDown className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                      ) : (
                        <Icons.ChevronRight className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                      )}
                      {getFileStatusIcon(file.status)}
                      <span className="text-sm text-zinc-900 dark:text-zinc-100 font-mono">
                        {file.old_path && file.old_path !== file.path ? (
                          <>
                            <span className="text-zinc-400 dark:text-zinc-500 line-through">{file.old_path}</span>
                            <Icons.ChevronRight className="w-4 h-4 inline mx-1 text-zinc-400 dark:text-zinc-500" />
                          </>
                        ) : null}
                        {file.path}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-zinc-900 dark:text-zinc-100 font-medium">+{file.additions}</span>
                      <span className="text-zinc-500 dark:text-zinc-400 font-medium">-{file.deletions}</span>
                    </div>
                  </div>

                  {expandedFiles.has(file.path) && (
                    <div className="bg-zinc-50 dark:bg-zinc-900 overflow-x-auto border-t" style={{ borderColor: 'var(--color-border-primary)' }}>
                      {file.hunks.map((hunk, hunkIndex) => (
                        <div key={hunkIndex}>
                          <div className="px-4 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs font-mono border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
                            @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                          </div>
                          <div className="font-mono text-xs">
                            {hunk.lines.map((line, lineIndex) => (
                              <div
                                key={lineIndex}
                                className={`flex ${
                                  line.type === 'addition'
                                    ? 'bg-zinc-100 dark:bg-zinc-800'
                                    : line.type === 'deletion'
                                    ? 'bg-zinc-50 dark:bg-zinc-850'
                                    : ''
                                }`}
                              >
                                <span className="w-12 px-2 text-right text-zinc-400 select-none border-r" style={{ borderColor: 'var(--color-border-primary)' }}>
                                  {line.old_line || ''}
                                </span>
                                <span className="w-12 px-2 text-right text-zinc-400 select-none border-r" style={{ borderColor: 'var(--color-border-primary)' }}>
                                  {line.new_line || ''}
                                </span>
                                <span className={`w-4 text-center select-none ${
                                  line.type === 'addition'
                                    ? 'text-zinc-900 dark:text-zinc-100 font-bold'
                                    : line.type === 'deletion'
                                    ? 'text-zinc-400 dark:text-zinc-500 font-bold'
                                    : 'text-zinc-400 dark:text-zinc-500'
                                }`}>
                                  {line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '}
                                </span>
                                <span className={`flex-1 px-2 whitespace-pre ${
                                  line.type === 'addition'
                                    ? 'text-zinc-900 dark:text-zinc-100'
                                    : line.type === 'deletion'
                                    ? 'text-zinc-500 dark:text-zinc-400'
                                    : 'text-zinc-700 dark:text-zinc-300'
                                }`}>{line.content}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
