import { createEffect, createSignal, createUniqueId, on, Show } from "solid-js";
import { Icons } from "../../../lib/Icons.tsx";
import { moveTabFocus } from "../../../lib/a11y.ts";
import type {
  FileDiff,
  PRComment,
  PRReview,
  PullRequest,
} from "../../../types/index.ts";
import {
  repoClosePullRequest,
  repoCreatePullRequestComment,
  repoCreatePullRequestReview,
  repoMergePullRequest,
  repoPullRequestComments,
  repoPullRequestDiff,
  repoPullRequestReviews,
  repoRunPullRequestAiReview,
} from "../../../lib/rpc.ts";
import { useI18n } from "../../../store/i18n.ts";
import { useToast } from "../../../store/toast.ts";
import { PRHeader } from "./PRHeader.tsx";
import { PRComments } from "./PRComments.tsx";
import { PRDiffView } from "./PRDiffView.tsx";
import { PRActions } from "./PRActions.tsx";

type ReviewAction = "approve" | "request_changes" | "comment";
type TabType = "conversation" | "files";

interface PRDetailProps {
  repoId: string;
  pr: PullRequest;
  onBack: () => void;
  onUpdate: (pr: PullRequest) => void;
}

export function PRDetail(props: PRDetailProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = createSignal<TabType>("conversation");
  const tablistId = createUniqueId();
  const tabButtonId = (id: TabType) => `${tablistId}-tab-${id}`;
  const tabPanelId = `${tablistId}-panel`;
  const handleTabKeyDown = (e: KeyboardEvent) => {
    const nextId = moveTabFocus(e);
    if (nextId === "conversation" || nextId === "files") setActiveTab(nextId);
  };
  const [reviews, setReviews] = createSignal<PRReview[]>([]);
  const [comments, setComments] = createSignal<PRComment[]>([]);
  const [diffs, setDiffs] = createSignal<FileDiff[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [merging, setMerging] = createSignal(false);
  const [showConflictResolver, setShowConflictResolver] = createSignal(false);
  const [closing, setClosing] = createSignal(false);
  const [submittingReview, setSubmittingReview] = createSignal(false);
  const [aiReviewing, setAiReviewing] = createSignal(false);
  const [newComment, setNewComment] = createSignal("");
  const [reviewComment, setReviewComment] = createSignal("");
  const [showReviewForm, setShowReviewForm] = createSignal(false);
  const [expandedFiles, setExpandedFiles] = createSignal<Set<string>>(
    new Set(),
  );

  const fetchPRDetails = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const prNumber = String(props.pr.number);
      const [reviewsData, commentsData, diffsData] = await Promise.all([
        repoPullRequestReviews(props.repoId, prNumber),
        repoPullRequestComments(props.repoId, prNumber),
        repoPullRequestDiff(props.repoId, prNumber),
      ]);
      setReviews(reviewsData.reviews);
      setComments(commentsData.comments);
      const files: FileDiff[] = diffsData.files;
      setDiffs(files);
      setExpandedFiles(new Set<string>(files.slice(0, 3).map((f) => f.path)));
    } catch (err) {
      // Primary data load for the PR detail view (reviews / comments / diff).
      // Surface the failure so the user understands why the panel is empty
      // and can retry by re-selecting the PR.
      setLoadError(err instanceof Error ? err.message : t("failedToLoad"));
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
      const data = await repoMergePullRequest(props.repoId, props.pr.number);
      props.onUpdate(
        data.pull_request ??
          {
            ...props.pr,
            status: "merged",
            merged_at: new Date().toISOString(),
          },
      );
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message ? err.message : t("failedToMerge"),
      );
    } finally {
      setMerging(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment().trim()) return;
    try {
      const data = await repoCreatePullRequestComment(
        props.repoId,
        props.pr.number,
        { body: newComment() },
      );
      setComments([...comments(), data.comment]);
      setNewComment("");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message ? err.message : t("failedToComment"),
      );
    }
  };

  const handleClose = async () => {
    if (closing() || props.pr.status !== "open") return;
    try {
      setClosing(true);
      const data = await repoClosePullRequest(props.repoId, props.pr.number);
      props.onUpdate(
        data.pull_request ??
          {
            ...props.pr,
            status: "closed",
            closed_at: new Date().toISOString(),
          },
      );
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message ? err.message : t("failedToClosePr"),
      );
    } finally {
      setClosing(false);
    }
  };

  const handleAiReview = async () => {
    if (aiReviewing() || props.pr.status !== "open") return;
    try {
      setAiReviewing(true);
      await repoRunPullRequestAiReview(props.repoId, props.pr.number);
      await fetchPRDetails();
      setActiveTab("conversation");
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message
          ? err.message
          : t("failedToRunAiReview"),
      );
    } finally {
      setAiReviewing(false);
    }
  };

  const handleSubmitReview = async (action: ReviewAction) => {
    if (submittingReview()) return;
    try {
      setSubmittingReview(true);
      const status = action === "approve"
        ? "approved"
        : action === "request_changes"
        ? "changes_requested"
        : "commented";
      const data = await repoCreatePullRequestReview(
        props.repoId,
        props.pr.number,
        { status, body: reviewComment() || undefined },
      );
      setReviews([...reviews(), data.review]);
      setReviewComment("");
      setShowReviewForm(false);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error && err.message
          ? err.message
          : t("failedToSubmitReview"),
      );
    } finally {
      setSubmittingReview(false);
    }
  };

  const toggleFileExpand = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const totalChanges = () =>
    diffs().reduce(
      (acc, file) => ({
        additions: acc.additions + file.additions,
        deletions: acc.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 },
    );

  return (
    <div
      class="flex flex-col h-full"
      style={{ "background-color": "var(--color-bg-secondary)" }}
    >
      <PRHeader
        pr={props.pr}
        diffsCount={diffs().length}
        totalAdditions={totalChanges().additions}
        totalDeletions={totalChanges().deletions}
        onBack={props.onBack}
      />

      <div
        role="tablist"
        aria-label={t("tabSectionsLabel")}
        class="flex border-b"
        style={{
          "border-color": "var(--color-border-primary)",
          "background-color": "var(--color-surface-primary)",
        }}
      >
        <button
          type="button"
          role="tab"
          id={tabButtonId("conversation")}
          data-tab-id="conversation"
          aria-selected={activeTab() === "conversation"}
          aria-controls={tabPanelId}
          tabindex={activeTab() === "conversation" ? 0 : -1}
          class={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab() === "conversation"
              ? "text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100"
              : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
          onClick={() => setActiveTab("conversation")}
          onKeyDown={handleTabKeyDown}
        >
          <Icons.MessageSquare />
          <span>{t("conversationTab")}</span>
          <span class="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs border border-zinc-200 dark:border-zinc-700">
            {comments().length}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          id={tabButtonId("files")}
          data-tab-id="files"
          aria-selected={activeTab() === "files"}
          aria-controls={tabPanelId}
          tabindex={activeTab() === "files" ? 0 : -1}
          class={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab() === "files"
              ? "text-zinc-900 dark:text-zinc-100 border-zinc-900 dark:border-zinc-100"
              : "text-zinc-500 dark:text-zinc-400 border-transparent hover:text-zinc-900 dark:hover:text-zinc-100"
          }`}
          onClick={() => setActiveTab("files")}
          onKeyDown={handleTabKeyDown}
        >
          <Icons.File />
          <span>{t("filesChangedTab")}</span>
          <span class="ml-1 px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-xs border border-zinc-200 dark:border-zinc-700">
            {diffs().length}
          </span>
        </button>
      </div>

      <div
        role="tabpanel"
        id={tabPanelId}
        aria-labelledby={tabButtonId(activeTab())}
        tabindex={0}
        class="flex-1 overflow-auto p-6"
      >
        <Show when={loading()}>
          <div class="flex flex-col items-center justify-center py-16 text-zinc-500">
            <div class="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
            <span class="mt-3">{t("loading")}</span>
          </div>
        </Show>

        <Show when={!loading() && loadError()}>
          <div class="flex flex-col items-center justify-center py-16 text-red-500">
            <span>{loadError()}</span>
          </div>
        </Show>

        <Show
          when={!loading() && !loadError() && activeTab() === "conversation"}
        >
          <PRComments
            pr={props.pr}
            reviews={reviews()}
            comments={comments()}
            newComment={newComment()}
            onNewCommentChange={setNewComment}
            onAddComment={handleAddComment}
            showReviewForm={showReviewForm()}
            onShowReviewForm={setShowReviewForm}
            reviewComment={reviewComment()}
            onReviewCommentChange={setReviewComment}
            onSubmitReview={handleSubmitReview}
            submittingReview={submittingReview()}
          />
          <Show when={props.pr.status === "open"}>
            <div class="mt-4">
              <PRActions
                repoId={props.repoId}
                pr={props.pr}
                merging={merging()}
                closing={closing()}
                aiReviewing={aiReviewing()}
                showConflictResolver={showConflictResolver()}
                showReviewForm={showReviewForm()}
                onMerge={handleMerge}
                onClose={handleClose}
                onAiReview={handleAiReview}
                onShowConflictResolver={setShowConflictResolver}
                onShowReviewForm={setShowReviewForm}
                onConflictResolved={() => {
                  setShowConflictResolver(false);
                  props.onUpdate({ ...props.pr, status: "merged" });
                }}
              />
            </div>
          </Show>
        </Show>

        <Show when={!loading() && !loadError() && activeTab() === "files"}>
          <PRDiffView
            diffs={diffs()}
            expandedFiles={expandedFiles()}
            onToggleFile={toggleFileExpand}
          />
        </Show>
      </div>
    </div>
  );
}
