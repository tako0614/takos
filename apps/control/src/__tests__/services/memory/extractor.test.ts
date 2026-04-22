import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { spy } from "jsr:@std/testing/mock";

const mocks = {
  getDb: ((..._args: any[]) => undefined) as any,
  chatAndParseJsonArray: ((..._args: any[]) => undefined) as any,
  LLMClient: ((..._args: any[]) => undefined) as any,
};

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent'
// [Deno] vi.mock removed - manually stub imports from '@/services/memory/helpers'
import {
  MemoryExtractor,
  memoryExtractorDeps,
  shouldAutoExtract,
} from "@/services/memory/extractor";

let extractorGetDb = memoryExtractorDeps.getDb;
let extractorChatAndParseJsonArray = memoryExtractorDeps.chatAndParseJsonArray;
let extractorLLMClient = memoryExtractorDeps.LLMClient;

Object.defineProperties(mocks, {
  getDb: {
    configurable: true,
    get: () => extractorGetDb,
    set: (value) => {
      extractorGetDb = value;
      memoryExtractorDeps.getDb = value as typeof memoryExtractorDeps.getDb;
    },
  },
  chatAndParseJsonArray: {
    configurable: true,
    get: () => extractorChatAndParseJsonArray,
    set: (value) => {
      extractorChatAndParseJsonArray = value;
      memoryExtractorDeps.chatAndParseJsonArray =
        value as typeof memoryExtractorDeps.chatAndParseJsonArray;
    },
  },
  LLMClient: {
    configurable: true,
    get: () => extractorLLMClient,
    set: (value) => {
      extractorLLMClient = value;
      let normalizedValue = value;
      if (
        typeof value === "function" &&
        !(value as { prototype?: unknown }).prototype
      ) {
        const factory = value as (options?: unknown) => unknown;
        normalizedValue = function MockLLMClient(
          this: unknown,
          options?: unknown,
        ) {
          return factory(options) as object;
        };
      }
      memoryExtractorDeps.LLMClient =
        normalizedValue as typeof memoryExtractorDeps.LLMClient;
    },
  },
});

mocks.getDb = memoryExtractorDeps.getDb as any;
mocks.chatAndParseJsonArray = memoryExtractorDeps.chatAndParseJsonArray as any;
mocks.LLMClient = memoryExtractorDeps.LLMClient as any;

Deno.test("shouldAutoExtract - returns true when message count exceeds threshold", () => {
  assertEquals(shouldAutoExtract(10, 0), true);
  assertEquals(shouldAutoExtract(20, 10), true);
  assertEquals(shouldAutoExtract(25, 10), true);
});
Deno.test("shouldAutoExtract - returns false when not enough new messages", () => {
  assertEquals(shouldAutoExtract(5, 0), false);
  assertEquals(shouldAutoExtract(9, 0), false);
  assertEquals(shouldAutoExtract(15, 10), false);
});
Deno.test("shouldAutoExtract - returns true at exactly the threshold", () => {
  assertEquals(shouldAutoExtract(10, 0), true);
  assertEquals(shouldAutoExtract(20, 10), true);
});

function createDrizzleMock() {
  const delegates = {
    all: (async (..._args: any[]) => undefined) as any,
    insert: spy(() => ({
      values: async () => undefined,
    })) as any,
  };
  const chain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    all: ((...args: any[]) => delegates.all(...args)) as any,
  };
  return {
    select: () => chain,
    insert: delegates.insert,
    _: delegates,
  };
}

Deno.test("MemoryExtractor - extractFromThread (pattern-based) - returns empty array when no messages found", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assertEquals(result, []);
});
Deno.test('MemoryExtractor - extractFromThread (pattern-based) - extracts "remember" pattern memories', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "remember this: my API key is xyz123" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assert(result.length > 0);
  assertEquals(result[0].type, "semantic");
  assertEquals(result[0].importance, 0.9);
});
Deno.test('MemoryExtractor - extractFromThread (pattern-based) - extracts "decision" pattern memories', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "We decided to use React for the frontend" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assert(result.length > 0);
  assertEquals(result[0].type, "episode");
  assertEquals(result[0].category, "decision");
});
Deno.test('MemoryExtractor - extractFromThread (pattern-based) - extracts "fact" pattern memories', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "My company is Acme Corp" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assert(result.length > 0);
  assertEquals(result[0].type, "semantic");
  assertEquals(result[0].category, "fact");
});
Deno.test('MemoryExtractor - extractFromThread (pattern-based) - extracts "preference" pattern memories', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "I always prefer TypeScript over JavaScript" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assert(result.length > 0);
  assertEquals(result[0].type, "procedural");
  assertEquals(result[0].category, "preference");
});
Deno.test("MemoryExtractor - extractFromThread (pattern-based) - skips assistant messages", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "assistant", content: "I decided to help you with this" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assertEquals(result, []);
});
Deno.test("MemoryExtractor - extractFromThread (pattern-based) - deduplicates similar extractions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "remember this: important note" },
    { role: "user", content: "remember this: important note again" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  // Should deduplicate based on first 50 chars of content
  assert(result.length <= 2);
});
Deno.test("MemoryExtractor - extractFromThread (pattern-based) - limits to 10 extractions", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const messages = Array.from({ length: 20 }, (_, i) => ({
    role: "user",
    content: `remember this: unique note number ${i}`,
  }));
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => messages) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assert(result.length <= 10);
});

