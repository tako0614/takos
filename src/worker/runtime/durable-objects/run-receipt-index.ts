import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";

const PREFIX = "run-receipt-v1/nodes/";
const HASH = /^[a-f0-9]{64}$/;
// Eight worst-case 512-code-unit keys (including JSON escapes in range refs)
// still fit within a 64 KiB node, below the legacy KV 128 KiB value limit.
const FANOUT = 8;
const MAX_LEAF_ENTRIES = 64;
const MAX_HEIGHT = 16;
const MAX_BYTES = 64 * 1024;
const encoder = new TextEncoder();

export type ReceiptNamespace = "emit" | "usage";
export type ReceiptLocator = { namespace: ReceiptNamespace; key: string };
export type ReceiptEntry =
  | { namespace: "emit"; key: string; digest: string; eventId: number }
  | { namespace: "emit"; key: string; legacyAcceptedAt: number }
  | { namespace: "usage"; key: string; digest: string };
export type ReceiptRoot = { hash: string | null; height: number; entries: number;
  first: ReceiptLocator | null; last: ReceiptLocator | null };
export type ReceiptNodeRef = ReceiptRoot & { hash: string; first: ReceiptLocator; last: ReceiptLocator };
export type ReceiptNodeWrite = { hash: string; json: string };
export type ReceiptInsertPlan = { previousRoot: ReceiptRoot; root: ReceiptRoot; entry: ReceiptEntry;
  writeHashes: string[]; retired: ReceiptNodeRef[] };
export type ReceiptBulkPlan = { root: ReceiptRoot; sourceDigest: string;
  sourceCount: number; writeHashes: string[] };
export type ReceiptBootstrapSource = {
  emitReceipts: Array<{ key: string; digest: string; eventId: number }>;
  usageReceipts: Array<{ requestId: string; digest: string }>;
  emitDedupKeys: Array<[string, number]>;
};
export const RECEIPT_BOOTSTRAP_STAGE_NODES = 16;
const BOOTSTRAP_PROGRESS_PREFIX = "run-receipt-v1/bootstrap-progress/";
export type ReceiptNode = { v: 1; t: "leaf"; entries: ReceiptEntry[] } |
  { v: 1; t: "branch"; children: ReceiptNodeRef[] };

