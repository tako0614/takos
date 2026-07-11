import { and, desc, eq, like } from "drizzle-orm";
import { getDb, infoUnits } from "../../../infra/db/index.ts";
import { EMBEDDING_MODEL } from "../../../shared/config/limits.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import type { ToolDefinition, ToolHandler } from "../tool-definitions.ts";
import { defineTools } from "./define-tools.ts";

export const INFO_UNIT_SEARCH: ToolDefinition = {
  name: "info_unit_search",
  description:
    "Search the Workspace's derived index of completed agent-run events and outputs. This does not search explicit remember/recall memories.",
  category: "memory",
  namespace: "memory",
  family: "memory.search",
  risk_level: "none",
  side_effects: false,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query for relevant info units",
      },
      limit: {
        type: "number",
        description: "Maximum results (default: 5, max: 20)",
      },
      min_score: {
        type: "number",
        description: "Minimum vector similarity score (default: 0.5)",
      },
    },
    required: ["query"],
  },
};

function formatVectorMatch(
  match: { score: number; metadata?: Record<string, unknown> },
  index: number,
): string {
  const metadata = match.metadata ?? {};
  const snippet = typeof metadata.content === "string" ? metadata.content : "";
  const runId = typeof metadata.runId === "string" ? metadata.runId : "unknown";
  const segment =
    typeof metadata.segmentIndex === "number" &&
    typeof metadata.segmentCount === "number"
      ? ` (${metadata.segmentIndex + 1}/${metadata.segmentCount})`
      : "";
  return `${index + 1}. [${match.score.toFixed(3)}] run:${runId}${segment}\n${snippet}`;
}

function formatTextMatch(
  unit: { runId: string | null; kind: string; content: string },
  index: number,
): string {
  const snippet =
    unit.content.length > 200
      ? `${unit.content.slice(0, 200)}...`
      : unit.content;
  return `${index + 1}. run:${unit.runId ?? "unknown"} (${unit.kind})\n${snippet}`;
}

export const infoUnitSearchHandler: ToolHandler = async (args, context) => {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) throw new Error("Query is required");

  const rawLimit = Number(args.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 20)
      : 5;
  const rawMinScore = Number(args.min_score);
  const minScore = Number.isFinite(rawMinScore)
    ? Math.max(0, Math.min(rawMinScore, 1))
    : 0.5;

  const rows = await getDb(context.db)
    .select({
      runId: infoUnits.runId,
      kind: infoUnits.kind,
      content: infoUnits.content,
    })
    .from(infoUnits)
    .where(
      and(
        eq(infoUnits.accountId, context.spaceId),
        like(infoUnits.content, `%${query}%`),
      ),
    )
    .orderBy(desc(infoUnits.createdAt))
    .limit(limit)
    .all();
  let vectorMatches: Array<{
    score: number;
    metadata?: Record<string, unknown>;
  }> = [];
  if (context.env.AI && context.env.VECTORIZE) {
    try {
      const embedding = (await context.env.AI.run(EMBEDDING_MODEL, {
        text: [query],
      })) as { data: number[][] };
      if (embedding.data?.[0]) {
        const result = await context.env.VECTORIZE.query(embedding.data[0], {
          topK: limit * 2,
          filter: { spaceId: context.spaceId, kind: "info_unit" },
          returnMetadata: "all",
        });
        vectorMatches = result.matches
          .filter((match: { score: number }) => match.score >= minScore)
          .slice(0, limit);
      }
    } catch (error) {
      logWarn("Info unit vector search failed; using durable text index", {
        module: "tools/custom/info-unit",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const sections = [
    ...vectorMatches.map(formatVectorMatch),
    ...rows
      .filter(
        (row) =>
          !vectorMatches.some((match) => match.metadata?.runId === row.runId),
      )
      .map((row, index) => formatTextMatch(row, vectorMatches.length + index)),
  ].slice(0, limit);
  if (sections.length === 0) return `No info units found for: "${query}"`;
  return `Found ${sections.length} info units:\n\n${sections.join("\n\n")}`;
};

export const { tools: INFO_UNIT_TOOLS, handlers: INFO_UNIT_HANDLERS } =
  defineTools([[INFO_UNIT_SEARCH, infoUnitSearchHandler]]);
