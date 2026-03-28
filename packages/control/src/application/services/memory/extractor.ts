import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Message, MemoryType } from '../../../shared/types';
import { LLMClient } from '../agent';
import { getDb, memories, messages as messagesTable } from '../../../infra/db';
import { eq, asc } from 'drizzle-orm';
import { generateId, now } from '../../../shared/utils';
import { chatAndParseJsonArray } from './llm-parser';
import { MEMORY_TYPES } from './memories';
import { logError } from '../../../shared/utils/logger';

interface ExtractedMemory {
  type: MemoryType;
  content: string;
  category?: string;
  importance: number;
}

interface PatternRule {
  patterns: RegExp[];
  type: MemoryType;
  category?: string;
  importance: number;
  maxContentLength: number;
  /** If true, strip the matched pattern from content instead of truncating. */
  cleanMatch?: boolean;
  /** Minimum cleaned content length required (only for cleanMatch rules). */
  minCleanedLength?: number;
}

const VALID_MEMORY_TYPES: ReadonlySet<string> = new Set(MEMORY_TYPES);

const REMEMBER_PATTERNS = [
  /覚えて(おいて)?/i,
  /remember\s+(this|that)/i,
  /メモして/i,
  /note\s+(this|that)/i,
  /忘れないで/i,
  /don't\s+forget/i,
  /keep\s+in\s+mind/i,
];

