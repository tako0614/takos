import {
  handleReceivePack,
  handleReceivePackFromStream,
  readReceivePackStream,
  tryParsePktLineCommands,
} from "@/services/git-smart/smart-http/receive-pack";
import {
  encodePktLine,
  flushPkt,
  parsePktLines,
  pktLineText,
} from "@/services/git-smart/protocol/pkt-line";
import { concatBytes } from "@/services/git-smart/core/sha1";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls } from "jsr:@std/testing/mock";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

// Mock dependencies
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/protocol/packfile-reader'

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/commit-index'

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/refs'

import { readPackfileAsync } from "@/services/git-smart/protocol/packfile-reader";
import {
  getCommit,
  indexCommit,
  isAncestor,
} from "@/services/git-smart/core/commit-index";
import {
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  getBranch,
  isValidRefName,
  updateBranch,
} from "@/services/git-smart/core/refs";

const mockReadPackfile = readPackfileAsync;
const mockIndexCommit = indexCommit;
const mockGetCommit = getCommit;
const mockIsAncestor = isAncestor;
const mockUpdateBranch = updateBranch;
const mockCreateBranch = createBranch;
const mockDeleteBranch = deleteBranch;
const mockCreateTag = createTag;
const mockDeleteTag = deleteTag;
const mockGetBranch = getBranch;
const mockIsValidRefName = isValidRefName;

function buildReceiveBody(
  commands: string[],
  includePackfile = false,
): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const cmd of commands) {
    parts.push(encodePktLine(cmd + "\n"));
  }
  parts.push(flushPkt());

  if (includePackfile) {
    // Minimal valid packfile: PACK + version 2 + 0 objects + SHA-1 trailer
    const packHeader = new Uint8Array([
      0x50,
      0x41,
      0x43,
      0x4b, // PACK
      0,
      0,
      0,
      2, // version 2
      0,
      0,
      0,
      0, // 0 objects
    ]);
    // Add a fake 20-byte checksum (not validated in our mock path)
    const fakeChecksum = new Uint8Array(20);
    parts.push(packHeader, fakeChecksum);
  }

  return concatBytes(...parts);
}

function parseReportStatus(
  response: Uint8Array,
): { unpack: string; refs: Array<{ name: string; status: string }> } {
  // Response is side-band-64k framed. Extract channel 1 data.
  const outerLines = parsePktLines(response);
  const statusData: Uint8Array[] = [];
  for (const line of outerLines) {
    if (line.type === "data" && line.data && line.data[0] === 1) {
      statusData.push(line.data.subarray(1));
    }
  }

  const combined = concatBytes(...statusData);
  const innerLines = parsePktLines(combined);
  const texts = innerLines.filter((l) => l.type === "data").map((l) =>
    pktLineText(l)
  );

  const unpack = texts[0]?.replace(/^unpack /, "") || "";
  const refs = texts.slice(1).map((t) => {
    if (t.startsWith("ok ")) {
      return { name: t.slice(3), status: "ok" };
    }
    // "ng <ref> <reason>"
    const match = t.match(/^ng (\S+) (.+)$/);
    if (match) {
      return { name: match[1], status: match[2] };
    }
    return { name: t, status: "unknown" };
  });

  return { unpack, refs };
}

Deno.test("handleReceivePack - returns ok with empty refs for 0 commands", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  const body = flushPkt(); // just flush, no commands
  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs, []);
  const status = parseReportStatus(response);
  assertEquals(status.unpack, "ok");
  assertEquals(status.refs.length, 0);
});

Deno.test("handleReceivePack - rejects when ref count exceeds limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  const commands: string[] = [];
  for (let i = 0; i < 51; i++) {
    commands.push(`${ZERO_SHA} ${SHA_A} refs/heads/branch-${i}`);
  }
  const body = buildReceiveBody(commands);

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs, []);
  const status = parseReportStatus(response);
  assertEquals(status.unpack, "too many ref updates");
});

Deno.test("handleReceivePack - rejects when object count exceeds limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  const commands = [`${ZERO_SHA} ${SHA_A} refs/heads/main`];
  const parts: Uint8Array[] = [];
  for (const cmd of commands) {
    parts.push(encodePktLine(cmd + "\n"));
  }
  parts.push(flushPkt());

  const packHeader = new Uint8Array([
    0x50,
    0x41,
    0x43,
    0x4b, // PACK
    0,
    0,
    0,
    2, // version 2
    0,
    0x03,
    0x0D,
    0x41, // 200001 objects
  ]);
  const fakeChecksum = new Uint8Array(20);
  parts.push(packHeader, fakeChecksum);

  const body = concatBytes(...parts);
  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs, []);
  const status = parseReportStatus(response);
  assertEquals(status.unpack, "too many objects");
});