Deno.test("MemoryExtractor - saveMemories - saves extracted memories to the database", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const insertMock = spy(() => ({
    values: async () => undefined,
  }));
  const drizzle = { insert: insertMock };
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const saved = await extractor.saveMemories("space-1", "thread-1", "user-1", [
    { type: "semantic", content: "test memory", importance: 0.8 },
  ]);

  assertEquals(saved, 1);
  assert(insertMock.calls.length > 0);
});
Deno.test("MemoryExtractor - saveMemories - continues on individual save failures", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  let insertCallCount = 0;
  const insertMock = spy(() => ({
    values: async () => {
      insertCallCount++;
      if (insertCallCount === 1) {
        throw new Error("DB error");
      }
    },
  }));
  const drizzle = { insert: insertMock };
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const saved = await extractor.saveMemories("space-1", "thread-1", "user-1", [
    { type: "semantic", content: "memory 1", importance: 0.8 },
    { type: "episode", content: "memory 2", importance: 0.7 },
  ]);

  assertEquals(saved, 1); // Only second one succeeded
});
Deno.test("MemoryExtractor - saveMemories - returns 0 for empty array", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const extractor = new MemoryExtractor({} as any);
  const saved = await extractor.saveMemories(
    "space-1",
    "thread-1",
    "user-1",
    [],
  );
  assertEquals(saved, 0);
});

Deno.test("MemoryExtractor - extractFromThread (LLM-based) - uses LLM extraction when apiKey is provided and LLM returns valid memories", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockLLMClient = { chat: ((..._args: any[]) => undefined) as any };
  mocks.LLMClient = () => mockLLMClient as any;

  const llmMemories = [
    {
      type: "semantic",
      content: "User works at Acme Corp",
      category: "user",
      importance: 0.8,
    },
    {
      type: "episode",
      content: "Decided to use React",
      category: "project",
      importance: 0.7,
    },
  ];
  mocks.chatAndParseJsonArray = (async () => llmMemories) as any;

  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    {
      role: "user",
      content: "I work at Acme Corp and we decided to use React",
    },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any, "test-api-key");
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assertEquals(result.length, 2);
  assertEquals(result[0].type, "semantic");
  assertEquals(result[0].content, "User works at Acme Corp");
  assertEquals(result[1].type, "episode");
});
Deno.test("MemoryExtractor - extractFromThread (LLM-based) - filters out invalid memories from LLM response", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockLLMClient = { chat: ((..._args: any[]) => undefined) as any };
  mocks.LLMClient = () => mockLLMClient as any;

  const llmMemories = [
    { type: "semantic", content: "Valid memory", importance: 0.8 },
    { type: "invalid_type", content: "Bad type", importance: 0.5 },
    { type: "episode", content: "", importance: 0.7 }, // empty content
    { type: "procedural", content: "Missing importance" }, // no importance
  ];
  mocks.chatAndParseJsonArray = (async () => llmMemories) as any;

  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "some message content here" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any, "test-api-key");
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assertEquals(result.length, 1);
  assertEquals(result[0].content, "Valid memory");
});
Deno.test("MemoryExtractor - extractFromThread (LLM-based) - falls back to pattern matching when LLM throws", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockLLMClient = { chat: ((..._args: any[]) => undefined) as any };
  mocks.LLMClient = () => mockLLMClient as any;
  mocks.chatAndParseJsonArray = (async () => {
    throw new Error("LLM API error");
  }) as any;

  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    {
      role: "user",
      content: "remember this: my preferred language is TypeScript",
    },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any, "test-api-key");
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  // Should fall back to pattern matching and find the "remember" pattern
  assert(result.length > 0);
  assertEquals(result[0].type, "semantic");
  assertEquals(result[0].importance, 0.9);
});
Deno.test("MemoryExtractor - extractFromThread (LLM-based) - returns empty when LLM returns null", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockLLMClient = { chat: ((..._args: any[]) => undefined) as any };
  mocks.LLMClient = () => mockLLMClient as any;
  mocks.chatAndParseJsonArray = (async () => null) as any;

  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "Hello, how are you?" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any, "test-api-key");
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assertEquals(result, []);
});

