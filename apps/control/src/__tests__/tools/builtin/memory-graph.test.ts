import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// Mock claim-store
const mockSearchClaims = vi.fn();
const mockGetPathsForClaim = vi.fn();
const mockGetEvidenceForClaim = vi.fn();

vi.mock('@/services/memory-graph/claim-store', () => ({
  searchClaims: (...args: unknown[]) => mockSearchClaims(...args),
  getPathsForClaim: (...args: unknown[]) => mockGetPathsForClaim(...args),
  getEvidenceForClaim: (...args: unknown[]) => mockGetEvidenceForClaim(...args),
}));

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
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(),
    setLastContainerStartFailure: vi.fn(),
  };
}

describe('memory_graph_recall handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('claims mode', () => {
    it('returns matching claims', async () => {
      mockSearchClaims.mockResolvedValue([
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
      ]);

      const result = await memoryGraphRecallHandler(
        { query: 'TypeScript', mode: 'claims' },
        createMockContext(),
      );

      expect(result).toContain('Found 1 claims');
      expect(result).toContain('TypeScript');
      expect(result).toContain('0.90');
      expect(mockSearchClaims).toHaveBeenCalledWith(expect.anything(), 'space1', 'TypeScript', 10);
    });

    it('returns message when no claims found', async () => {
      mockSearchClaims.mockResolvedValue([]);

      const result = await memoryGraphRecallHandler(
        { query: 'nonexistent', mode: 'claims' },
        createMockContext(),
      );

      expect(result).toContain('No claims found');
    });
  });

  describe('path_search mode', () => {
    it('requires claim_id', async () => {
      const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'path_search' },
        createMockContext(),
      );

      expect(result).toContain('claim_id is required');
    });

    it('returns paths for a claim', async () => {
      mockGetPathsForClaim.mockResolvedValue([
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
      ]);

      const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'path_search', claim_id: 'c1' },
        createMockContext(),
      );

      expect(result).toContain('Found 1 paths');
      expect(result).toContain('2 hops');
      expect(result).toContain('supports -> depends_on');
    });
  });

  describe('evidence mode', () => {
    it('requires claim_id', async () => {
      const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'evidence' },
        createMockContext(),
      );

      expect(result).toContain('claim_id is required');
    });

    it('returns evidence for a claim', async () => {
      mockGetEvidenceForClaim.mockResolvedValue([
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
      ]);

      const result = await memoryGraphRecallHandler(
        { query: 'test', mode: 'evidence', claim_id: 'c1' },
        createMockContext(),
      );

      expect(result).toContain('Found 2 evidence');
      expect(result).toContain('[+]'); // supports
      expect(result).toContain('[-]'); // contradicts
      expect(result).toContain('[taint: tool_error]');
    });
  });
});