export class ReceiptIndexIntegrityError extends Error {
  constructor(reason: string) {
    super(`Invalid run receipt index: ${reason}`);
    this.name = "ReceiptIndexIntegrityError";
  }
}
function fail(reason: string): never { throw new ReceiptIndexIntegrityError(reason); }
function object(raw: unknown, keys: string[]): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("object");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))) fail("fields");
  return value;
}
function count(raw: unknown, minimum = 0): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < minimum) fail("count");
  return raw;
}
function hash(raw: unknown): string {
  if (typeof raw !== "string" || !HASH.test(raw)) fail("hash");
  return raw;
}
function key(raw: unknown): string {
  if (typeof raw !== "string" || !raw || raw.length > 512 || raw !== raw.trim()) fail("key");
  return raw;
}
function namespace(raw: unknown): ReceiptNamespace {
  if (raw !== "emit" && raw !== "usage") fail("namespace");
  return raw;
}
function safeAdd(a: number, b: number): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) fail("entry count overflow");
  return result;
}
function compare(a: ReceiptLocator, b: ReceiptLocator): number {
  if (a.namespace !== b.namespace) return a.namespace === "emit" ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
function sameLocator(a: ReceiptLocator | null, b: ReceiptLocator | null): boolean {
  return a === null ? b === null : b !== null && compare(a, b) === 0;
}
function sameRef(a: ReceiptRoot, b: ReceiptRoot): boolean {
  return a.hash === b.hash && a.height === b.height && a.entries === b.entries &&
    sameLocator(a.first, b.first) && sameLocator(a.last, b.last);
}

export function parseReceiptLocator(raw: unknown): ReceiptLocator {
  const value = object(raw, ["namespace", "key"]);
  return { namespace: namespace(value.namespace), key: key(value.key) };
}
export function parseReceiptEntry(raw: unknown): ReceiptEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("entry");
  const value = raw as Record<string, unknown>;
  if (value.namespace === "emit" && Object.hasOwn(value, "legacyAcceptedAt")) {
    object(value, ["namespace", "key", "legacyAcceptedAt"]);
    const legacyAcceptedAt = count(value.legacyAcceptedAt);
    if (legacyAcceptedAt > 8_640_000_000_000_000) fail("legacy time");
    return { namespace: "emit", key: key(value.key), legacyAcceptedAt };
  }
  if (value.namespace === "emit") {
    object(value, ["namespace", "key", "digest", "eventId"]);
    return { namespace: "emit", key: key(value.key), digest: hash(value.digest),
      eventId: count(value.eventId, 1) };
  }
  object(value, ["namespace", "key", "digest"]);
  if (value.namespace !== "usage") fail("usage namespace");
  return { namespace: "usage", key: key(value.key), digest: hash(value.digest) };
}
export function emptyReceiptRoot(): ReceiptRoot {
  return { hash: null, height: 0, entries: 0, first: null, last: null };
}
export function parseReceiptRoot(raw: unknown): ReceiptRoot {
  const value = object(raw, ["hash", "height", "entries", "first", "last"]);
  const height = count(value.height);
  const entries = count(value.entries);
  if (value.hash === null) {
    if (height !== 0 || entries !== 0 || value.first !== null || value.last !== null) fail("empty root");
    return emptyReceiptRoot();
  }
  const root = { hash: hash(value.hash), height, entries,
    first: parseReceiptLocator(value.first), last: parseReceiptLocator(value.last) };
  if (height < 1 || height > MAX_HEIGHT || entries < 1 || compare(root.first, root.last) > 0) fail("root range");
  return root;
}
export function parseReceiptNodeRef(raw: unknown): ReceiptNodeRef {
  const root = parseReceiptRoot(raw);
  if (root.hash === null || root.first === null || root.last === null) fail("node ref");
  return root as ReceiptNodeRef;
}
function parseNode(raw: unknown): ReceiptNode {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("node");
  const value = raw as Record<string, unknown>;
  if (value.v !== 1) fail("node version");
  if (value.t === "leaf") {
    object(value, ["v", "t", "entries"]);
    if (!Array.isArray(value.entries) || value.entries.length < 1 ||
      value.entries.length > MAX_LEAF_ENTRIES) fail("leaf fanout");
    const entries = value.entries.map(parseReceiptEntry);
    for (let i = 1; i < entries.length; i++) if (compare(entries[i - 1]!, entries[i]!) >= 0) fail("leaf order");
    return { v: 1, t: "leaf", entries };
  }
  object(value, ["v", "t", "children"]);
  if (value.t !== "branch" || !Array.isArray(value.children) ||
    value.children.length < 2 || value.children.length > FANOUT) fail("branch fanout");
  const children = value.children.map(parseReceiptNodeRef);
  if (children[0]!.height >= MAX_HEIGHT) fail("branch height");
  for (let i = 1; i < children.length; i++) {
    if (children[i - 1]!.height !== children[i]!.height ||
      compare(children[i - 1]!.last, children[i]!.first) >= 0) fail("branch order");
  }
  return { v: 1, t: "branch", children };
}
function parseNodeJSON(raw: unknown): ReceiptNode {
  if (typeof raw !== "string" || encoder.encode(raw).byteLength > MAX_BYTES) fail("node bytes");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return fail("node JSON"); }
  const node = parseNode(value);
  if (JSON.stringify(node) !== raw) fail("noncanonical node JSON");
  return node;
}
function refFromNode(nodeHash: string, node: ReceiptNode): ReceiptNodeRef {
  if (node.t === "leaf") return { hash: nodeHash, height: 1, entries: node.entries.length,
    first: { namespace: node.entries[0]!.namespace, key: node.entries[0]!.key },
    last: { namespace: node.entries.at(-1)!.namespace, key: node.entries.at(-1)!.key } };
  let entries = 0;
  for (const child of node.children) entries = safeAdd(entries, child.entries);
  return { hash: nodeHash, height: node.children[0]!.height + 1, entries,
    first: node.children[0]!.first, last: node.children.at(-1)!.last };
}
export function receiptNodeKey(nodeHash: string): string { return PREFIX + hash(nodeHash); }
export async function hashReceiptJSON(json: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(json));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function validateReceiptNode(refInput: ReceiptNodeRef, json: string): Promise<void> {
  const ref = parseReceiptNodeRef(refInput);
  const node = parseNodeJSON(json);
  if (await hashReceiptJSON(json) !== ref.hash || !sameRef(refFromNode(ref.hash, node), ref) ||
    node.t === "branch" && node.children[0]!.height !== ref.height - 1) {
    fail("node hash or metadata");
  }
}
export async function readReceiptNode(storage: DurableObjectStorageBinding, refInput: ReceiptNodeRef):
Promise<{ ref: ReceiptNodeRef; node: ReceiptNode; json: string }> {
  const ref = parseReceiptNodeRef(refInput);
  const json = await storage.get<unknown>(receiptNodeKey(ref.hash));
  if (json === undefined) fail("missing node");
  const node = parseNodeJSON(json);
  await validateReceiptNode(ref, json as string);
  return { ref, node, json: json as string };
}
export async function lookupReceipt(storage: DurableObjectStorageBinding, rootInput: ReceiptRoot,
  kind: ReceiptNamespace, rawKey: string): Promise<ReceiptEntry | null> {
  const root = parseReceiptRoot(rootInput);
  const locator = parseReceiptLocator({ namespace: kind, key: rawKey });
  if (root.hash === null) return null;
  let ref = parseReceiptNodeRef(root);
  let current = await readReceiptNode(storage, ref);
  if (compare(locator, root.first!) < 0 || compare(locator, root.last!) > 0) return null;
  for (;;) {
    const { node } = current;
    if (node.t === "leaf") return node.entries.find((entry) => compare(entry, locator) === 0) ?? null;
    const child = node.children.find((candidate) => compare(locator, candidate.first) >= 0 &&
      compare(locator, candidate.last) <= 0);
    if (!child) return null;
    ref = child;
    current = await readReceiptNode(storage, ref);
  }
}
export async function visitReceiptIndexClosure(storage: DurableObjectStorageBinding,
  rootInput: ReceiptRoot, visitor: { node?: (ref: ReceiptNodeRef, json: string) => Promise<void> | void;
    entry?: (entry: ReceiptEntry) => Promise<void> | void } = {}): Promise<number> {
  const root = parseReceiptRoot(rootInput);
  if (root.hash === null) return 0;
  const seen = new Set<string>();
  let entries = 0;
  async function walk(ref: ReceiptNodeRef): Promise<void> {
    if (seen.has(ref.hash)) fail("cycle or shared node");
    seen.add(ref.hash);
    const { node, json } = await readReceiptNode(storage, ref);
    await visitor.node?.(ref, json);
    if (node.t === "leaf") {
      for (const entry of node.entries) { await visitor.entry?.(entry); entries = safeAdd(entries, 1); }
    } else for (const child of node.children) await walk(child);
  }
  await walk(parseReceiptNodeRef(root));
  if (entries !== root.entries) fail("closure count");
  return entries;
}
export function parseReceiptInsertPlan(raw: unknown): ReceiptInsertPlan {
  const value = object(raw, ["previousRoot", "root", "entry", "writeHashes", "retired"]);
  const previousRoot = parseReceiptRoot(value.previousRoot);
  const root = parseReceiptRoot(value.root);
  const entry = parseReceiptEntry(value.entry);
  if (!Array.isArray(value.writeHashes) || value.writeHashes.length < 1 ||
    value.writeHashes.length > MAX_HEIGHT * 2 + 1 || !Array.isArray(value.retired) ||
    value.retired.length > MAX_HEIGHT) fail("plan bounds");
  const writeHashes = value.writeHashes.map(hash);
  const retired = value.retired.map(parseReceiptNodeRef);
  if (new Set(writeHashes).size !== writeHashes.length ||
    new Set(retired.map((ref) => ref.hash)).size !== retired.length) fail("plan duplicates");
  if (root.hash === null || root.entries !== safeAdd(previousRoot.entries, 1) ||
    !writeHashes.includes(root.hash) || compare(root.first!, entry) > 0 ||
    compare(root.last!, entry) < 0) fail("plan root");
  return { previousRoot, root, entry, writeHashes, retired };
}
export async function prepareReceiptInsert(storage: DurableObjectStorageBinding,
  rootInput: ReceiptRoot, entryInput: ReceiptEntry):
