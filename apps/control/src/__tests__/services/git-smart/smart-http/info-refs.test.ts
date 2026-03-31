import { handleInfoRefs } from '@/services/git-smart/smart-http/info-refs';
import { parsePktLines, pktLineText } from '@/services/git-smart/protocol/pkt-line';

// Mock refs and getDefaultBranch
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/refs'

import { listAllRefs, getDefaultBranch } from '@/services/git-smart/core/refs';
import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

const mockListAllRefs = listAllRefs;
const mockGetDefaultBranch = getDefaultBranch;

const ZERO_SHA = '0000000000000000000000000000000000000000';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);



  Deno.test('handleInfoRefs - returns zero-SHA capabilities line for empty repo', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockListAllRefs = (async () => []) as any;
    mockGetDefaultBranch = (async () => ({
      id: '1',
      repo_id: 'repo1',
      name: 'main',
      commit_sha: ZERO_SHA,
      is_default: true,
      is_protected: false,
      created_at: '',
      updated_at: '',
    })) as any;

    const result = await handleInfoRefs({} as any, 'repo1', 'git-upload-pack');
    const lines = parsePktLines(result);

    // service announcement + flush + capabilities line + flush
    assert(lines.length >= 4);

    // First data line is service announcement
    assertEquals(pktLineText(lines[0]), '# service=git-upload-pack');
    assertEquals(lines[1].type, 'flush');

    // Capabilities line with zero SHA
    const capsLine = pktLineText(lines[2]);
    assertStringIncludes(capsLine, ZERO_SHA);
    assertStringIncludes(capsLine, 'capabilities^{}');
    assertStringIncludes(capsLine, 'side-band-64k');

    // Final flush
    assertEquals(lines[3].type, 'flush');
})

  Deno.test('handleInfoRefs - returns HEAD first, then sorted refs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockListAllRefs = (async () => [
      { name: 'refs/heads/main', target: SHA_A, type: 'branch' as const },
      { name: 'refs/heads/develop', target: SHA_B, type: 'branch' as const },
    ]) as any;
    mockGetDefaultBranch = (async () => ({
      id: '1',
      repo_id: 'repo1',
      name: 'main',
      commit_sha: SHA_A,
      is_default: true,
      is_protected: false,
      created_at: '',
      updated_at: '',
    })) as any;

    const result = await handleInfoRefs({} as any, 'repo1', 'git-upload-pack');
    const lines = parsePktLines(result);

    // Skip service announcement + flush
    const dataLines = lines
      .filter(l => l.type === 'data')
      .map(l => pktLineText(l))
      .filter(t => !t.startsWith('#'));

    // First data line is HEAD with capabilities
    assertStringIncludes(dataLines[0], SHA_A);
    assertStringIncludes(dataLines[0], 'HEAD');
    assertStringIncludes(dataLines[0], 'side-band-64k');

    // Remaining refs sorted by name
    const refLines = dataLines.slice(1);
    const refNames = refLines.map(l => l.split(' ')[1]);
    assertEquals(refNames, [...refNames].sort());
})

  Deno.test('handleInfoRefs - uses receive-pack capabilities for git-receive-pack', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockListAllRefs = (async () => []) as any;
    mockGetDefaultBranch = (async () => null) as any;

    const result = await handleInfoRefs({} as any, 'repo1', 'git-receive-pack');
    const lines = parsePktLines(result);

    const capsLine = lines.find(l => l.type === 'data' && pktLineText(l).includes('report-status'));
    assert(capsLine !== undefined);
})

