import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleReceivePack, handleReceivePackFromStream, readReceivePackStream, tryParsePktLineCommands } from '@/services/git-smart/smart-http/receive-pack';
import { encodePktLine, flushPkt, parsePktLines, pktLineText } from '@/services/git-smart/protocol/pkt-line';
import { concatBytes } from '@/services/git-smart/core/sha1';

const ZERO_SHA = '0000000000000000000000000000000000000000';
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

// Mock dependencies
vi.mock('@/services/git-smart/protocol/packfile-reader', () => ({
  readPackfileAsync: vi.fn(),
}));

vi.mock('@/services/git-smart/core/commit-index', () => ({
  indexCommit: vi.fn(),
  getCommit: vi.fn(),
  isAncestor: vi.fn(),
}));

vi.mock('@/services/git-smart/core/refs', () => ({
  updateBranch: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  getBranch: vi.fn(),
  isValidRefName: vi.fn(),
}));

import { readPackfileAsync } from '@/services/git-smart/protocol/packfile-reader';
import { indexCommit, getCommit, isAncestor } from '@/services/git-smart/core/commit-index';
import { updateBranch, createBranch, deleteBranch, createTag, deleteTag, getBranch, isValidRefName } from '@/services/git-smart/core/refs';

const mockReadPackfile = vi.mocked(readPackfileAsync);
const mockIndexCommit = vi.mocked(indexCommit);
const mockGetCommit = vi.mocked(getCommit);
const mockIsAncestor = vi.mocked(isAncestor);
const mockUpdateBranch = vi.mocked(updateBranch);
const mockCreateBranch = vi.mocked(createBranch);
const mockDeleteBranch = vi.mocked(deleteBranch);
const mockCreateTag = vi.mocked(createTag);
const mockDeleteTag = vi.mocked(deleteTag);
const mockGetBranch = vi.mocked(getBranch);
const mockIsValidRefName = vi.mocked(isValidRefName);

function buildReceiveBody(commands: string[], includePackfile = false): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const cmd of commands) {
    parts.push(encodePktLine(cmd + '\n'));
  }
  parts.push(flushPkt());

  if (includePackfile) {
    // Minimal valid packfile: PACK + version 2 + 0 objects + SHA-1 trailer
    const packHeader = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0, 0, 0, 2,             // version 2
      0, 0, 0, 0,             // 0 objects
    ]);
    // Add a fake 20-byte checksum (not validated in our mock path)
    const fakeChecksum = new Uint8Array(20);
    parts.push(packHeader, fakeChecksum);
  }

  return concatBytes(...parts);
}

function parseReportStatus(response: Uint8Array): { unpack: string; refs: Array<{ name: string; status: string }> } {
  // Response is side-band-64k framed. Extract channel 1 data.
  const outerLines = parsePktLines(response);
  const statusData: Uint8Array[] = [];
  for (const line of outerLines) {
    if (line.type === 'data' && line.data && line.data[0] === 1) {
      statusData.push(line.data.subarray(1));
    }
  }

  const combined = concatBytes(...statusData);
  const innerLines = parsePktLines(combined);
  const texts = innerLines.filter(l => l.type === 'data').map(l => pktLineText(l));

  const unpack = texts[0]?.replace(/^unpack /, '') || '';
  const refs = texts.slice(1).map(t => {
    if (t.startsWith('ok ')) {
      return { name: t.slice(3), status: 'ok' };
    }
    // "ng <ref> <reason>"
    const match = t.match(/^ng (\S+) (.+)$/);
    if (match) {
      return { name: match[1], status: match[2] };
    }
    return { name: t, status: 'unknown' };
  });

  return { unpack, refs };
}