Deno.test("handleReceivePack - creates branch successfully", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockCreateBranch = (async () => ({ success: true })) as any;

  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/heads/feature`],
    true,
  );

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 1);
  assertEquals(updatedRefs[0].refName, "refs/heads/feature");
  const status = parseReportStatus(response);
  assertEquals(status.unpack, "ok");
  assertEquals(status.refs[0].status, "ok");
});

Deno.test("handleReceivePack - updates branch with CAS when fast-forward", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockGetBranch = (async () => ({
    id: "1",
    repo_id: "repo1",
    name: "main",
    commit_sha: SHA_A,
    is_default: true,
    is_protected: false,
    created_at: "",
    updated_at: "",
  })) as any;
  mockIsAncestor = (async () => true) as any;
  mockUpdateBranch = (async () => ({ success: true })) as any;

  const body = buildReceiveBody(
    [`${SHA_A} ${SHA_B} refs/heads/main`],
    true,
  );

  const { updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 1);
  assertSpyCallArgs(mockIsAncestor, 0, [
    expect.anything(),
    expect.anything(),
    "repo1",
    SHA_A,
    SHA_B,
  ]);
  assertSpyCallArgs(mockUpdateBranch, 0, [
    expect.anything(),
    "repo1",
    "main",
    SHA_A,
    SHA_B,
  ]);
});

Deno.test("handleReceivePack - rejects non-fast-forward branch update", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockGetBranch = (async () => ({
    id: "1",
    repo_id: "repo1",
    name: "main",
    commit_sha: SHA_A,
    is_default: false,
    is_protected: false,
    created_at: "",
    updated_at: "",
  })) as any;
  mockIsAncestor = (async () => false) as any;

  const body = buildReceiveBody(
    [`${SHA_A} ${SHA_B} refs/heads/main`],
    true,
  );

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 0);
  assertSpyCalls(mockUpdateBranch, 0);
  const status = parseReportStatus(response);
  assertStringIncludes(status.refs[0].status, "non-fast-forward");
});

Deno.test("handleReceivePack - rejects push to protected branch", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockGetBranch = (async () => ({
    id: "1",
    repo_id: "repo1",
    name: "main",
    commit_sha: SHA_A,
    is_default: true,
    is_protected: true,
    created_at: "",
    updated_at: "",
  })) as any;

  const body = buildReceiveBody(
    [`${SHA_A} ${SHA_B} refs/heads/main`],
    true,
  );

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 0);
  assertSpyCalls(mockUpdateBranch, 0);
  assertSpyCalls(mockIsAncestor, 0);
  const status = parseReportStatus(response);
  assertStringIncludes(status.refs[0].status, "protected branch");
});

Deno.test("handleReceivePack - rejects invalid ref name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockIsValidRefName = (() => false) as any;

  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/heads/bad..name`],
    true,
  );

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 0);
  const status = parseReportStatus(response);
  assertStringIncludes(status.refs[0].status, "invalid ref name");
});

Deno.test("handleReceivePack - rejects invalid tag name", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockIsValidRefName = (() => false) as any;

  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/tags/bad~name`],
    true,
  );

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 0);
  const status = parseReportStatus(response);
  assertStringIncludes(status.refs[0].status, "invalid ref name");
});

Deno.test("handleReceivePack - deletes branch", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockDeleteBranch = (async () => ({ success: true })) as any;

  const body = buildReceiveBody(
    [`${SHA_A} ${ZERO_SHA} refs/heads/old-branch`],
  );

  const { updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 1);
  assertSpyCallArgs(mockDeleteBranch, 0, [
    expect.anything(),
    "repo1",
    "old-branch",
  ]);
});

Deno.test("handleReceivePack - creates tag", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockCreateTag = (async () => ({ success: true })) as any;

  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/tags/v1.0`],
    true,
  );

  const { updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 1);
  assertSpyCallArgs(mockCreateTag, 0, [
    expect.anything(),
    "repo1",
    "v1.0",
    SHA_A,
  ]);
});

Deno.test("handleReceivePack - deletes tag", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockDeleteTag = (async () => ({ success: true })) as any;

  const body = buildReceiveBody(
    [`${SHA_A} ${ZERO_SHA} refs/tags/v0.9`],
  );

  const { updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 1);
  assertSpyCallArgs(mockDeleteTag, 0, [expect.anything(), "repo1", "v0.9"]);
});

Deno.test("handleReceivePack - rejects when packfile size exceeds limit", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  const commands = [`${ZERO_SHA} ${SHA_A} refs/heads/main`];
  const parts: Uint8Array[] = [];
  for (const cmd of commands) {
    parts.push(encodePktLine(cmd + "\n"));
  }
  parts.push(flushPkt());

  const packHeader = new Uint8Array([
    0x50,
    0x41,
    0x43,
    0x4b, // PACK
    0,
    0,
    0,
    2, // version 2
    0,
    0,
    0,
    1, // 1 object
  ]);
  const fakeData = new Uint8Array(90 * 1024 * 1024 + 1);
  fakeData.set(packHeader);
  parts.push(fakeData);

  const body = concatBytes(...parts);
  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs, []);
  const status = parseReportStatus(response);
  assertEquals(status.unpack, "packfile too large");
  assertStringIncludes(status.refs[0].status, "packfile-size limit exceeded");
});

