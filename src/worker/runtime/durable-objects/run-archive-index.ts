import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import {
  type ArchiveDescriptor,
  type ArchiveRoot,
  parseArchiveDescriptor,
  parseArchiveRoot,
} from "../../shared/contracts/run-archive.ts";
export {
  emptyArchiveRoot,
  parseArchiveDescriptor,
  parseArchiveRoot,
} from "../../shared/contracts/run-archive.ts";
export type { ArchiveDescriptor, ArchiveRoot } from "../../shared/contracts/run-archive.ts";

const PREFIX = "run-archive-v3/nodes/";
const FANOUT = 32;
const MAX_NODE_BYTES = 32 * 1024;
const MAX_HEIGHT = 16;
const HEX = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();

export type ArchiveNodeWrite = { hash: string; json: string };
export type ArchiveInsertPlan = {
  previousRoot: ArchiveRoot;
  root: ArchiveRoot;
  descriptor: ArchiveDescriptor;
  writes: ArchiveNodeWrite[];
  retired: string[];
  duplicate: boolean;
};

type NodeRef = ArchiveRoot & { hash: string };
type Leaf = { v: 1; t: "leaf"; entries: ArchiveDescriptor[] };
type Branch = { v: 1; t: "branch"; children: NodeRef[] };
type Node = Leaf | Branch;

function fail(reason: string): never {
  throw new Error(`Invalid run archive index: ${reason}`);
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("object");
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail("fields");
  return record;
}

function nonnegative(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail("nonnegative integer");
  return value as number;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HEX.test(value)) fail("hash");
  return value;
}

function safeSum(a: number, b: number): number {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail("entry count overflow");
  return sum;
}

export function archiveNodeKey(nodeHash: string): string {
  return PREFIX + hash(nodeHash);
}

export async function hashArchiveJSON(json: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(json));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function refFromNode(nodeHash: string, node: Node): NodeRef {
  if (node.t === "leaf") {
    const first = node.entries[0]!;
    const last = node.entries[node.entries.length - 1]!;
    return { hash: nodeHash, height: 1, entries: node.entries.length,
      firstEventId: first.firstEventId, lastEventId: last.lastEventId };
  }
  const first = node.children[0]!;
  const last = node.children[node.children.length - 1]!;
  let entries = 0;
  for (const child of node.children) entries = safeSum(entries, child.entries);
  return { hash: nodeHash, height: first.height + 1, entries,
    firstEventId: first.firstEventId, lastEventId: last.lastEventId };
}

function parseNode(raw: unknown): Node {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail("node object");
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) fail("node version");
  if (o.t === "leaf") {
    object(o, ["v", "t", "entries"]);
    if (!Array.isArray(o.entries) || o.entries.length < 1 || o.entries.length > FANOUT) fail("leaf fanout");
    const entries = o.entries.map(parseArchiveDescriptor);
    for (let i = 1; i < entries.length; i++) {
      if (entries[i - 1]!.lastEventId >= entries[i]!.firstEventId) fail("leaf overlap");
    }
    return { v: 1, t: "leaf", entries };
  }
  if (o.t === "branch") {
    object(o, ["v", "t", "children"]);
    if (!Array.isArray(o.children) || o.children.length < 2 || o.children.length > FANOUT) fail("branch fanout");
    const children = o.children.map((rawChild) => {
      const child = parseArchiveRoot(rawChild);
      if (child.hash === null) fail("empty child");
      return child as NodeRef;
    });
    for (let i = 1; i < children.length; i++) {
      if (children[i - 1]!.height !== children[i]!.height ||
        children[i - 1]!.lastEventId >= children[i]!.firstEventId) fail("branch order");
    }
    if (children[0]!.height >= MAX_HEIGHT) fail("branch height");
    return { v: 1, t: "branch", children };
  }
  return fail("node type");
}

function parseNodeJSON(json: unknown): Node {
  if (typeof json !== "string" || encoder.encode(json).byteLength > MAX_NODE_BYTES) fail("node bytes");
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return fail("node JSON"); }
  const node = parseNode(raw);
  if (JSON.stringify(node) !== json) fail("noncanonical node JSON");
  return node;
}

function sameRef(a: ArchiveRoot, b: ArchiveRoot): boolean {
  return a.hash === b.hash && a.height === b.height && a.entries === b.entries &&
    a.firstEventId === b.firstEventId && a.lastEventId === b.lastEventId;
}

