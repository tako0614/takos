import type {
  Ai,
  D1Database,
  VectorizeIndex,
} from "../../../shared/types/bindings.ts";
import type { SkillCategory, SkillSource } from "../agent/skills.ts";
import type { SkillCatalogEntry } from "../agent/skills.ts";
import { CATEGORY_LABELS, getCategoryLabel } from "../agent/managed-skills.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export interface SkillCatalogEntrySummary {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  source: SkillSource;
  category?: SkillCategory;
}

export interface SkillCategoryNode {
  category: SkillCategory;
  label: string;
  description: string;
  skills: SkillCatalogEntrySummary[];
}

export interface SkillTreeResponse {
  categories: SkillCategoryNode[];
  total_skills: number;
}

export interface SkillSearchResult {
  skill: SkillCatalogEntrySummary;
  score: number;
  match_source: "text" | "vector" | "combined";
}

export interface SkillSearchResponse {
  results: SkillSearchResult[];
  total: number;
}

import { EMBEDDING_MODEL } from "../../../shared/config/limits.ts";

const CATEGORY_ORDER: SkillCategory[] = [
  "research",
  "writing",
  "planning",
  "slides",
  "software",
  "custom",
];

function toSummary(skill: SkillCatalogEntry): SkillCatalogEntrySummary {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    triggers: [...skill.triggers],
    source: skill.source,
    category: skill.category,
  };
}

export function buildSkillTree(skills: SkillCatalogEntry[]): SkillTreeResponse {
  const grouped = new Map<SkillCategory, SkillCatalogEntrySummary[]>();

  for (const skill of skills) {
    const cat: SkillCategory = skill.category ?? "custom";
    const list = grouped.get(cat);
    if (list) {
      list.push(toSummary(skill));
    } else {
      grouped.set(cat, [toSummary(skill)]);
    }
  }

  const categories: SkillCategoryNode[] = [];
  for (const cat of CATEGORY_ORDER) {
    const items = grouped.get(cat);
    if (!items?.length) continue;
    const labelInfo = getCategoryLabel(cat);
    categories.push({
      category: cat,
      label: labelInfo.label,
      description: labelInfo.description,
      skills: items,
    });
  }

  return { categories, total_skills: skills.length };
}

function textScore(skill: SkillCatalogEntrySummary, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const nameLower = skill.name.toLowerCase();
  if (nameLower === q) return 100;
  if (nameLower.includes(q)) return 60;
  if (skill.triggers.some((t) => t.toLowerCase().includes(q))) return 50;
  if (skill.description.toLowerCase().includes(q)) return 40;

  const cat = skill.category ?? "custom";
  const catLabel = CATEGORY_LABELS[cat];
  if (
    catLabel && [cat, catLabel.label].some((l) => l.toLowerCase().includes(q))
  ) return 30;

  return 0;
}

