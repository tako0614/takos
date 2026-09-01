import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
        minLength: 1,
        maxLength: 4096,
      },
      limit: {
        type: "integer",
        description: "Maximum results (default: 5, max: 20)",
        minimum: 1,
        maximum: 20,
      },
      min_score: {
        type: "number",
        description: "Minimum vector similarity score (default: 0.5)",
        minimum: 0,
        maximum: 1,
      },
    },
    required: ["query"],
  },
};

type CanonicalInfoUnitMatch = {
  id: string;
  runId: string | null;
  kind: string;
  content: string;
  score: number;
};

function formatVectorMatch(
  match: CanonicalInfoUnitMatch,
  index: number,
): string {
  const snippet = match.content.length > 200
    ? `${match.content.slice(0, 200)}...`
    : match.content;
  return `${index + 1}. [${match.score.toFixed(3)}] run:${
    match.runId ?? "unknown"
  } (${match.kind})\n${snippet}`;
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
  if (!query || query.length > 4096) {
    throw new Error("Query must be between 1 and 4096 characters");
  }

  const rawLimit = args.limit;
  if (
    rawLimit !== undefined &&
    (typeof rawLimit !== "number" || !Number.isSafeInteger(rawLimit) ||
      rawLimit < 1 || rawLimit > 20)
  ) throw new Error("Limit must be an integer from 1 to 20");
  const limit = rawLimit === undefined ? 5 : rawLimit;
  const rawMinScore = args.min_score;
  if (
    rawMinScore !== undefined &&
    (typeof rawMinScore !== "number" || !Number.isFinite(rawMinScore) ||
      rawMinScore < 0 || rawMinScore > 1)
  ) throw new Error("Minimum score must be between 0 and 1");
  const minScore = rawMinScore === undefined ? 0.5 : rawMinScore;

  const db = getDb(context.db);
  const rows = await db
    .select({
      id: infoUnits.id,
      runId: infoUnits.runId,
      kind: infoUnits.kind,
      content: infoUnits.content,
    })
    .from(infoUnits)
    .where(
      and(
        eq(infoUnits.accountId, context.spaceId),
        sql`instr(lower(${infoUnits.content}), lower(${query})) > 0`,
      ),
    )
    .orderBy(desc(infoUnits.createdAt))
    .limit(limit)
    .all();
  let vectorCandidates: Array<{
    id: string;
    score: number;
    runId: string;
    segmentIndex: number;
    segmentCount: number;
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
        vectorCandidates = result.matches.flatMap((match) => {
          const metadata = match.metadata;
          const id = typeof match.id === "string" ? match.id : "";
          const runId = typeof metadata?.runId === "string"
            ? metadata.runId
            : "";
          const segmentIndex = metadata?.segmentIndex;
          const segmentCount = metadata?.segmentCount;
          if (
            !id || id.length > 512 || !runId || runId.length > 128 ||
            match.score < minScore ||
            metadata?.kind !== "info_unit" ||
            metadata?.spaceId !== context.spaceId ||
            !Number.isSafeInteger(segmentIndex) || Number(segmentIndex) < 0 ||
            !Number.isSafeInteger(segmentCount) || Number(segmentCount) < 1 ||
            Number(segmentIndex) >= Number(segmentCount)
          ) return [];
          return [{
            id,
            score: match.score,
            runId,
            segmentIndex: Number(segmentIndex),
            segmentCount: Number(segmentCount),
          }];
        }).slice(0, limit);
      }
    } catch (error) {
      logWarn("Info unit vector search failed; using durable text index", {
        module: "tools/custom/info-unit",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const canonicalVectorRows = vectorCandidates.length === 0
    ? []
    : await db.select({
      id: infoUnits.id,
      accountId: infoUnits.accountId,
      runId: infoUnits.runId,
      kind: infoUnits.kind,
      content: infoUnits.content,
      segmentIndex: infoUnits.segmentIndex,
      segmentCount: infoUnits.segmentCount,
      vectorId: infoUnits.vectorId,
    }).from(infoUnits).where(and(
      eq(infoUnits.accountId, context.spaceId),
      inArray(
        infoUnits.vectorId,
        vectorCandidates.map((candidate) => candidate.id),
      ),
    )).all();
  const canonicalByVectorId = new Map(
    canonicalVectorRows.flatMap((row) =>
      row.vectorId ? [[row.vectorId, row] as const] : []
    ),
  );
  const vectorMatches: CanonicalInfoUnitMatch[] = [];
  const seenUnitIds = new Set<string>();
  for (const candidate of vectorCandidates) {
    const row = canonicalByVectorId.get(candidate.id);
    if (
      !row || row.accountId !== context.spaceId ||
      row.runId !== candidate.runId ||
      row.segmentIndex !== candidate.segmentIndex ||
      row.segmentCount !== candidate.segmentCount ||
      row.vectorId !== candidate.id || seenUnitIds.has(row.id)
    ) continue;
    seenUnitIds.add(row.id);
    vectorMatches.push({
      id: row.id,
      runId: row.runId,
      kind: row.kind,
      content: row.content,
      score: candidate.score,
    });
  }

  const sections = [
    ...vectorMatches.map(formatVectorMatch),
    ...rows
      .filter(
        (row) => !seenUnitIds.has(row.id),
      )
      .map((row, index) => formatTextMatch(row, vectorMatches.length + index)),
  ].slice(0, limit);
  if (sections.length === 0) return `No info units found for: "${query}"`;
  return `Found ${sections.length} info units:\n\n${sections.join("\n\n")}`;
};

export const { tools: INFO_UNIT_TOOLS, handlers: INFO_UNIT_HANDLERS } =
  defineTools([[INFO_UNIT_SEARCH, infoUnitSearchHandler]]);