const DECISION_PATTERNS = [
  /決定(した|しました)/i,
  /decided\s+(to|that)/i,
  /採用(する|します)/i,
  /we('ll)?\s+(use|go\s+with)/i,
  /方針(として|は)/i,
  /結論(として|は)/i,
];

const FACT_PATTERNS = [
  /^(my|our|the)\s+(name|company|project|team)\s+(is|are)/i,
  /私(の|は)/,
  /弊社(は|の)/,
  /パスワード(は|:)/i,
  /email\s*(is|:)/i,
  /連絡先/,
  /担当(者|は)/,
];

const PROCEDURE_PATTERNS = [
  /好み(は|として)/,
  /prefer(s)?/i,
  /いつも/,
  /always/i,
  /手順(は|として)/,
  /workflow/i,
  /流れ(は|として)/,
  /ルール(は|として)/,
];

const PATTERN_RULES: PatternRule[] = [
  {
    patterns: REMEMBER_PATTERNS,
    type: 'semantic',
    importance: 0.9,
    maxContentLength: Infinity,
    cleanMatch: true,
    minCleanedLength: 10,
  },
  {
    patterns: DECISION_PATTERNS,
    type: 'episode',
    category: 'decision',
    importance: 0.7,
    maxContentLength: 500,
  },
  {
    patterns: FACT_PATTERNS,
    type: 'semantic',
    category: 'fact',
    importance: 0.6,
    maxContentLength: 200,
  },
  {
    patterns: PROCEDURE_PATTERNS,
    type: 'procedural',
    category: 'preference',
    importance: 0.6,
    maxContentLength: 300,
  },
];

function matchPatternRule(content: string, rule: PatternRule): ExtractedMemory | null {
  for (const pattern of rule.patterns) {
    if (!pattern.test(content)) continue;
    if (content.length >= rule.maxContentLength) continue;

    if (rule.cleanMatch) {
      const cleaned = content
        .replace(pattern, '')
        .replace(/^[:\s]+/, '')
        .trim();
      if (cleaned.length < (rule.minCleanedLength ?? 0)) return null;
      return {
        type: rule.type,
        content: cleaned,
        category: rule.category,
        importance: rule.importance,
      };
    }

    return {
      type: rule.type,
      content: content.substring(0, 200),
      category: rule.category,
      importance: rule.importance,
    };
  }
  return null;
}

function isValidExtractedMemory(m: ExtractedMemory): boolean {
  return Boolean(
    m.type &&
    m.content &&
    VALID_MEMORY_TYPES.has(m.type) &&
    typeof m.importance === 'number'
  );
}

export class MemoryExtractor {
  private dbBinding: D1Database;
  private llmClient: LLMClient | undefined;

  constructor(dbBinding: D1Database, apiKey?: string) {
    this.dbBinding = dbBinding;
    if (apiKey) {
      this.llmClient = new LLMClient({ apiKey });
    }
  }

  async extractFromThread(
    spaceId: string,
    threadId: string,
    userId: string
  ): Promise<ExtractedMemory[]> {
    const db = getDb(this.dbBinding);

    const messagesResult = await db.select({
      role: messagesTable.role,
      content: messagesTable.content,
    }).from(messagesTable)
      .where(eq(messagesTable.threadId, threadId))
      .orderBy(asc(messagesTable.sequence))
      .limit(50)
      .all();

    const msgList: Message[] = messagesResult.map(m => ({
      id: '',
      thread_id: threadId,
      role: m.role as Message['role'],
      content: m.content,
      tool_calls: null,
      tool_call_id: null,
      metadata: '{}',
      sequence: 0,
      created_at: '',
    }));

    if (msgList.length === 0) {
      return [];
    }

    if (this.llmClient) {
      try {
        return await this.extractWithLLM(msgList);
      } catch (error) {
        logError('LLM extraction failed, falling back to pattern matching', error, { module: 'services/memory/extractor' });
      }
    }

    return this.extractWithPatterns(msgList);
  }

  private async extractWithLLM(
    messages: Message[],
  ): Promise<ExtractedMemory[]> {
    const conversation = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n\n');

    const userPrompt = `Analyze this conversation and extract important information to remember.

Conversation:
${conversation}

Extract memories in these categories:
1. episode - Important events or decisions made (e.g., "Decided to use React for frontend")
2. semantic - Facts and knowledge about the user/project (e.g., "User's company is in fintech")
3. procedural - Preferences and procedures (e.g., "User prefers TypeScript over JavaScript")

For each memory, provide:
- type: episode | semantic | procedural
- content: The information to remember (concise, 1-2 sentences)
- category: Optional grouping (e.g., "project", "user", "tech")
- importance: 0.0-1.0 (how important this is to remember)

Return as JSON array. Only include genuinely important information worth remembering.
If nothing important, return empty array.

Format:
[
  {"type": "semantic", "content": "...", "category": "user", "importance": 0.8},
  ...
]`;

    const parsed = await chatAndParseJsonArray<ExtractedMemory>(
      this.llmClient!,
      'You are a memory extraction assistant. Output only valid JSON.',
      userPrompt,
    );

    if (!parsed) return [];
    return parsed.filter(isValidExtractedMemory);
  }

  private extractWithPatterns(messages: Message[]): ExtractedMemory[] {
    const extractedMemories: ExtractedMemory[] = [];

    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      const content = msg.content;

      for (const rule of PATTERN_RULES) {
        const memory = matchPatternRule(content, rule);
        if (memory) {
          extractedMemories.push(memory);
        }
      }
    }

    const seen = new Set<string>();
    return extractedMemories.filter(m => {
      const key = m.content.substring(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
  }

  async saveMemories(
    spaceId: string,
    threadId: string,
    userId: string,
    extractedMemories: ExtractedMemory[]
  ): Promise<number> {
    const db = getDb(this.dbBinding);
    const timestamp = now();
    let saved = 0;

    for (const memory of extractedMemories) {
      const id = generateId();

      try {
        await db.insert(memories).values({
          id,
          accountId: spaceId,
          authorAccountId: userId,
          threadId,
          type: memory.type,
          category: memory.category || null,
          content: memory.content,
          summary: memory.content.length > 100 ? memory.content.substring(0, 97) + '...' : memory.content,
          importance: memory.importance,
          occurredAt: timestamp,
          accessCount: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        saved++;
      } catch (error) {
        logError('Failed to save memory', error, { module: 'services/memory/extractor' });
      }
    }

    return saved;
  }

  async processThread(
    spaceId: string,
    threadId: string,
    userId: string
  ): Promise<{ extracted: number; saved: number }> {
    const extractedMemories = await this.extractFromThread(spaceId, threadId, userId);
    const saved = await this.saveMemories(spaceId, threadId, userId, extractedMemories);
    return { extracted: extractedMemories.length, saved };
  }
}

const AUTO_EXTRACT_INTERVAL = 10;

export function shouldAutoExtract(messageCount: number, lastExtractedCount: number): boolean {
  return messageCount - lastExtractedCount >= AUTO_EXTRACT_INTERVAL;
}