describe('handleReceivePack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadPackfile.mockResolvedValue([]);
    mockGetCommit.mockResolvedValue(null);
    mockIndexCommit.mockResolvedValue(undefined);
    mockIsAncestor.mockResolvedValue(true);
    mockIsValidRefName.mockReturnValue(true);
    mockGetBranch.mockResolvedValue(null);
  });

  it('returns ok with empty refs for 0 commands', async () => {
    const body = flushPkt(); // just flush, no commands
    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toEqual([]);
    const status = parseReportStatus(response);
    expect(status.unpack).toBe('ok');
    expect(status.refs).toHaveLength(0);
  });

  it('rejects when ref count exceeds limit', async () => {
    const commands: string[] = [];
    for (let i = 0; i < 51; i++) {
      commands.push(`${ZERO_SHA} ${SHA_A} refs/heads/branch-${i}`);
    }
    const body = buildReceiveBody(commands);

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toEqual([]);
    const status = parseReportStatus(response);
    expect(status.unpack).toBe('too many ref updates');
  });

  it('rejects when object count exceeds limit', async () => {
    const commands = [`${ZERO_SHA} ${SHA_A} refs/heads/main`];
    const parts: Uint8Array[] = [];
    for (const cmd of commands) {
      parts.push(encodePktLine(cmd + '\n'));
    }
    parts.push(flushPkt());

    const packHeader = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0, 0, 0, 2,             // version 2
      0, 0x03, 0x0D, 0x41,    // 200001 objects
    ]);
    const fakeChecksum = new Uint8Array(20);
    parts.push(packHeader, fakeChecksum);

    const body = concatBytes(...parts);
    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toEqual([]);
    const status = parseReportStatus(response);
    expect(status.unpack).toBe('too many objects');
  });

  it('creates branch successfully', async () => {
    mockCreateBranch.mockResolvedValue({ success: true });

    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/heads/feature`],
      true,
    );

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(1);
    expect(updatedRefs[0].refName).toBe('refs/heads/feature');
    const status = parseReportStatus(response);
    expect(status.unpack).toBe('ok');
    expect(status.refs[0].status).toBe('ok');
  });

  it('updates branch with CAS when fast-forward', async () => {
    mockGetBranch.mockResolvedValue({
      id: '1', repo_id: 'repo1', name: 'main', commit_sha: SHA_A,
      is_default: true, is_protected: false, created_at: '', updated_at: '',
    });
    mockIsAncestor.mockResolvedValue(true);
    mockUpdateBranch.mockResolvedValue({ success: true });

    const body = buildReceiveBody(
      [`${SHA_A} ${SHA_B} refs/heads/main`],
      true,
    );

    const { updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(1);
    expect(mockIsAncestor).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'repo1', SHA_A, SHA_B,
    );
    expect(mockUpdateBranch).toHaveBeenCalledWith(
      expect.anything(), 'repo1', 'main', SHA_A, SHA_B,
    );
  });

  it('rejects non-fast-forward branch update', async () => {
    mockGetBranch.mockResolvedValue({
      id: '1', repo_id: 'repo1', name: 'main', commit_sha: SHA_A,
      is_default: false, is_protected: false, created_at: '', updated_at: '',
    });
    mockIsAncestor.mockResolvedValue(false);

    const body = buildReceiveBody(
      [`${SHA_A} ${SHA_B} refs/heads/main`],
      true,
    );

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(0);
    expect(mockUpdateBranch).not.toHaveBeenCalled();
    const status = parseReportStatus(response);
    expect(status.refs[0].status).toContain('non-fast-forward');
  });

  it('rejects push to protected branch', async () => {
    mockGetBranch.mockResolvedValue({
      id: '1', repo_id: 'repo1', name: 'main', commit_sha: SHA_A,
      is_default: true, is_protected: true, created_at: '', updated_at: '',
    });

    const body = buildReceiveBody(
      [`${SHA_A} ${SHA_B} refs/heads/main`],
      true,
    );

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(0);
    expect(mockUpdateBranch).not.toHaveBeenCalled();
    expect(mockIsAncestor).not.toHaveBeenCalled();
    const status = parseReportStatus(response);
    expect(status.refs[0].status).toContain('protected branch');
  });

  it('rejects invalid ref name', async () => {
    mockIsValidRefName.mockReturnValue(false);

    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/heads/bad..name`],
      true,
    );

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(0);
    const status = parseReportStatus(response);
    expect(status.refs[0].status).toContain('invalid ref name');
  });

  it('rejects invalid tag name', async () => {
    mockIsValidRefName.mockReturnValue(false);

    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/tags/bad~name`],
      true,
    );

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(0);
    const status = parseReportStatus(response);
    expect(status.refs[0].status).toContain('invalid ref name');
  });

  it('deletes branch', async () => {
    mockDeleteBranch.mockResolvedValue({ success: true });

    const body = buildReceiveBody(
      [`${SHA_A} ${ZERO_SHA} refs/heads/old-branch`],
    );

    const { updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(1);
    expect(mockDeleteBranch).toHaveBeenCalledWith(expect.anything(), 'repo1', 'old-branch');
  });

  it('creates tag', async () => {
    mockCreateTag.mockResolvedValue({ success: true });

    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/tags/v1.0`],
      true,
    );

    const { updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(1);
    expect(mockCreateTag).toHaveBeenCalledWith(expect.anything(), 'repo1', 'v1.0', SHA_A);
  });

  it('deletes tag', async () => {
    mockDeleteTag.mockResolvedValue({ success: true });

    const body = buildReceiveBody(
      [`${SHA_A} ${ZERO_SHA} refs/tags/v0.9`],
    );

    const { updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(1);
    expect(mockDeleteTag).toHaveBeenCalledWith(expect.anything(), 'repo1', 'v0.9');
  });

  it('rejects when packfile size exceeds limit', async () => {
    const commands = [`${ZERO_SHA} ${SHA_A} refs/heads/main`];
    const parts: Uint8Array[] = [];
    for (const cmd of commands) {
      parts.push(encodePktLine(cmd + '\n'));
    }
    parts.push(flushPkt());

    const packHeader = new Uint8Array([
      0x50, 0x41, 0x43, 0x4b, // PACK
      0, 0, 0, 2,             // version 2
      0, 0, 0, 1,             // 1 object
    ]);
    const fakeData = new Uint8Array(90 * 1024 * 1024 + 1);
    fakeData.set(packHeader);
    parts.push(fakeData);

    const body = concatBytes(...parts);
    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toEqual([]);
    const status = parseReportStatus(response);
    expect(status.unpack).toBe('packfile too large');
    expect(status.refs[0].status).toContain('packfile-size limit exceeded');
  });

  it('reports error on packfile unpack failure', async () => {
    mockReadPackfile.mockRejectedValue(new Error('Pack object count 999 exceeds limit of 100'));

    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/heads/main`],
      true,
    );

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toEqual([]);
    const status = parseReportStatus(response);
    expect(status.unpack).toContain('Pack object count 999 exceeds limit');
    expect(status.refs[0].status).toContain('ng');
  });

  it('reports ng for unsupported ref type', async () => {
    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/notes/commits`],
      true,
    );

    const { response, updatedRefs } = await handleReceivePack({} as any, {} as any, 'repo1', body);

    expect(updatedRefs).toHaveLength(0);
    const status = parseReportStatus(response);
    expect(status.refs[0].status).toContain('unsupported ref type');
  });
});