Promise<{ plan: ReceiptInsertPlan; writes: ReceiptNodeWrite[] }> {
  const root = parseReceiptRoot(rootInput);
  const entry = parseReceiptEntry(entryInput);
  const writes: ReceiptNodeWrite[] = [];
  const retired: ReceiptNodeRef[] = [];
  async function create(node: ReceiptNode): Promise<ReceiptNodeRef> {
    const json = JSON.stringify(node);
    parseNodeJSON(json);
    const nodeHash = await hashReceiptJSON(json);
    writes.push({ hash: nodeHash, json });
    return refFromNode(nodeHash, node);
  }
  async function leaves(entries: ReceiptEntry[]): Promise<ReceiptNodeRef[]> {
    const node: ReceiptNode = { v: 1, t: "leaf", entries };
    if (entries.length <= MAX_LEAF_ENTRIES &&
      encoder.encode(JSON.stringify(node)).length <= MAX_BYTES) return [await create(node)];
    if (entries.length < 2) fail("entry exceeds node capacity");
    const middle = Math.ceil(entries.length / 2);
    return [...await leaves(entries.slice(0, middle)), ...await leaves(entries.slice(middle))];
  }
  async function branches(children: ReceiptNodeRef[]): Promise<ReceiptNodeRef[]> {
    if (children.length === 1) return children;
    const node: ReceiptNode = { v: 1, t: "branch", children };
    if (children.length <= FANOUT &&
      encoder.encode(JSON.stringify(node)).length <= MAX_BYTES) return [await create(node)];
    const middle = Math.ceil(children.length / 2);
    return [...await branches(children.slice(0, middle)),
      ...await branches(children.slice(middle))];
  }
  async function insert(ref: ReceiptNodeRef): Promise<ReceiptNodeRef[]> {
    const { node } = await readReceiptNode(storage, ref);
    if (node.t === "leaf") {
      const at = node.entries.findIndex((candidate) => compare(candidate, entry) >= 0);
      const index = at < 0 ? node.entries.length : at;
      if (node.entries[index] && compare(node.entries[index]!, entry) === 0) fail("duplicate key");
      const entries = [...node.entries.slice(0, index), entry, ...node.entries.slice(index)];
      retired.push(ref);
      return leaves(entries);
    }
    let index = 0;
    while (index + 1 < node.children.length && compare(node.children[index + 1]!.first, entry) <= 0) index++;
    const children = [...node.children];
    const replacement = await insert(children[index]!);
    children.splice(index, 1, ...replacement);
    retired.push(ref);
    return branches(children);
  }
  let next: ReceiptNodeRef;
  if (root.hash === null) next = (await leaves([entry]))[0]!;
  else {
    let refs = await insert(parseReceiptNodeRef(root));
    while (refs.length > 1) refs = await branches(refs);
    next = refs[0]!;
  }
  const plan = parseReceiptInsertPlan({ previousRoot: root, root: next, entry,
    writeHashes: writes.map((write) => write.hash), retired });
  return { plan, writes };
}
export async function stageReceiptInsert(storage: DurableObjectStorageBinding,
  planInput: ReceiptInsertPlan): Promise<void> {
  const plan = parseReceiptInsertPlan(planInput);
  const expected = await prepareReceiptInsert(storage, plan.previousRoot, plan.entry);
  if (JSON.stringify(expected.plan) !== JSON.stringify(plan)) fail("plan differs from previous root");
  for (const write of expected.writes) {
    const nodeKey = receiptNodeKey(write.hash);
    const existing = await storage.get<unknown>(nodeKey);
    if (existing === undefined) await storage.put(nodeKey, write.json);
    else if (existing !== write.json) fail("immutable node collision");
    const readback = await storage.get<unknown>(nodeKey);
    if (readback !== write.json || await hashReceiptJSON(readback) !== write.hash) fail("staged readback");
  }
  await readReceiptNode(storage, parseReceiptNodeRef(plan.root));
}