Deno.test("handleReceivePack - reports error on packfile unpack failure", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockReadPackfile = (async () => {
    throw new Error("Pack object count 999 exceeds limit of 100");
  }) as any;

  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/heads/main`],
    true,
  );

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs, []);
  const status = parseReportStatus(response);
  assertStringIncludes(status.unpack, "Pack object count 999 exceeds limit");
  assertStringIncludes(status.refs[0].status, "ng");
});

Deno.test("handleReceivePack - reports ng for unsupported ref type", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/notes/commits`],
    true,
  );

  const { response, updatedRefs } = await handleReceivePack(
    {} as any,
    {} as any,
    "repo1",
    body,
  );

  assertEquals(updatedRefs.length, 0);
  const status = parseReportStatus(response);
  assertStringIncludes(status.refs[0].status, "unsupported ref type");
});

// --- Streaming tests ---

function toStream(
  data: Uint8Array,
  chunkSize = 64,
): ReadableStream<Uint8Array> {
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

Deno.test("tryParsePktLineCommands - returns null when buffer has incomplete data", () => {
  const partial = new TextEncoder().encode("00"); // incomplete hex prefix
  assertEquals(tryParsePktLineCommands(partial), null);
});

Deno.test("tryParsePktLineCommands - parses commands up to flush and returns endOffset", () => {
  const body = concatBytes(
    encodePktLine(`${ZERO_SHA} ${SHA_A} refs/heads/main\n`),
    flushPkt(),
  );
  const result = tryParsePktLineCommands(body);
  assertNotEquals(result, null);
  assertEquals(result!.commands.length, 1);
  assertEquals(result!.commands[0].refName, "refs/heads/main");
  assertEquals(result!.endOffset, body.length);
});

Deno.test("tryParsePktLineCommands - returns null when no flush packet is found", () => {
  const body = encodePktLine(`${ZERO_SHA} ${SHA_A} refs/heads/main\n`);
  assertEquals(tryParsePktLineCommands(body), null);
});

Deno.test("readReceivePackStream - parses commands and packfile from stream", async () => {
  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/heads/feature`],
    true,
  );

  const stream = toStream(body, 32);
  const { commands, packfileData } = await readReceivePackStream(
    stream,
    1024 * 1024,
  );

  assertEquals(commands.length, 1);
  assertEquals(commands[0].refName, "refs/heads/feature");
  assertNotEquals(packfileData, null);
  assert(packfileData!.length > 0);
  // Verify packfile signature
  const sig = new TextDecoder().decode(packfileData!.subarray(0, 4));
  assertEquals(sig, "PACK");
});

Deno.test("readReceivePackStream - handles delete-only push without packfile", async () => {
  const body = buildReceiveBody(
    [`${SHA_A} ${ZERO_SHA} refs/heads/old`],
    false,
  );

  const stream = toStream(body, 16);
  const { commands, packfileData } = await readReceivePackStream(
    stream,
    1024 * 1024,
  );

  assertEquals(commands.length, 1);
  assertEquals(packfileData, null);
});

Deno.test("readReceivePackStream - throws when stream exceeds byte limit", async () => {
  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/heads/main`],
    true,
  );

  const stream = toStream(body, 16);
  await assertRejects(
    async () => {
      await readReceivePackStream(stream, 10); // tiny limit
    },
    /exceeds limit/,
  );
});

Deno.test("readReceivePackStream - parses multiple commands from stream", async () => {
  const body = buildReceiveBody([
    `${ZERO_SHA} ${SHA_A} refs/heads/feature-1`,
    `${ZERO_SHA} ${SHA_B} refs/heads/feature-2`,
  ], true);

  const stream = toStream(body, 50);
  const { commands } = await readReceivePackStream(stream, 1024 * 1024);

  assertEquals(commands.length, 2);
  assertEquals(commands[0].refName, "refs/heads/feature-1");
  assertEquals(commands[1].refName, "refs/heads/feature-2");
});

Deno.test("handleReceivePackFromStream - creates branch via streaming path", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  mockCreateBranch = (async () => ({ success: true })) as any;

  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/heads/stream-feature`],
    true,
  );

  const stream = toStream(body, 48);
  const { response, updatedRefs } = await handleReceivePackFromStream(
    {} as any,
    {} as any,
    "repo1",
    stream,
    1024 * 1024,
  );

  assertEquals(updatedRefs.length, 1);
  assertEquals(updatedRefs[0].refName, "refs/heads/stream-feature");
  const status = parseReportStatus(response);
  assertEquals(status.unpack, "ok");
});

Deno.test("handleReceivePackFromStream - rejects when stream body exceeds maxBodyBytes", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockReadPackfile = (async () => []) as any;
  mockGetCommit = (async () => null) as any;
  mockIndexCommit = (async () => undefined) as any;
  mockIsAncestor = (async () => true) as any;
  mockIsValidRefName = (() => true) as any;
  mockGetBranch = (async () => null) as any;
  const body = buildReceiveBody(
    [`${ZERO_SHA} ${SHA_A} refs/heads/main`],
    true,
  );

  const stream = toStream(body, 16);
  await assertRejects(async () => {
    await handleReceivePackFromStream(
      {} as any,
      {} as any,
      "repo1",
      stream,
      10,
    );
  }, /exceeds limit/);
});
