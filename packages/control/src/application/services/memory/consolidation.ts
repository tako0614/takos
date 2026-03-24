import type { D1Database } from '../../../shared/types/bindings.ts';
import type { MemoryType } from '../../../shared/types';
import { type LLMClient, createLLMClient } from '../agent';
import { getDb, memories } from '../../../infra/db';
import { eq, and, or, lt, isNull, desc, asc, count, sql, inArray } from 'drizzle-orm';
import { chatAndParseJsonArray } from './helpers';
import { now } from '../../../shared/utils';
import { logError } from '../../../shared/utils/logger';

interface MergeGroup {
  indices: number[];
  merged: string;
}

interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  importance: number;
  category: string | null;
}

interface SimpleMemoryEntry {
  id: string;
  type: string;
  content: string;
  importance: number;
}

const DECAY_CONFIG = {
  dailyDecayRate: 0.001,
  minimumImportance: 0.001,
  cleanupThresholdDays: 365,
  maxMemoriesPerWorkspace: 10_000,
};

function getNgrams(text: string, n: number = 3): Set<string> {
  const words = text.toLowerCase().split(/\s+/);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export class MemoryConsolidator {
  private dbBinding: D1Database;
  private llmClient: LLMClient | undefined;

  constructor(dbBinding: D1Database, apiKey?: string) {
    this.dbBinding = dbBinding;
    if (apiKey) {
      this.llmClient = createLLMClient(apiKey);
    }
  }

  /**
   * Apply decay to all memories in a workspace.
   * Uses atomic SQL (julianday) to prevent read-modify-write races.
   */
  async applyDecay(spaceId: string): Promise<{ updated: number; deleted: number }> {
    const db = getDb(this.dbBinding);
    const nowDate = new Date();
    const nowIso = nowDate.toISOString();
    const cutoffDate = new Date(nowDate);
    cutoffDate.setDate(cutoffDate.getDate() - DECAY_CONFIG.cleanupThresholdDays);
    const cutoffIso = cutoffDate.toISOString();

    const deleted = await db.run(sql`
      DELETE FROM memories
      WHERE account_id = ${spaceId}
      AND (last_accessed_at IS NULL OR last_accessed_at < ${cutoffIso})
      AND importance - (
        CAST((julianday(${nowIso}) - julianday(COALESCE(last_accessed_at, '1970-01-01'))) AS INTEGER)
        * ${DECAY_CONFIG.dailyDecayRate}
        * MAX(0.5, 1.0 - (access_count * 0.1))
      ) < ${DECAY_CONFIG.minimumImportance}
    `);

    const updated = await db.run(sql`
      UPDATE memories
      SET
        importance = MAX(0, importance - (
          CAST((julianday(${nowIso}) - julianday(COALESCE(last_accessed_at, '1970-01-01'))) AS INTEGER)
          * ${DECAY_CONFIG.dailyDecayRate}
          * MAX(0.5, 1.0 - (access_count * 0.1))
        )),
        updated_at = ${nowIso}
      WHERE account_id = ${spaceId}
      AND (last_accessed_at IS NULL OR last_accessed_at < ${cutoffIso})
      AND importance > ${DECAY_CONFIG.minimumImportance}
    `);

    return { updated: updated.meta.changes, deleted: deleted.meta.changes };
  }

  async mergeSimilar(spaceId: string): Promise<{ merged: number }> {
    if (!this.llmClient) {
      return this.mergeSimilarSimple(spaceId);
    }

    const db = getDb(this.dbBinding);

    const memoriesResult = await db.select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      importance: memories.importance,
      category: memories.category,
    }).from(memories)
      .where(eq(memories.accountId, spaceId))
      .orderBy(asc(memories.type), desc(memories.importance))
      .limit(100)
      .all();

    const memoryEntries: MemoryEntry[] = memoriesResult.map(m => ({
      id: m.id,
      type: m.type as MemoryType,
      content: m.content,
      importance: m.importance ?? 0.5,
      category: m.category,
    }));

    if (memoryEntries.length < 2) {
      return { merged: 0 };
    }

    const byType = new Map<MemoryType, MemoryEntry[]>();
    for (const memory of memoryEntries) {
      let group = byType.get(memory.type);
      if (!group) {
        group = [];
        byType.set(memory.type, group);
      }
      group.push(memory);
    }

    let merged = 0;

    for (const [type, typeMemories] of byType) {
      if (typeMemories.length < 2) continue;

      const memoriesText = typeMemories
        .map((m, i) => `[${i}] ${m.content}`)
        .join('\n');

      const userPrompt = `Identify groups of similar or duplicate memories that should be merged.

Memories (${type}):
${memoriesText}

Return JSON with groups of indices that should be merged and a merged content:
[
  { "indices": [0, 3], "merged": "Combined content here" },
  ...
]

Only group genuinely similar/duplicate memories. Return empty array if no merges needed.`;

      const groups = await chatAndParseJsonArray<MergeGroup>(
        this.llmClient,
        'You are a memory consolidation assistant. Output only valid JSON.',
        userPrompt,
      );
      if (!groups) continue;

      for (const group of groups) {
        if (group.indices.length < 2) continue;

        const toMerge = group.indices.map(i => typeMemories[i]).filter(Boolean);
        if (toMerge.length < 2) continue;

        toMerge.sort((a, b) => b.importance - a.importance);
        const primary = toMerge[0];
        const others = toMerge.slice(1);
        const maxImportance = Math.max(...toMerge.map(m => m.importance));
        await db.update(memories)
          .set({
            content: group.merged,
            importance: maxImportance,
            updatedAt: now(),
          })
          .where(eq(memories.id, primary.id));

        const otherIds = others.map(o => o.id);
        if (otherIds.length > 0) {
          await db.delete(memories).where(inArray(memories.id, otherIds));
          merged += otherIds.length;
        }
      }
    }

    return { merged };
  }

  private async mergeSimilarSimple(spaceId: string): Promise<{ merged: number }> {
    const db = getDb(this.dbBinding);

    const memoriesResult = await db.select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      importance: memories.importance,
    }).from(memories)
      .where(eq(memories.accountId, spaceId))
      .orderBy(desc(memories.importance))
      .limit(200)
      .all();

    const memoryEntries: SimpleMemoryEntry[] = memoriesResult.map(m => ({
      id: m.id,
      type: m.type,
      content: m.content,
      importance: m.importance ?? 0.5,
    }));

    if (memoryEntries.length < 2) {
      return { merged: 0 };
    }

    const toDelete = new Set<string>();
    let merged = 0;

    for (let i = 0; i < memoryEntries.length; i++) {
      if (toDelete.has(memoryEntries[i].id)) continue;

      const aGrams = getNgrams(memoryEntries[i].content);

      for (let j = i + 1; j < memoryEntries.length; j++) {
        if (toDelete.has(memoryEntries[j].id)) continue;
        if (memoryEntries[i].type !== memoryEntries[j].type) continue;

        const bGrams = getNgrams(memoryEntries[j].content);
        const similarity = jaccardSimilarity(aGrams, bGrams);

        if (similarity > 0.7) {
          if (memoryEntries[i].importance >= memoryEntries[j].importance) {
            toDelete.add(memoryEntries[j].id);
          } else {
            toDelete.add(memoryEntries[i].id);
          }
          merged++;
        }
      }
    }

    if (toDelete.size > 0) {
      await db.delete(memories).where(inArray(memories.id, [...toDelete]));
    }

    return { merged };
  }

  async summarizeOld(spaceId: string): Promise<{ summarized: number }> {
    if (!this.llmClient) {
      return { summarized: 0 };
    }

    const db = getDb(this.dbBinding);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const memoriesResult = await db.select({
      id: memories.id,
      type: memories.type,
      content: memories.content,
      category: memories.category,
    }).from(memories)
      .where(and(
        eq(memories.accountId, spaceId),
        lt(memories.createdAt, thirtyDaysAgo.toISOString()),
        or(
          isNull(memories.summary),
          eq(memories.summary, ''),
        ),
      ))
      .limit(50)
      .all();

    const filteredMemories = memoriesResult
      .filter(m => m.content.length > 200)
      .slice(0, 20);

    if (filteredMemories.length === 0) {
      return { summarized: 0 };
    }

    let summarized = 0;

    for (const memory of filteredMemories) {
      try {
        const response = await this.llmClient.chat([
          { role: 'system', content: 'Summarize the following text in 1-2 sentences. Keep essential information only.' },
          { role: 'user', content: memory.content },
        ], []);

        const summary = response.content.trim();
        if (summary && summary.length < memory.content.length) {
          await db.update(memories)
            .set({
              summary,
              updatedAt: now(),
            })
            .where(eq(memories.id, memory.id));
          summarized++;
        }
      } catch (error) {
        logError('Summarization failed', error, { module: 'services/memory/consolidation' });
      }
    }

    return { summarized };
  }

  async enforceLimit(spaceId: string): Promise<{ deleted: number }> {
    const db = getDb(this.dbBinding);

    const countResult = await db.select({ count: count() }).from(memories)
      .where(eq(memories.accountId, spaceId))
      .get();

    const total = countResult?.count ?? 0;
    const excess = total - DECAY_CONFIG.maxMemoriesPerWorkspace;

    if (excess <= 0) {
      return { deleted: 0 };
    }

    const toDeleteResult = await db.select({ id: memories.id }).from(memories)
      .where(eq(memories.accountId, spaceId))
      .orderBy(asc(memories.importance), asc(memories.lastAccessedAt))
      .limit(excess)
      .all();

    for (const { id } of toDeleteResult) {
      await db.delete(memories).where(eq(memories.id, id));
    }

    return { deleted: toDeleteResult.length };
  }

  async consolidate(spaceId: string): Promise<{
    decayed: { updated: number; deleted: number };
    merged: { merged: number };
    summarized: { summarized: number };
    limited: { deleted: number };
  }> {
    const decayed = await this.applyDecay(spaceId);
    const merged = await this.mergeSimilar(spaceId);
    const summarized = await this.summarizeOld(spaceId);
    const limited = await this.enforceLimit(spaceId);

    return { decayed, merged, summarized, limited };
  }
}

export function createMemoryConsolidator(db: D1Database, apiKey?: string): MemoryConsolidator {
  return new MemoryConsolidator(db, apiKey);
}
