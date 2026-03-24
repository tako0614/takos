import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleInfoRefs } from '@/services/git-smart/smart-http/info-refs';
import { parsePktLines, pktLineText } from '@/services/git-smart/protocol/pkt-line';

// Mock refs and getDefaultBranch
vi.mock('@/services/git-smart/core/refs', () => ({
  listAllRefs: vi.fn(),
  getDefaultBranch: vi.fn(),
}));

import { listAllRefs, getDefaultBranch } from '@/services/git-smart/core/refs';
const mockListAllRefs = vi.mocked(listAllRefs);
const mockGetDefaultBranch = vi.mocked(getDefaultBranch);

const ZERO_SHA = '0000000000000000000000000000000000000000';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

describe('handleInfoRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zero-SHA capabilities line for empty repo', async () => {
    mockListAllRefs.mockResolvedValue([]);
    mockGetDefaultBranch.mockResolvedValue({
      id: '1',
      repo_id: 'repo1',
      name: 'main',
      commit_sha: ZERO_SHA,
      is_default: true,
      is_protected: false,
      created_at: '',
      updated_at: '',
    });

    const result = await handleInfoRefs({} as any, 'repo1', 'git-upload-pack');
    const lines = parsePktLines(result);

    // service announcement + flush + capabilities line + flush
    expect(lines.length).toBeGreaterThanOrEqual(4);

    // First data line is service announcement
    expect(pktLineText(lines[0])).toBe('# service=git-upload-pack');
    expect(lines[1].type).toBe('flush');

    // Capabilities line with zero SHA
    const capsLine = pktLineText(lines[2]);
    expect(capsLine).toContain(ZERO_SHA);
    expect(capsLine).toContain('capabilities^{}');
    expect(capsLine).toContain('side-band-64k');

    // Final flush
    expect(lines[3].type).toBe('flush');
  });

  it('returns HEAD first, then sorted refs', async () => {
    mockListAllRefs.mockResolvedValue([
      { name: 'refs/heads/main', target: SHA_A, type: 'branch' as const },
      { name: 'refs/heads/develop', target: SHA_B, type: 'branch' as const },
    ]);
    mockGetDefaultBranch.mockResolvedValue({
      id: '1',
      repo_id: 'repo1',
      name: 'main',
      commit_sha: SHA_A,
      is_default: true,
      is_protected: false,
      created_at: '',
      updated_at: '',
    });

    const result = await handleInfoRefs({} as any, 'repo1', 'git-upload-pack');
    const lines = parsePktLines(result);

    // Skip service announcement + flush
    const dataLines = lines
      .filter(l => l.type === 'data')
      .map(l => pktLineText(l))
      .filter(t => !t.startsWith('#'));

    // First data line is HEAD with capabilities
    expect(dataLines[0]).toContain(SHA_A);
    expect(dataLines[0]).toContain('HEAD');
    expect(dataLines[0]).toContain('side-band-64k');

    // Remaining refs sorted by name
    const refLines = dataLines.slice(1);
    const refNames = refLines.map(l => l.split(' ')[1]);
    expect(refNames).toEqual([...refNames].sort());
  });

  it('uses receive-pack capabilities for git-receive-pack', async () => {
    mockListAllRefs.mockResolvedValue([]);
    mockGetDefaultBranch.mockResolvedValue(null);

    const result = await handleInfoRefs({} as any, 'repo1', 'git-receive-pack');
    const lines = parsePktLines(result);

    const capsLine = lines.find(l => l.type === 'data' && pktLineText(l).includes('report-status'));
    expect(capsLine).toBeDefined();
  });
});