// --- Streaming tests ---

function toStream(data: Uint8Array, chunkSize = 64): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, data.length);
      controller.enqueue(data.subarray(offset, end));
      offset = end;
    },
  });
}

describe('tryParsePktLineCommands', () => {
  it('returns null when buffer has incomplete data', () => {
    const partial = new TextEncoder().encode('00'); // incomplete hex prefix
    expect(tryParsePktLineCommands(partial)).toBeNull();
  });

  it('parses commands up to flush and returns endOffset', () => {
    const body = concatBytes(
      encodePktLine(`${ZERO_SHA} ${SHA_A} refs/heads/main\n`),
      flushPkt(),
    );
    const result = tryParsePktLineCommands(body);
    expect(result).not.toBeNull();
    expect(result!.commands).toHaveLength(1);
    expect(result!.commands[0].refName).toBe('refs/heads/main');
    expect(result!.endOffset).toBe(body.length);
  });

  it('returns null when no flush packet is found', () => {
    const body = encodePktLine(`${ZERO_SHA} ${SHA_A} refs/heads/main\n`);
    expect(tryParsePktLineCommands(body)).toBeNull();
  });
});

describe('readReceivePackStream', () => {
  it('parses commands and packfile from stream', async () => {
    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/heads/feature`],
      true,
    );

    const stream = toStream(body, 32);
    const { commands, packfileData } = await readReceivePackStream(stream, 1024 * 1024);

    expect(commands).toHaveLength(1);
    expect(commands[0].refName).toBe('refs/heads/feature');
    expect(packfileData).not.toBeNull();
    expect(packfileData!.length).toBeGreaterThan(0);
    // Verify packfile signature
    const sig = new TextDecoder().decode(packfileData!.subarray(0, 4));
    expect(sig).toBe('PACK');
  });

  it('handles delete-only push without packfile', async () => {
    const body = buildReceiveBody(
      [`${SHA_A} ${ZERO_SHA} refs/heads/old`],
      false,
    );

    const stream = toStream(body, 16);
    const { commands, packfileData } = await readReceivePackStream(stream, 1024 * 1024);

    expect(commands).toHaveLength(1);
    expect(packfileData).toBeNull();
  });

  it('throws when stream exceeds byte limit', async () => {
    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/heads/main`],
      true,
    );

    const stream = toStream(body, 16);
    await expect(
      readReceivePackStream(stream, 10), // tiny limit
    ).rejects.toThrow(/exceeds limit/);
  });

  it('parses multiple commands from stream', async () => {
    const body = buildReceiveBody([
      `${ZERO_SHA} ${SHA_A} refs/heads/feature-1`,
      `${ZERO_SHA} ${SHA_B} refs/heads/feature-2`,
    ], true);

    const stream = toStream(body, 50);
    const { commands } = await readReceivePackStream(stream, 1024 * 1024);

    expect(commands).toHaveLength(2);
    expect(commands[0].refName).toBe('refs/heads/feature-1');
    expect(commands[1].refName).toBe('refs/heads/feature-2');
  });
});