async function readNode(storage: DurableObjectStorageBinding, ref: NodeRef): Promise<Node> {
  const json = await storage.get(archiveNodeKey(ref.hash));
  if (json === undefined) fail("missing node");
  const node = parseNodeJSON(json);
  if (await hashArchiveJSON(json as string) !== ref.hash || !sameRef(refFromNode(ref.hash, node), ref)) {
    fail("node hash or metadata");
  }
  if (node.t === "branch" && node.children[0]!.height !== ref.height - 1) fail("child height");
  return node;
}

function makeNode(node: Node): string {
  const json = JSON.stringify(node);
  parseNodeJSON(json);
  return json;
}

export function parseArchiveInsertPlan(raw: unknown): ArchiveInsertPlan {
  const o = object(raw, ["previousRoot", "root", "descriptor", "writes", "retired", "duplicate"]);
  const previousRoot = parseArchiveRoot(o.previousRoot);
  const root = parseArchiveRoot(o.root);
  const descriptor = parseArchiveDescriptor(o.descriptor);
  if (!Array.isArray(o.writes) || o.writes.length > MAX_HEIGHT * 2 + 1 ||
    !Array.isArray(o.retired) || o.retired.length > MAX_HEIGHT || typeof o.duplicate !== "boolean") fail("plan bounds");
  const writes = o.writes.map((item) => {
    const w = object(item, ["hash", "json"]);
    const nodeHash = hash(w.hash);
    parseNodeJSON(w.json);
    return { hash: nodeHash, json: w.json as string };
  });
  const retired = o.retired.map(hash);
  if (new Set(writes.map((w) => w.hash)).size !== writes.length ||
    new Set(retired).size !== retired.length) fail("duplicate plan hash");
  if (o.duplicate) {
    if (!sameRef(previousRoot, root) || writes.length || retired.length) fail("duplicate plan");
  } else if (root.hash === null || !writes.some((w) => w.hash === root.hash) ||
    root.entries !== safeSum(previousRoot.entries, 1) ||
    root.firstEventId > descriptor.firstEventId || root.lastEventId < descriptor.lastEventId) {
    fail("insert plan root");
  }
  return { previousRoot, root, descriptor, writes, retired, duplicate: o.duplicate };
}

export async function prepareArchiveInsert(
  storage: DurableObjectStorageBinding,
  rootInput: ArchiveRoot,
  descriptorInput: ArchiveDescriptor,
): Promise<ArchiveInsertPlan> {
  const root = parseArchiveRoot(rootInput);
  const descriptor = parseArchiveDescriptor(descriptorInput);
  const writes: ArchiveNodeWrite[] = [];
  const retired: string[] = [];
  async function create(node: Node): Promise<NodeRef> {
    const json = makeNode(node);
    const nodeHash = await hashArchiveJSON(json);
    writes.push({ hash: nodeHash, json });
    return refFromNode(nodeHash, node);
  }
  async function insert(ref: NodeRef): Promise<{ refs: NodeRef[]; duplicate: boolean }> {
    const node = await readNode(storage, ref);
    if (node.t === "leaf") {
      const at = node.entries.findIndex((entry) => entry.firstEventId >= descriptor.firstEventId);
      const index = at < 0 ? node.entries.length : at;
      const previous = node.entries[index - 1];
      const next = node.entries[index];
      if (next && next.firstEventId === descriptor.firstEventId &&
        JSON.stringify(next) === JSON.stringify(descriptor)) return { refs: [ref], duplicate: true };
      if ((previous && previous.lastEventId >= descriptor.firstEventId) ||
        (next && next.firstEventId <= descriptor.lastEventId)) fail("descriptor overlap");
      const entries = [...node.entries.slice(0, index), descriptor, ...node.entries.slice(index)];
      retired.push(ref.hash);
      if (entries.length <= FANOUT) return { refs: [await create({ v: 1, t: "leaf", entries })], duplicate: false };
      const middle = Math.ceil(entries.length / 2);
      return { refs: [await create({ v: 1, t: "leaf", entries: entries.slice(0, middle) }),
        await create({ v: 1, t: "leaf", entries: entries.slice(middle) })], duplicate: false };
    }
    let index = 0;
    while (index + 1 < node.children.length &&
      node.children[index + 1]!.firstEventId <= descriptor.firstEventId) index++;
    const child = await insert(node.children[index]!);
    if (child.duplicate) return { refs: [ref], duplicate: true };
    const children = [...node.children.slice(0, index), ...child.refs, ...node.children.slice(index + 1)];
    retired.push(ref.hash);
    if (children.length <= FANOUT) return { refs: [await create({ v: 1, t: "branch", children })], duplicate: false };
    const middle = Math.ceil(children.length / 2);
    return { refs: [await create({ v: 1, t: "branch", children: children.slice(0, middle) }),
      await create({ v: 1, t: "branch", children: children.slice(middle) })], duplicate: false };
  }
  let newRoot: NodeRef;
  if (root.hash === null) newRoot = await create({ v: 1, t: "leaf", entries: [descriptor] });
  else {
    const result = await insert(root as NodeRef);
    if (result.duplicate) return { previousRoot: root, root, descriptor, writes: [], retired: [], duplicate: true };
    newRoot = result.refs.length === 1 ? result.refs[0]! :
      await create({ v: 1, t: "branch", children: result.refs });
  }
  return parseArchiveInsertPlan({ previousRoot: root, root: newRoot, descriptor, writes, retired, duplicate: false });
}

