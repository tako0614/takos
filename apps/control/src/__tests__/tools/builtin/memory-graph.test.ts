import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '@/types';

// Mock claim-store
import { assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockSearchClaims = ((..._args: any[]) => undefined) as any;
const mockGetPathsForClaim = ((..._args: any[]) => undefined) as any;
const mockGetEvidenceForClaim = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '@/services/memory-graph/claim-store'
import { memoryGraphRecallHandler } from '@/tools/builtin/memory-graph';

function createMockContext(): ToolContext {
  return {
    spaceId: 'space1',
    threadId: 'thread1',
    runId: 'run1',
    userId: 'user1',
    capabilities: [],
    env: {} as Env,
    db: {} as D1Database,
    setSessionId: ((..._args: any[]) => undefined) as any,
    getLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
    setLastContainerStartFailure: ((..._args: any[]) => undefined) as any,
  };
}


  
    Deno.test('memory_graph_recall handler - claims mode - returns matching claims', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSearchClaims = (async () => [
        {
          id: 'claim1',
          accountId: 'space1',
          claimType: 'fact',
          subject: 'TypeScript',
          predicate: 'is',
          object: 'preferred',
          confidence: 0.9,
          status: 'active',
          supersededBy: null,
          sourceRunId: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      ]) as any;

      const result = await memoryGraphRecallHandler(
        { query: 'TypeScript', mode: 'claims' },
        createMockContext(),
      );

      assertStringIncludes(result, 'Found 1 claims');
      assertStringIncludes(result, 'TypeScript');
      assertStringIncludes(result, '0.90');
      assertSpyCallArgs(mockSearchClaims, 0, [expect.anything(), 'space1', 'TypeScript', 10]);
})
    Deno.test('memory_graph_recall handler - claims mode - returns message when no claims found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockSearchClaims = (async () => []) as any;

      const result = await memoryGraphRecallHandler(
        { query: 'nonexistent', mode: 'claims' },
        createMockContext(),
      );

      assertStringIncludes(result, 'No claims found');
})  
  
    Deno.test('memory_graph_recall handler - path_search mode - requires claim_id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'path_search' },
        createMockContext(),
      );

      assertStringIncludes(result, 'claim_id is required');
})
    Deno.test('memory_graph_recall handler - path_search mode - returns paths for a claim', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGetPathsForClaim = (async () => [
        {
          id: 'p1',
          accountId: 'space1',
          startClaimId: 'c1',
          endClaimId: 'c2',
          hopCount: 2,
          pathClaims: ['c1', 'c_mid', 'c2'],
          pathRelations: ['supports', 'depends_on'],
          pathSummary: null,
          minConfidence: 0.85,
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]) as any;

      const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'path_search', claim_id: 'c1' },
        createMockContext(),
      );

      assertStringIncludes(result, 'Found 1 paths');
      assertStringIncludes(result, '2 hops');
      assertStringIncludes(result, 'supports -> depends_on');
})  
  
    Deno.test('memory_graph_recall handler - evidence mode - requires claim_id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'evidence' },
        createMockContext(),
      );

      assertStringIncludes(result, 'claim_id is required');
})
    Deno.test('memory_graph_recall handler - evidence mode - returns evidence for a claim', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockGetEvidenceForClaim = (async () => [
        {
          id: 'e1',
          accountId: 'space1',
          claimId: 'c1',
          kind: 'supports',
          sourceType: 'tool_result',
          sourceRef: 'remember:run1',
          content: 'User stated they prefer TypeScript',
          trust: 0.9,
          taint: null,
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'e2',
          accountId: 'space1',
          claimId: 'c1',
          kind: 'contradicts',
          sourceType: 'tool_result',
          sourceRef: null,
          content: 'Found Python files in project',
          trust: 0.3,
          taint: 'tool_error',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]) as any;

      const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'evidence', claim_id: 'c1' },
        createMockContext(),
      );

      assertStringIncludes(result, 'Found 2 evidence');
      assertStringIncludes(result, '[+]'); // supports
      assertStringIncludes(result, '[-]'); // contradicts
      assertStringIncludes(result, '[taint: tool_error]');
})  