describe('handleReceivePackFromStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadPackfile.mockResolvedValue([]);
    mockGetCommit.mockResolvedValue(null);
    mockIndexCommit.mockResolvedValue(undefined);
    mockIsAncestor.mockResolvedValue(true);
    mockIsValidRefName.mockReturnValue(true);
    mockGetBranch.mockResolvedValue(null);
  });

  it('creates branch via streaming path', async () => {
    mockCreateBranch.mockResolvedValue({ success: true });

    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/heads/stream-feature`],
      true,
    );

    const stream = toStream(body, 48);
    const { response, updatedRefs } = await handleReceivePackFromStream(
      {} as any, {} as any, 'repo1', stream, 1024 * 1024,
    );

    expect(updatedRefs).toHaveLength(1);
    expect(updatedRefs[0].refName).toBe('refs/heads/stream-feature');
    const status = parseReportStatus(response);
    expect(status.unpack).toBe('ok');
  });

  it('rejects when stream body exceeds maxBodyBytes', async () => {
    const body = buildReceiveBody(
      [`${ZERO_SHA} ${SHA_A} refs/heads/main`],
      true,
    );

    const stream = toStream(body, 16);
    await expect(
      handleReceivePackFromStream({} as any, {} as any, 'repo1', stream, 10),
    ).rejects.toThrow(/exceeds limit/);
  });
});
