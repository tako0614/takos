import { describe, it, expect } from 'vitest';
import {
  encodePktLine,
  flushPkt,
  delimPkt,
  parsePktLines,
  pktLineText,
  encodeSideBandData,
} from '@/services/git-smart/protocol/pkt-line';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('encodePktLine', () => {
  it('encodes "hello\\n" with correct length prefix', () => {
    const result = encodePktLine('hello\n');
    const hex = dec.decode(result.subarray(0, 4));
    // "hello\n" = 6 bytes + 4 prefix = 10 = 0x000a
    expect(hex).toBe('000a');
    const payload = dec.decode(result.subarray(4));
    expect(payload).toBe('hello\n');
  });

  it('encodes Uint8Array payload', () => {
    const data = new Uint8Array([1, 2, 3]);
    const result = encodePktLine(data);
    const hex = dec.decode(result.subarray(0, 4));
    // 3 bytes + 4 prefix = 7 = 0x0007
    expect(hex).toBe('0007');
    expect(result.subarray(4)).toEqual(data);
  });
});

describe('flushPkt / delimPkt', () => {
  it('flushPkt is "0000"', () => {
    const result = flushPkt();
    expect(dec.decode(result)).toBe('0000');
    expect(result.length).toBe(4);
  });

  it('delimPkt is "0001"', () => {
    const result = delimPkt();
    expect(dec.decode(result)).toBe('0001');
    expect(result.length).toBe(4);
  });
});

describe('parsePktLines', () => {
  it('parses multiple data lines + flush', () => {
    const line1 = encodePktLine('line 1\n');
    const line2 = encodePktLine('line 2\n');
    const flush = flushPkt();
    const input = new Uint8Array([...line1, ...line2, ...flush]);
    const lines = parsePktLines(input);

    expect(lines).toHaveLength(3);
    expect(lines[0].type).toBe('data');
    expect(lines[1].type).toBe('data');
    expect(lines[2].type).toBe('flush');
  });

  it('parses delim packet', () => {
    const delim = delimPkt();
    const lines = parsePktLines(delim);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('delim');
  });

  it('handles empty input', () => {
    const lines = parsePktLines(new Uint8Array(0));
    expect(lines).toHaveLength(0);
  });
});

describe('pktLineText', () => {
  it('strips trailing newline', () => {
    const line = encodePktLine('hello\n');
    const parsed = parsePktLines(line);
    expect(pktLineText(parsed[0])).toBe('hello');
  });

  it('returns text without newline as-is', () => {
    const line = encodePktLine('hello');
    const parsed = parsePktLines(line);
    expect(pktLineText(parsed[0])).toBe('hello');
  });

  it('returns empty string for flush packet', () => {
    expect(pktLineText({ type: 'flush' })).toBe('');
  });
});

describe('encodeSideBandData', () => {
  it('prefixes channel byte to payload', () => {
    const data = new Uint8Array([0xAA, 0xBB]);
    const result = encodeSideBandData(1, data);
    const parsed = parsePktLines(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('data');
    // First byte of data should be channel
    expect(parsed[0].data![0]).toBe(1);
    // Remaining bytes are the payload
    expect(parsed[0].data!.subarray(1)).toEqual(data);
  });

  it('uses channel 2 for progress', () => {
    const data = new Uint8Array([0x01]);
    const result = encodeSideBandData(2, data);
    const parsed = parsePktLines(result);
    expect(parsed[0].data![0]).toBe(2);
  });
});

describe('encode → parse → text roundtrip', () => {
  it('roundtrips a message', () => {
    const original = 'want abcdef1234567890abcdef1234567890abcdef12\n';
    const encoded = encodePktLine(original);
    const parsed = parsePktLines(encoded);
    expect(parsed).toHaveLength(1);
    expect(pktLineText(parsed[0])).toBe(original.replace(/\n$/, ''));
  });
});
