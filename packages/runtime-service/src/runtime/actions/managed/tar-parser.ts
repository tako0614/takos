import { gunzipSync } from "node:zlib";
import { getErrorMessage } from "takos-common/errors";
import { Buffer } from "node:buffer";

export interface ParsedTarEntry {
  path: string;
  linkPath: string;
  type: string;
}

interface TarParserState {
  offset: number;
  pendingLongPath: string | undefined;
  pendingLongLinkPath: string | undefined;
  pendingPax: Record<string, string>;
}

function readNullTerminatedString(data: Uint8Array): string {
  const nullByteIndex = data.indexOf(0);
  const raw = nullByteIndex >= 0 ? data.subarray(0, nullByteIndex) : data;
  return Buffer.from(raw).toString("utf8");
}

function readTarPayloadString(data: Uint8Array): string {
  return Buffer.from(data)
    .toString("utf8")
    .replace(/\0+$/g, "")
    .replace(/\n+$/g, "");
}

function parseTarOctal(data: Uint8Array, label: string): number {
  if ((data[0] & 0x80) !== 0) {
    throw new Error(`Unsupported tar ${label} encoding`);
  }

  const raw = Buffer.from(data)
    .toString("ascii")
    .replace(/\0/g, "")
    .trim();

  if (raw.length === 0) {
    return 0;
  }
  if (!/^[0-7]+$/.test(raw)) {
    throw new Error(`Invalid tar ${label} value`);
  }

  return Number.parseInt(raw, 8);
}

function parsePaxAttributes(data: Uint8Array): Record<string, string> {
  const attributes: Record<string, string> = {};
  let offset = 0;

  while (offset < data.length) {
    const spaceIndex = data.indexOf(0x20, offset);
    if (spaceIndex === -1) {
      break;
    }

    const lengthText = Buffer.from(data.subarray(offset, spaceIndex)).toString(
      "utf8",
    ).trim();
    const recordLength = Number.parseInt(lengthText, 10);
    if (
      !Number.isFinite(recordLength) || recordLength <= 0 ||
      offset + recordLength > data.length
    ) {
      throw new Error("Invalid PAX header record");
    }

    const recordBytes = data.subarray(
      spaceIndex + 1,
      offset + recordLength - 1,
    );
    const record = Buffer.from(recordBytes).toString("utf8");
    const separatorIndex = record.indexOf("=");
    if (separatorIndex > 0) {
      const key = record.slice(0, separatorIndex);
      const value = record.slice(separatorIndex + 1);
      attributes[key] = value;
    }

    offset += recordLength;
  }

  return attributes;
}

function createInitialState(): TarParserState {
  return {
    offset: 0,
    pendingLongPath: undefined,
    pendingLongLinkPath: undefined,
    pendingPax: {},
  };
}

function processExtensionHeader(
  typeFlag: string,
  payload: Uint8Array,
  state: TarParserState,
): boolean {
  if (typeFlag === "L") {
    state.pendingLongPath = readTarPayloadString(payload);
    return true;
  }
  if (typeFlag === "K") {
    state.pendingLongLinkPath = readTarPayloadString(payload);
    return true;
  }
  if (typeFlag === "x" || typeFlag === "g") {
    state.pendingPax = typeFlag === "x" ? parsePaxAttributes(payload) : {};
    return true;
  }
  return false;
}

function resolveEntryAndResetState(
  combinedName: string,
  linkName: string,
  typeFlag: string,
  state: TarParserState,
): ParsedTarEntry {
  const resolvedPath = state.pendingLongPath ?? state.pendingPax.path ??
    combinedName;
  const resolvedLinkPath = state.pendingLongLinkPath ??
    state.pendingPax.linkpath ?? linkName;

  state.pendingLongPath = undefined;
  state.pendingLongLinkPath = undefined;
  state.pendingPax = {};

  return {
    path: resolvedPath,
    linkPath: resolvedLinkPath,
    type: typeFlag,
  };
}

export function parseTarEntriesFromGzipArchive(
  archiveData: Uint8Array,
): ParsedTarEntry[] {
  let tarData: Uint8Array;
  try {
    tarData = gunzipSync(archiveData);
  } catch (err) {
    throw new Error(`Invalid cache archive (gzip): ${getErrorMessage(err)}`);
  }

  const entries: ParsedTarEntry[] = [];
  const state = createInitialState();

  while (state.offset + 512 <= tarData.length) {
    const header = tarData.subarray(state.offset, state.offset + 512);

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const size = parseTarOctal(header.subarray(124, 136), "size");
    const typeFlagByte = header[156];
    const typeFlag = typeFlagByte === 0
      ? "0"
      : String.fromCharCode(typeFlagByte);
    const name = readNullTerminatedString(header.subarray(0, 100));
    const prefix = readNullTerminatedString(header.subarray(345, 500));
    const linkName = readNullTerminatedString(header.subarray(157, 257));
    const combinedName = prefix ? `${prefix}/${name}` : name;

    const payloadStart = state.offset + 512;
    const payloadEnd = payloadStart + size;
    if (payloadEnd > tarData.length) {
      throw new Error("Invalid cache archive (truncated tar entry)");
    }

    const payload = tarData.subarray(payloadStart, payloadEnd);
    const nextOffset = payloadStart + Math.ceil(size / 512) * 512;

    if (processExtensionHeader(typeFlag, payload, state)) {
      state.offset = nextOffset;
      continue;
    }

    entries.push(
      resolveEntryAndResetState(combinedName, linkName, typeFlag, state),
    );
    state.offset = nextOffset;
  }

  return entries;
}
