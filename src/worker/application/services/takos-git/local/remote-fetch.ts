/**
 * Worker-native git remote fetch (smart HTTP **client**).
 *
 * Replaces the container-based external import: the worker itself speaks the
 * git-upload-pack protocol to a remote server, receives a packfile, and unpacks
 * it into the R2-backed object store. This keeps a single source of truth (R2)
 * so imported repositories are immediately browsable and cloneable through the
 * worker, with no separate filesystem git store to keep in sync.
 *
 * SSRF note: workerd has no DNS resolver, so hostnames cannot be pre-resolved
 * here. We reject private/loopback **IP literals** and require http(s); DNS
 * rebinding is left to platform egress policy (same limitation the container
 * documents).
 */

import { isPrivateIP } from "../../../../../contracts/public/ip-classification.ts";
import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import { parsePktLines, pktLineString, PKT_FLUSH } from "./core/pack-common.ts";
import { concatBytes } from "./core/sha1.ts";
import { getRawObject, putRawObject } from "./core/object-store.ts";
import {
  readPack,
  type UnpackedObject,
} from "./core/pack-reader.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const ZERO_OID = "0".repeat(40);

/** Default 500 MiB cap on the downloaded pack to bound worker memory. */
const DEFAULT_MAX_PACK_BYTES = 500 * 1024 * 1024;

export interface RemoteRef {
  readonly name: string;
  readonly target: string;
}

export interface RemoteFetchInput {
  readonly url: string;
  /** Full value for the `Authorization` header on remote requests, if any. */
  readonly authHeader?: string | null;
  readonly maxPackBytes?: number;
  readonly signal?: AbortSignal;
  /**
   * Allow private/loopback IP-literal hosts. Off by default (SSRF-safe). Opt in
   * only for trusted callers (e.g. a self-hoster importing from a LAN git
   * server, or loopback tests).
   */
  readonly allowPrivateHosts?: boolean;
}

export interface RemoteFetchResult {
  readonly refs: RemoteRef[];
  readonly defaultBranch: string | null;
  readonly objects: UnpackedObject[];
}

export class RemoteFetchError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "RemoteFetchError";
  }
}

function assertSafeRemoteUrl(url: string, allowPrivateHosts: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RemoteFetchError(`invalid remote URL: ${url}`, "invalid_url");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new RemoteFetchError(
      `unsupported protocol: ${parsed.protocol}`,
      "unsupported_protocol",
    );
  }
  if (!allowPrivateHosts && isPrivateIP(parsed.hostname)) {
    throw new RemoteFetchError(
      "remote host is a private/loopback address",
      "blocked_host",
    );
  }
  return parsed;
}

