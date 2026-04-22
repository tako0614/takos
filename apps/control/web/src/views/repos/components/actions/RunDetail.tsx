import { For, Show } from "solid-js";
import { Icons } from "../../../../lib/Icons.tsx";
import { useI18n } from "../../../../store/i18n.ts";
import type { JobLogState, WorkflowRunDetail } from "./actions-types.ts";
import { statusBadge } from "./actions-types.ts";
import { JobCard } from "./JobCard.tsx";
import { Button } from "../../../../components/ui/Button.tsx";
import { Card } from "../../../../components/ui/Card.tsx";

interface RunDetailProps {
  run: WorkflowRunDetail | null;
  loadingRun: boolean;
  jobLogs: Record<string, JobLogState>;
  loadingJobId: string | null;
  onRerun: (runId: string) => void;
  onCancel: (runId: string) => void;
  onLoadLogs: (jobId: string) => void;
  onLoadMore: (jobId: string) => void;
}

export function RunDetail(props: RunDetailProps) {
  const { t } = useI18n();

  return (
    <Card padding="none">
      <div
        class="flex items-center justify-between px-4 py-3 border-b"
        style={{ "border-color": "var(--color-border-primary)" }}
      >
        <span class="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {t("runDetailsTitle")}
        </span>
        <Show when={props.run}>
          {(run) => (
            <div class="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Icons.Refresh class="w-3.5 h-3.5" />}
                onClick={() => props.onRerun(run().id)}
              >
                {t("rerun")}
              </Button>
              <Show
                when={run().status !== "completed" &&
                  run().status !== "cancelled"}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Icons.Square class="w-3.5 h-3.5" />}
                  onClick={() => props.onCancel(run().id)}
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {t("cancel")}
                </Button>
              </Show>
            </div>
          )}
        </Show>
      </div>
      <Show when={props.loadingRun}>
        <div
          class="flex items-center gap-3 px-4 py-6"
          style={{ color: "var(--color-text-secondary)" }}
        >
          <div class="w-4 h-4 border-2 border-zinc-300 border-t-zinc-900 rounded-full animate-spin" />
          <span>{t("loadingRun")}</span>
        </div>
      </Show>
      <Show when={!props.loadingRun && !props.run}>
        <div
          class="px-4 py-10 text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {t("selectRunToSeeDetails")}
        </div>
      </Show>
      <Show when={!props.loadingRun ? props.run : null}>
        {(run) => (
          <div class="px-4 py-4 space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <div
                  class="text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {run().workflow_path}
                </div>
                <div
                  class="text-xs mt-1"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {run().ref || "unknown ref"} ·{" "}
                  {run().sha?.slice(0, 7) || "unknown sha"}
                </div>
              </div>
              <span
                class={`px-2 py-0.5 text-[11px] border rounded-full ${
                  statusBadge(
                    run().status,
                    run().conclusion,
                  )
                }`}
              >
                {run().status}
              </span>
            </div>

            <div class="space-y-2">
              <Show when={run().jobs.length === 0}>
                <div
                  class="text-sm"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {t("noJobsRecorded")}
                </div>
              </Show>
              <For each={run().jobs}>
                {(job) => (
                  <JobCard
                    job={job}
                    logState={props.jobLogs[job.id]}
                    loadingJobId={props.loadingJobId}
                    onLoadLogs={props.onLoadLogs}
                    onLoadMore={props.onLoadMore}
                  />
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </Card>
  );
}