Deno.test("MemoryExtractor - processThread - combines extraction and saving, returning counts", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "remember this: my project uses Next.js" },
    { role: "user", content: "We decided to use PostgreSQL for the database" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.processThread("space-1", "thread-1", "user-1");

  assert(result.extracted > 0);
  assertEquals(result.saved, result.extracted);
});
Deno.test("MemoryExtractor - processThread - returns zero counts for empty thread", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => []) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.processThread("space-1", "thread-1", "user-1");

  assertEquals(result, { extracted: 0, saved: 0 });
});
Deno.test("MemoryExtractor - processThread - reports partial saves when some fail", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const allMock = async () => [
    {
      role: "user",
      content: "remember this: first important fact about the project",
    },
    { role: "user", content: "We decided to use a microservices architecture" },
  ];
  const selectChain = {
    from: function (this: any) {
      return this;
    },
    where: function (this: any) {
      return this;
    },
    orderBy: function (this: any) {
      return this;
    },
    limit: function (this: any) {
      return this;
    },
    all: allMock,
  };
  let insertCallCount = 0;
  const insertMock = spy(() => ({
    values: async () => {
      insertCallCount++;
      if (insertCallCount === 1) {
        throw new Error("DB error");
      }
    },
  }));
  const drizzle = {
    select: () => selectChain,
    insert: insertMock,
    _: { all: allMock },
  };
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.processThread("space-1", "thread-1", "user-1");

  assert(result.extracted > 0);
  // saved should be less than extracted since the first insert fails
  assert(result.saved < result.extracted);
});

Deno.test('MemoryExtractor - cleanMatch behavior - strips "remember this" pattern from content', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    {
      role: "user",
      content: "remember this: the database password is stored in vault",
    },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assertEquals(result.length, 1);
  // Content should have "remember this" stripped, leaving the actual info
  assert(!(/remember this/i).test(result[0].content));
  assertStringIncludes(
    result[0].content,
    "database password is stored in vault",
  );
});
Deno.test("MemoryExtractor - cleanMatch behavior - returns null when cleaned content is too short (below minCleanedLength)", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  // "remember this: hi" -> after stripping "remember this" and trimming, "hi" is 2 chars
  // minCleanedLength for REMEMBER_PATTERNS rule is 10
  drizzle._.all = (async () => [
    { role: "user", content: "remember this: hi" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  // Should not extract because cleaned content is too short
  assertEquals(result, []);
});
Deno.test("MemoryExtractor - cleanMatch behavior - strips leading colons and whitespace after pattern removal", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "remember this:   the API endpoint is /v2/users" },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assertEquals(result.length, 1);
  // Should not start with colon or extra spaces
  assert(!(/^[:\s]/).test(result[0].content));
  assertStringIncludes(result[0].content, "API endpoint is /v2/users");
});

Deno.test("MemoryExtractor - maxContentLength check in matchPatternRule - skips extraction when content exceeds maxContentLength for fact patterns", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // FACT_PATTERNS have maxContentLength: 200
  const drizzle = createDrizzleMock();
  const longContent = "My company is " + "x".repeat(200);
  drizzle._.all = (async () => [
    { role: "user", content: longContent },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  // Content is >= 200 chars, so fact pattern should not match
  assertEquals(result.filter((m) => m.category === "fact"), []);
});
Deno.test("MemoryExtractor - maxContentLength check in matchPatternRule - skips extraction when content exceeds maxContentLength for decision patterns", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // DECISION_PATTERNS have maxContentLength: 500
  const drizzle = createDrizzleMock();
  const longContent = "We decided to " + "x".repeat(500);
  drizzle._.all = (async () => [
    { role: "user", content: longContent },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  // Content is >= 500 chars, so decision pattern should not match
  assertEquals(result.filter((m) => m.category === "decision"), []);
});
Deno.test("MemoryExtractor - maxContentLength check in matchPatternRule - skips extraction when content exceeds maxContentLength for procedure patterns", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // PROCEDURE_PATTERNS have maxContentLength: 300
  const drizzle = createDrizzleMock();
  const longContent = "I always " + "x".repeat(300);
  drizzle._.all = (async () => [
    { role: "user", content: longContent },
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  // Content is >= 300 chars, so procedure pattern should not match
  assertEquals(result.filter((m) => m.category === "preference"), []);
});
Deno.test("MemoryExtractor - maxContentLength check in matchPatternRule - extracts when content is within maxContentLength", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
  drizzle._.all = (async () => [
    { role: "user", content: "My company is Acme Corp" }, // well under 200
  ]) as any;
  mocks.getDb = (() => drizzle) as any;

  const extractor = new MemoryExtractor({} as any);
  const result = await extractor.extractFromThread(
    "space-1",
    "thread-1",
    "user-1",
  );

  assert(result.length > 0);
  assertEquals(result[0].category, "fact");
});
