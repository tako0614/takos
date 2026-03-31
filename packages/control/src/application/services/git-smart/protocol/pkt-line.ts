/**
 * Git pkt-line format encoder/decoder.
 *
 * pkt-line format:
 *   - 4-char hex length prefix (includes the 4 bytes themselves)
 *   - "0000" = flush packet
 *   - "0001" = delimiter packet
 */

import { concatBytes } from '../core/sha1.ts';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export function encodePktLine(data: string | Uint8Array): Uint8Array {
  const payload = typeof data === 'string' ? TEXT_ENCODER.encode(data) : data;
  const length = payload.length + 4;
  const hex = length.toString(16).padStart(4, '0');
  return concatBytes(TEXT_ENCODER.encode(hex), payload);
}

export function flushPkt(): Uint8Array {
  return TEXT_ENCODER.encode('0000');
}

export function delimPkt(): Uint8Array {
  return TEXT_ENCODER.encode('0001');
}

export interface PktLine {
  type: 'data' | 'flush' | 'delim';
  data?: Uint8Array;
}

export function parsePktLines(input: Uint8Array): PktLine[] {
  const lines: PktLine[] = [];
  let offset = 0;

  while (offset < input.length) {
    if (offset + 4 > input.length) break;

    const hexStr = TEXT_DECODER.decode(input.subarray(offset, offset + 4));
    const length = parseInt(hexStr, 16);

    if (length === 0) {
      lines.push({ type: 'flush' });
      offset += 4;
      continue;
    }

    if (length === 1) {
      lines.push({ type: 'delim' });
      offset += 4;
      continue;
    }

    if (length < 4) {
      // Invalid pkt-line, skip
      offset += 4;
      continue;
    }

    if (offset + length > input.length) break;

    const data = input.subarray(offset + 4, offset + length);
    lines.push({ type: 'data', data });
    offset += length;
  }

  return lines;
}

export function pktLineText(line: PktLine): string {
  if (!line.data) return '';
  let text = TEXT_DECODER.decode(line.data);
  // Strip trailing newline
  if (text.endsWith('\n')) text = text.slice(0, -1);
  return text;
}

/**
 * Build a response from multiple pkt-line segments.
 */
export function buildPktLineResponse(...segments: Uint8Array[]): Uint8Array {
  return concatBytes(...segments);
}

/**
 * Encode a side-band-64k frame.
 * Channel 1 = pack data, Channel 2 = progress, Channel 3 = error
 */
export function encodeSideBandData(channel: number, data: Uint8Array): Uint8Array {
  const payload = new Uint8Array(1 + data.length);
  payload[0] = channel;
  payload.set(data, 1);
  return encodePktLine(payload);
}