export async function stageArchiveInsert(
  storage: DurableObjectStorageBinding,
  planInput: ArchiveInsertPlan,
): Promise<void> {
  const plan = parseArchiveInsertPlan(planInput);
  const expected = await prepareArchiveInsert(storage, plan.previousRoot, plan.descriptor);
  if (JSON.stringify(expected) !== JSON.stringify(plan)) fail("plan differs from previous root");
  if (plan.duplicate) return;
  const nodes = new Map<string, Node>();
  for (const write of plan.writes) {
    const node = parseNodeJSON(write.json);
    if (await hashArchiveJSON(write.json) !== write.hash) fail("staged hash");
    nodes.set(write.hash, node);
  }
  const seen = new Set<string>();
  function visit(ref: NodeRef): void {
    const node = nodes.get(ref.hash);
    if (!node) return;
    if (seen.has(ref.hash)) fail("staged cycle");
    seen.add(ref.hash);
    if (!sameRef(refFromNode(ref.hash, node), ref)) fail("staged metadata");
    if (node.t === "branch") for (const child of node.children) visit(child);
  }
  visit(plan.root as NodeRef);
  if (seen.size !== nodes.size) fail("unreachable staged node");
  for (const write of plan.writes) {
    const key = archiveNodeKey(write.hash);
    const existing = await storage.get(key);
    if (existing === undefined) await storage.put(key, write.json);
    else if (existing !== write.json) fail("immutable node collision");
    const readback = await storage.get(key);
    if (readback !== write.json || await hashArchiveJSON(readback) !== write.hash) fail("staged readback");
  }
  await readNode(storage, plan.root as NodeRef);
}

export async function queryArchive(
  storage: DurableObjectStorageBinding,
  rootInput: ArchiveRoot,
  afterEventId: number,
  maxDescriptors: number,
): Promise<{ descriptors: ArchiveDescriptor[]; hasMore: boolean }> {
  const root = parseArchiveRoot(rootInput);
  nonnegative(afterEventId);
  if (!Number.isSafeInteger(maxDescriptors) || maxDescriptors < 1 || maxDescriptors > 512) fail("query limit");
  const descriptors: ArchiveDescriptor[] = [];
  if (root.hash === null || afterEventId >= root.lastEventId) return { descriptors, hasMore: false };
  async function walk(ref: NodeRef): Promise<void> {
    if (descriptors.length > maxDescriptors || ref.lastEventId <= afterEventId) return;
    const node = await readNode(storage, ref);
    if (node.t === "leaf") {
      for (const descriptor of node.entries) {
        if (descriptor.lastEventId > afterEventId) descriptors.push(descriptor);
        if (descriptors.length > maxDescriptors) break;
      }
    } else {
      for (const child of node.children) {
        if (child.lastEventId > afterEventId) await walk(child);
        if (descriptors.length > maxDescriptors) break;
      }
    }
  }
  await walk(root as NodeRef);
  return { descriptors: descriptors.slice(0, maxDescriptors), hasMore: descriptors.length > maxDescriptors };
}