export function searchSkillsByText(
  skills: SkillCatalogEntry[],
  query: string,
  opts?: { limit?: number; min_score?: number },
): SkillSearchResult[] {
  const limit = opts?.limit ?? 20;
  const minScore = opts?.min_score ?? 1;

  const results: SkillSearchResult[] = [];
  for (const skill of skills) {
    const summary = toSummary(skill);
    const score = textScore(summary, query);
    if (score >= minScore) {
      results.push({ skill: summary, score, match_source: "text" });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function buildSkillEmbedText(
  skill: { name: string; description: string; triggers: string[] },
): string {
  return `${skill.name} | ${skill.description} | ${skill.triggers.join(", ")}`;
}

function skillVectorId(spaceId: string, skillId: string): string {
  return `skill:${spaceId}:${skillId}`;
}

async function generateEmbedding(
  ai: Ai,
  text: string,
): Promise<number[] | null> {
  const result = await ai.run(EMBEDDING_MODEL, { text: [text] }) as {
    data: number[][];
  };
  return result.data?.[0] ?? null;
}

export async function indexSkillVector(
  ai: Ai,
  vectorize: VectorizeIndex,
  spaceId: string,
  skill: {
    id: string;
    name: string;
    description: string;
    triggers: string[];
    source: string;
    category?: string;
  },
): Promise<string> {
  const content = buildSkillEmbedText(skill);
  const embedding = await generateEmbedding(ai, content);
  if (!embedding) {
    throw new Error("Failed to generate embedding for skill");
  }

  const vectorId = skillVectorId(spaceId, skill.id);
  await vectorize.upsert([{
    id: vectorId,
    values: embedding,
    metadata: {
      kind: "skill",
      spaceId,
      skillId: skill.id,
      source: skill.source,
      category: skill.category ?? "custom",
      content: content.slice(0, 1000),
    },
  }]);

  return vectorId;
}

export async function removeSkillVector(
  vectorize: VectorizeIndex,
  spaceId: string,
  skillId: string,
): Promise<void> {
  await vectorize.deleteByIds([skillVectorId(spaceId, skillId)]);
}

export async function ensureManagedSkillsIndexed(
  ai: Ai,
  vectorize: VectorizeIndex,
  spaceId: string,
  skills: SkillCatalogEntry[],
): Promise<void> {
  for (const skill of skills) {
    if (skill.source !== "managed") continue;
    try {
      await indexSkillVector(ai, vectorize, spaceId, skill);
    } catch (err) {
      logWarn(`Failed to index managed skill ${skill.id}`, {
        module: "skill-search",
        detail: err,
      });
    }
  }
}

function parseVectorMetadata(
  meta: Record<string, unknown>,
): SkillCatalogEntrySummary {
  const parts = String(meta.content ?? "").split(" | ");
  return {
    id: String(meta.skillId ?? ""),
    name: parts[0] || String(meta.skillId ?? ""),
    description: parts[1] || "",
    triggers: (parts[2] || "").split(", ").filter(Boolean),
    source: (meta.source as "managed" | "custom") ?? "custom",
    category: (meta.category as SkillCategory) ?? "custom",
  };
}

export async function searchSkillsByVector(
  ai: Ai,
  vectorize: VectorizeIndex,
  spaceId: string,
  input: { query?: string; vector?: number[] },
  opts?: { limit?: number; min_score?: number },
): Promise<SkillSearchResult[]> {
  const limit = opts?.limit ?? 20;
  const minScore = opts?.min_score ?? 0.3;

  let queryVector: number[] | undefined = input.vector;
  if (!queryVector) {
    if (!input.query) return [];
    const embedding = await generateEmbedding(ai, input.query);
    if (!embedding) return [];
    queryVector = embedding;
  }

  const matches = await vectorize.query(queryVector, {
    topK: limit,
    filter: { kind: "skill", spaceId },
    returnMetadata: "all",
  });

  const results: SkillSearchResult[] = [];
  for (const match of matches.matches) {
    const meta = match.metadata as Record<string, unknown> | undefined;
    if (!meta || match.score < minScore) continue;
    results.push({
      skill: parseVectorMetadata(meta),
      score: match.score,
      match_source: "vector",
    });
  }

  return results;
}

export interface SkillSearchParams {
  query?: string;
  vector?: number[];
  limit?: number;
  min_score?: number;
}

export async function searchSkills(
  env: { AI?: Ai; VECTORIZE?: VectorizeIndex; DB: D1Database },
  _db: D1Database,
  spaceId: string,
  skills: SkillCatalogEntry[],
  params: SkillSearchParams,
): Promise<SkillSearchResponse> {
  const limit = params.limit ?? 20;
  const minScore = params.min_score ?? 1;

  const hasTextQuery = Boolean(params.query?.trim());
  const canVector = Boolean(env.AI && env.VECTORIZE);

  let textResults: SkillSearchResult[] = [];
  if (hasTextQuery) {
    textResults = searchSkillsByText(skills, params.query!, {
      limit,
      min_score: minScore,
    });
  }

  let vectorResults: SkillSearchResult[] = [];
  if (canVector && (hasTextQuery || params.vector)) {
    try {
      await ensureManagedSkillsIndexed(
        env.AI!,
        env.VECTORIZE!,
        spaceId,
        skills,
      );
      vectorResults = await searchSkillsByVector(
        env.AI!,
        env.VECTORIZE!,
        spaceId,
        { query: params.query, vector: params.vector },
        { limit, min_score: 0.3 },
      );
    } catch (err) {
      logWarn("Skill vector search failed, falling back to text only", {
        module: "skill-search",
        detail: err,
      });
    }
  }

  if (textResults.length === 0 && vectorResults.length === 0) {
    return { results: [], total: 0 };
  }

  if (vectorResults.length === 0) {
    return { results: textResults, total: textResults.length };
  }

  if (textResults.length === 0) {
    return {
      results: vectorResults.slice(0, limit),
      total: vectorResults.length,
    };
  }

  const maxTextScore = Math.max(...textResults.map((r) => r.score), 1);
  const merged = new Map<string, SkillSearchResult>();

  for (const r of textResults) {
    merged.set(r.skill.id, {
      ...r,
      score: r.score / maxTextScore,
      match_source: "text",
    });
  }

  for (const r of vectorResults) {
    const existing = merged.get(r.skill.id);
    if (existing) {
      merged.set(r.skill.id, {
        skill: existing.skill,
        score: Math.max(existing.score, r.score),
        match_source: "combined",
      });
    } else {
      merged.set(r.skill.id, r);
    }
  }

  const results = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { results, total: results.length };
}