export function parseReceiptBulkPlan(raw: unknown): ReceiptBulkPlan {
  const value = object(raw, ["root", "sourceDigest", "sourceCount", "writeHashes"]);
  const root = parseReceiptRoot(value.root);
  const sourceDigest = hash(value.sourceDigest);
  const sourceCount = count(value.sourceCount, 1);
  if (!Array.isArray(value.writeHashes) || value.writeHashes.length < 1 ||
    value.writeHashes.length > 16_384) fail("bulk plan bounds");
  const writeHashes = value.writeHashes.map(hash);
  if (root.hash === null || root.entries > sourceCount ||
    writeHashes.at(-1) !== root.hash ||
    new Set(writeHashes).size !== writeHashes.length) fail("bulk plan root");
  return { root, sourceDigest, sourceCount, writeHashes };
}

/** Build a compact plan before staging. Inline source remains authoritative until root switch. */
export async function prepareReceiptBootstrap(source: ReceiptBootstrapSource):
Promise<{ plan: ReceiptBulkPlan; writes: ReceiptNodeWrite[] }> {
  const emitReceipts = source.emitReceipts.map((receipt) => {
    const value = parseReceiptEntry({ namespace: "emit", ...receipt });
    if ("legacyAcceptedAt" in value) fail("modern emit receipt");
    return value;
  });
  const usageReceipts = source.usageReceipts.map((receipt) =>
    parseReceiptEntry({ namespace: "usage", key: receipt.requestId, digest: receipt.digest }));
  const legacyReceipts = source.emitDedupKeys.map(([legacyKey, legacyAcceptedAt]) =>
    parseReceiptEntry({ namespace: "emit", key: legacyKey, legacyAcceptedAt }));
  const all = [...emitReceipts, ...usageReceipts, ...legacyReceipts];
  if (!all.length) fail("empty bootstrap source");
  const sourceDigest = await hashReceiptJSON(JSON.stringify({
    emitReceipts: source.emitReceipts, usageReceipts: source.usageReceipts,
    emitDedupKeys: source.emitDedupKeys,
  }));
  all.sort((a, b) => compare(a, b) ||
    ("legacyAcceptedAt" in a ? 1 : 0) - ("legacyAcceptedAt" in b ? 1 : 0));
  const effective: ReceiptEntry[] = [];
  for (const entry of all) {
    const previous = effective.at(-1);
    if (previous && compare(previous, entry) === 0) {
      if (entry.namespace === "emit" && "legacyAcceptedAt" in entry &&
        previous.namespace === "emit" && "digest" in previous) continue;
      fail("duplicate bootstrap key");
    }
    effective.push(entry);
  }
  const writes: ReceiptNodeWrite[] = [];
  async function create(node: ReceiptNode): Promise<ReceiptNodeRef> {
    const json = JSON.stringify(node);
    parseNodeJSON(json);
    const nodeHash = await hashReceiptJSON(json);
    writes.push({ hash: nodeHash, json });
    return refFromNode(nodeHash, node);
  }
  let refs: ReceiptNodeRef[] = [];
  let leaf: ReceiptEntry[] = [];
  for (const entry of effective) {
    const candidate = [...leaf, entry];
    if (leaf.length && (candidate.length > MAX_LEAF_ENTRIES ||
      encoder.encode(JSON.stringify({ v: 1, t: "leaf", entries: candidate })).length > MAX_BYTES)) {
      refs.push(await create({ v: 1, t: "leaf", entries: leaf }));
      leaf = [entry];
    } else leaf = candidate;
  }
  if (leaf.length) refs.push(await create({ v: 1, t: "leaf", entries: leaf }));
  while (refs.length > 1) {
    const groups = Math.ceil(refs.length / FANOUT);
    const base = Math.floor(refs.length / groups);
    const extra = refs.length % groups;
    const next: ReceiptNodeRef[] = [];
    let at = 0;
    for (let group = 0; group < groups; group++) {
      const length = base + (group < extra ? 1 : 0);
      if (length < 2) fail("bulk branch singleton");
      next.push(await create({ v: 1, t: "branch", children: refs.slice(at, at + length) }));
      at += length;
    }
    refs = next;
  }
  const plan = parseReceiptBulkPlan({ root: refs[0]!, sourceDigest,
    sourceCount: all.length, writeHashes: writes.map((write) => write.hash) });
  return { plan, writes };
}