function baseRepoUrl(parsed: URL): string {
  // Strip a trailing slash but keep the `.git` suffix if present; git servers
  // accept `<repo>` and `<repo>.git` and expose `/info/refs` under both.
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`
    .replace(/\?.*$/, "");
}

function requestHeaders(
  authHeader: string | null | undefined,
  extra: Record<string, string>,
): HeadersInit {
  const headers: Record<string, string> = {
    "User-Agent": "git/takos-git",
    ...extra,
  };
  if (authHeader) headers["Authorization"] = authHeader;
  return headers;
}

interface Advertisement {
  refs: RemoteRef[];
  defaultBranch: string | null;
}

function parseAdvertisement(bytes: Uint8Array): Advertisement {
  const lines = parsePktLines(bytes);
  const refs: RemoteRef[] = [];
  let capabilities = "";
  let sawService = false;

  for (const line of lines) {
    if (!line.payload) continue; // flush
    const text = TEXT_DECODER.decode(line.payload);
    if (text.startsWith("# service=")) {
      sawService = true;
      continue;
    }
    const nul = text.indexOf("\0");
    const refPart = (nul === -1 ? text : text.slice(0, nul)).trim();
    if (nul !== -1 && !capabilities) capabilities = text.slice(nul + 1);
    const space = refPart.indexOf(" ");
    if (space === -1) continue;
    const sha = refPart.slice(0, space);
    const name = refPart.slice(space + 1).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) continue;
    if (sha === ZERO_OID) continue; // empty-repo capabilities^{} line
    if (name === "HEAD") continue; // pseudo-ref (symref), not stored as a ref
    refs.push({ name, target: sha });
  }

  if (!sawService) {
    throw new RemoteFetchError(
      "remote did not return a git-upload-pack advertisement",
      "bad_advertisement",
    );
  }

  let defaultBranch: string | null = null;
  const symref = /symref=HEAD:refs\/heads\/([^\s]+)/.exec(capabilities);
  if (symref) defaultBranch = symref[1];

  return { refs, defaultBranch };
}

/** Build the upload-pack request body: wants + flush + done (full clone). */
function buildUploadPackRequest(wantShas: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  wantShas.forEach((sha, index) => {
    const caps = index === 0 ? " ofs-delta agent=takos-git/0.1" : "";
    parts.push(pktLineString(`want ${sha}${caps}\n`));
  });
  parts.push(PKT_FLUSH);
  parts.push(pktLineString("done\n"));
  return concatBytes(...parts);
}

/**
 * Locate the packfile within an upload-pack response. Without side-band the
 * server sends ack pkt-lines (`NAK\n`) followed by the raw pack, which begins
 * with the `PACK` signature. We requested no side-band, so the first `PACK` at
 * a header boundary is the pack start.
 */
function extractPack(body: Uint8Array): Uint8Array {
  for (let i = 0; i + 4 <= body.length; i++) {
    if (
      body[i] === 0x50 && body[i + 1] === 0x41 &&
      body[i + 2] === 0x43 && body[i + 3] === 0x4b
    ) {
      return body.subarray(i);
    }
  }
  throw new RemoteFetchError(
    "no packfile in upload-pack response",
    "no_pack",
  );
}

export async function fetchRemoteRepository(
  input: RemoteFetchInput,
): Promise<RemoteFetchResult> {
  const parsed = assertSafeRemoteUrl(input.url, input.allowPrivateHosts ?? false);
  const base = baseRepoUrl(parsed);
  const maxPackBytes = input.maxPackBytes ?? DEFAULT_MAX_PACK_BYTES;

  const infoRefsUrl = `${base}/info/refs?service=git-upload-pack`;
  const infoRes = await fetch(infoRefsUrl, {
    method: "GET",
    headers: requestHeaders(input.authHeader, {
      Accept: "*/*",
    }),
    signal: input.signal,
    redirect: "follow",
  });
  if (!infoRes.ok) {
    throw new RemoteFetchError(
      `remote info/refs failed: ${infoRes.status}`,
      infoRes.status === 401 || infoRes.status === 403
        ? "remote_unauthorized"
        : "remote_unavailable",
    );
  }
  const advertisement = parseAdvertisement(
    new Uint8Array(await infoRes.arrayBuffer()),
  );

  // Nothing to fetch (empty remote): still a valid import of an empty repo.
  if (advertisement.refs.length === 0) {
    return { refs: [], defaultBranch: advertisement.defaultBranch, objects: [] };
  }

  const wantShas = Array.from(
    new Set(
      advertisement.refs
        .filter((ref) => !ref.name.endsWith("^{}"))
        .map((ref) => ref.target),
    ),
  );

  const uploadPackUrl = `${base}/git-upload-pack`;
  const packRes = await fetch(uploadPackUrl, {
    method: "POST",
    headers: requestHeaders(input.authHeader, {
      "Content-Type": "application/x-git-upload-pack-request",
      Accept: "application/x-git-upload-pack-result",
    }),
    body: buildUploadPackRequest(wantShas).buffer as ArrayBuffer,
    signal: input.signal,
    redirect: "follow",
  });
  if (!packRes.ok) {
    throw new RemoteFetchError(
      `remote upload-pack failed: ${packRes.status}`,
      "remote_unavailable",
    );
  }

  const declared = Number(packRes.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxPackBytes) {
    throw new RemoteFetchError("remote pack exceeds size cap", "pack_too_large");
  }

  const body = new Uint8Array(await packRes.arrayBuffer());
  if (body.byteLength > maxPackBytes) {
    throw new RemoteFetchError("remote pack exceeds size cap", "pack_too_large");
  }

  const pack = extractPack(body);
  const objects = await readPack(pack);

  return {
    refs: advertisement.refs.filter((ref) => !ref.name.endsWith("^{}")),
    defaultBranch: advertisement.defaultBranch,
    objects,
  };
}

/** Loose-object header for storing an unpacked object into the object store. */
function toLooseObject(object: UnpackedObject): Uint8Array {
  const header = TEXT_ENCODER.encode(`${object.type} ${object.content.length}\0`);
  return concatBytes(header, object.content);
}

/**
 * Persist unpacked objects into the R2 object store. Idempotent: `putRawObject`
 * skips objects already present. Returns the number of objects written.
 */
export async function ingestObjects(
  bucket: ObjectStoreBinding,
  objects: readonly UnpackedObject[],
): Promise<number> {
  let written = 0;
  for (const object of objects) {
    await putRawObject(bucket, toLooseObject(object));
    written += 1;
  }
  return written;
}

/** Test/thin-pack seam: resolve a delta base from the object store. */
export async function resolveBaseFromStore(
  bucket: ObjectStoreBinding,
  sha: string,
): Promise<Uint8Array | null> {
  const raw = await getRawObject(bucket, sha);
  if (!raw) return null;
  const nul = raw.indexOf(0);
  return nul === -1 ? raw : raw.subarray(nul + 1);
}
