/**
 * YAML ワークフローパーサー
 */
import {
  parse as parseYaml,
  stringify as stringifyYaml,
  YAMLParseError,
} from "yaml";
import type {
  ParsedWorkflow,
  Workflow,
  WorkflowDiagnostic,
  WorkflowTrigger,
} from "../workflow-models.ts";
import { normalizeNeedsInput } from "../scheduler/job.ts";

/**
 * ワークフロー解析失敗時に投げるエラー
 */
export class WorkflowParseError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: WorkflowDiagnostic[],
  ) {
    super(message);
    this.name = "WorkflowParseError";
  }
}

/**
 * `schedule` を常に配列形式へ標準化する。
 *
 * YAML は単一オブジェクトでの書き方 (`schedule: { cron: '0 0 * * *' }`) と
 * 配列での書き方 (`schedule: [{ cron: '0 0 * * *' }]`) の両方を許容するため、
 * 下流の validator / scheduler が扱いやすい配列形式に揃える。
 */
function normalizeSchedule(value: unknown): unknown {
  if (value === undefined || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value;
  }
  // 単一オブジェクトなら配列に包む
  if (typeof value === "object") {
    return [value];
  }
  return value;
}

/**
 * 様々な形式のトリガー表現を標準形に変換する
 */
function normalizeTrigger(on: unknown): WorkflowTrigger {
  // 文字列形式: on: push
  if (typeof on === "string") {
    return { [on]: null } as WorkflowTrigger;
  }

  // 配列形式: on: [push, pull_request]
  if (Array.isArray(on)) {
    const trigger: Record<string, unknown> = {};
    for (const event of on) {
      if (typeof event === "string") {
        trigger[event] = null;
      }
    }
    return trigger as WorkflowTrigger;
  }

  // オブジェクト形式: on: { push: { branches: [...] } }
  if (typeof on === "object" && on !== null) {
    const trigger = { ...(on as Record<string, unknown>) };
    if ("schedule" in trigger) {
      trigger.schedule = normalizeSchedule(trigger.schedule);
    }
    return trigger as WorkflowTrigger;
  }

  return {};
}

/**
 * ワークフロー構造を標準化する
 */
function normalizeWorkflow(raw: unknown): Workflow {
  if (typeof raw !== "object" || raw === null) {
    throw new WorkflowParseError("Workflow must be an object", [
      { severity: "error", message: "Workflow must be an object" },
    ]);
  }

  const obj = raw as Record<string, unknown>;

  // 'on' トリガーを標準化
  const on = normalizeTrigger(obj.on);

  // jobs を標準化
  const jobs: Workflow["jobs"] = {};
  const rawJobs = obj.jobs;
  if (typeof rawJobs === "object" && rawJobs !== null) {
    for (
      const [jobId, job] of Object.entries(
        rawJobs as Record<string, unknown>,
      )
    ) {
      if (typeof job !== "object" || job === null) {
        continue;
      }
      const jobObj = job as Record<string, unknown>;
      const normalizedNeeds = normalizeNeedsInput(jobObj.needs);
      jobs[jobId] = {
        ...jobObj,
        needs: normalizedNeeds.length > 0 ? normalizedNeeds : undefined,
        steps: Array.isArray(jobObj.steps) ? jobObj.steps : [],
      } as Workflow["jobs"][string];
    }
  }

  return {
    name: typeof obj.name === "string" ? obj.name : undefined,
    "run-name": typeof obj["run-name"] === "string"
      ? (obj["run-name"] as string)
      : undefined,
    on,
    env: typeof obj.env === "object" && obj.env !== null
      ? (obj.env as Record<string, string>)
      : undefined,
    jobs,
    permissions: obj.permissions as Workflow["permissions"],
    concurrency: obj.concurrency as Workflow["concurrency"],
    defaults: obj.defaults as Workflow["defaults"],
  };
}

/**
 * YAML ワークフロー本文を解析する
 *
 * @param content - YAML コンテンツ文字列
 * @returns 診断情報付きの解析結果
 */
export function parseWorkflow(content: string): ParsedWorkflow {
  const diagnostics: WorkflowDiagnostic[] = [];

  try {
    const parsed = parseYaml(content, {
      strict: false,
      uniqueKeys: true,
    });

    const workflow = normalizeWorkflow(parsed);

    return {
      workflow,
      diagnostics,
    };
  } catch (error) {
    if (error instanceof YAMLParseError) {
      diagnostics.push({
        severity: "error",
        message: error.message,
        line: error.linePos?.[0]?.line,
        column: error.linePos?.[0]?.col,
      });
    } else if (error instanceof WorkflowParseError) {
      diagnostics.push(...error.diagnostics);
    } else if (error instanceof Error) {
      diagnostics.push({
        severity: "error",
        message: error.message,
      });
    } else {
      diagnostics.push({
        severity: "error",
        message: "Unknown parse error",
      });
    }

    throw new WorkflowParseError("Failed to parse workflow", diagnostics);
  }
}

/**
 * ファイルパスからワークフローを解析する（Node.js 環境用）
 *
 * @param filePath - ワークフロー YAML のパス
 * @returns 解析済みワークフロー
 */
export async function parseWorkflowFile(
  filePath: string,
): Promise<ParsedWorkflow> {
  // Node.js の fs は動的 import を使用
  const { readFile } = await import("node:fs/promises");
  const content = await readFile(filePath, "utf-8");
  return parseWorkflow(content);
}

/**
 * ワークフローを YAML 文字列に戻す
 *
 * @param workflow - ワークフローオブジェクト
 * @returns YAML 文字列
 */
export function stringifyWorkflow(workflow: Workflow): string {
  return stringifyYaml(workflow, {
    indent: 2,
    lineWidth: 0,
  });
}