export async function stageReceiptBootstrapBatch(
  storage: DurableObjectStorageBinding, source: ReceiptBootstrapSource,
  planInput: ReceiptBulkPlan, cursor: number,
  prepared?: { plan: ReceiptBulkPlan; writes: ReceiptNodeWrite[] },
): Promise<number> {
  const plan = parseReceiptBulkPlan(planInput);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= plan.writeHashes.length) fail("bulk cursor");
  // A live DO may reuse its already authenticated plan. The persisted source
  // remains authoritative, and a cold instance rederives every node first.
  const expected = prepared ?? await prepareReceiptBootstrap(source);
  if (prepared && await hashReceiptJSON(JSON.stringify(source)) !== plan.sourceDigest) {
    fail("bulk source changed");
  }
  if (JSON.stringify(expected.plan) !== JSON.stringify(plan)) fail("bulk source or plan changed");
  const end = Math.min(cursor + RECEIPT_BOOTSTRAP_STAGE_NODES, expected.writes.length);
  for (const write of expected.writes.slice(cursor, end)) {
    const nodeKey = receiptNodeKey(write.hash);
    const existing = await storage.get<unknown>(nodeKey);
    if (existing === undefined) await storage.put(nodeKey, write.json);
    else if (existing !== write.json) fail("bulk immutable node collision");
    const readback = await storage.get<unknown>(nodeKey);
    if (readback !== write.json) fail("bulk node readback");
    await validateReceiptNode(parseReceiptNodeRef(refFromPlanWrite(expected.writes, write.hash)),
      readback as string);
  }
  if (end === expected.writes.length) await visitReceiptIndexClosure(storage, plan.root);
  return end;
}

export function receiptBootstrapProgressKey(sourceDigest: string): string {
  return BOOTSTRAP_PROGRESS_PREFIX + hash(sourceDigest);
}

/** The sidecar is only a progress hint. The head plan and old arrays own every receipt. */
export async function readReceiptBootstrapProgress(storage: DurableObjectStorageBinding,
  planInput: ReceiptBulkPlan): Promise<{ cursor: number; json: string | null }> {
  const plan = parseReceiptBulkPlan(planInput);
  const raw = await storage.get<unknown>(receiptBootstrapProgressKey(plan.sourceDigest));
  if (raw === undefined) return { cursor: 0, json: null };
  if (typeof raw !== "string" || encoder.encode(raw).length > 1024) fail("bootstrap progress bytes");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail("bootstrap progress JSON"); }
  const value = object(parsed, ["schemaVersion", "planHash", "sourceDigest", "cursor"]);
  const cursor = count(value.cursor);
  if (value.schemaVersion !== 1 || value.sourceDigest !== plan.sourceDigest ||
    value.planHash !== await hashReceiptJSON(JSON.stringify(plan)) ||
    cursor > plan.writeHashes.length || JSON.stringify(value) !== raw) {
    fail("bootstrap progress witness");
  }
  return { cursor, json: raw };
}

export async function writeReceiptBootstrapProgress(storage: DurableObjectStorageBinding,
  planInput: ReceiptBulkPlan, cursor: number): Promise<void> {
  const plan = parseReceiptBulkPlan(planInput);
  if (!Number.isSafeInteger(cursor) || cursor < 1 || cursor > plan.writeHashes.length) {
    fail("bootstrap progress cursor");
  }
  const json = JSON.stringify({ schemaVersion: 1,
    planHash: await hashReceiptJSON(JSON.stringify(plan)),
    sourceDigest: plan.sourceDigest, cursor });
  const sidecarKey = receiptBootstrapProgressKey(plan.sourceDigest);
  await storage.put(sidecarKey, json);
  if ((await readReceiptBootstrapProgress(storage, plan)).json !== json) {
    fail("bootstrap progress readback");
  }
}

/** Every completed prefix node is authenticated before a cold resume skips it. */
export async function validateReceiptBootstrapPrefix(storage: DurableObjectStorageBinding,
  prepared: { plan: ReceiptBulkPlan; writes: ReceiptNodeWrite[] }, cursor: number,
  validated = 0): Promise<void> {
  const plan = parseReceiptBulkPlan(prepared.plan);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > plan.writeHashes.length ||
    !Number.isSafeInteger(validated) || validated < 0 || validated > cursor ||
    prepared.writes.length !== plan.writeHashes.length) fail("bootstrap prefix cursor");
  for (let i = validated; i < cursor; i++) {
    const write = prepared.writes[i]!;
    if (write.hash !== plan.writeHashes[i]) fail("bootstrap prefix plan");
    const present = await storage.get<unknown>(receiptNodeKey(write.hash));
    if (present !== write.json) fail("bootstrap prefix bytes");
    await validateReceiptNode(refFromNode(write.hash, parseNodeJSON(write.json)), present);
  }
}

function refFromPlanWrite(writes: ReceiptNodeWrite[], nodeHash: string): ReceiptNodeRef {
  const write = writes.find((candidate) => candidate.hash === nodeHash);
  if (!write) fail("bulk write missing");
  return refFromNode(nodeHash, parseNodeJSON(write.json));
}
export async function receiptRefIsLive(storage: DurableObjectStorageBinding,
  rootInput: ReceiptRoot, targetInput: ReceiptNodeRef): Promise<boolean> {
  const root = parseReceiptRoot(rootInput);
  const target = parseReceiptNodeRef(targetInput);
  if (root.hash === null) return false;
  let ref = parseReceiptNodeRef(root);
  await readReceiptNode(storage, ref);
  if (target.height > root.height ||
    compare(target.first, root.first!) < 0 || compare(target.last, root.last!) > 0) return false;
  for (;;) {
    if (ref.hash === target.hash) return sameRef(ref, target);
    if (ref.height <= target.height) return false;
    const { node } = await readReceiptNode(storage, ref);
    if (node.t !== "branch") fail("live ref height");
    const child = node.children.find((candidate) => compare(target.first, candidate.first) >= 0 &&
      compare(target.last, candidate.last) <= 0);
    if (!child) return false;
    ref = child;
  }
}
