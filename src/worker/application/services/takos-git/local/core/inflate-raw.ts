/**
 * Self-contained raw-DEFLATE (RFC 1951) and zlib (RFC 1950) inflater that
 * reports how many **compressed input bytes** it consumed.
 *
 * The git packfile reader (`pack-reader.ts`) parses a sequence of zlib streams
 * packed back-to-back with no length prefix, so after inflating one object it
 * must know exactly where the next one starts. `fflate`'s `unzlibSync` /
 * `inflateSync` produce correct output but do not report the consumed input
 * length, so this module implements a compact puff/tinf-style bit-accurate
 * inflater whose output is verified byte-for-byte against `fflate` in tests.
 *
 * `bytesConsumed` for a raw-DEFLATE stream is the number of input bytes touched
 * up to and including the byte that held the final block's end-of-block bits;
 * any unused high bits of that last byte are padding and belong to the stream.
 * `inflateZlibAt` wraps that with the 2-byte zlib header (or 6 with a preset
 * dictionary) and the 4-byte adler32 trailer to report total zlib bytes.
 */

const MAX_BITS = 15;

// RFC 1951 length codes (symbols 257..285): base value + extra bits.
const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
];

// RFC 1951 distance codes (symbols 0..29): base value + extra bits.
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
];

// Order in which dynamic-block code-length code lengths are stored.
const CLEN_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

interface Huffman {
  /** counts[len] = number of codes of bit-length `len` (0..MAX_BITS). */
  readonly counts: Int32Array;
  /** symbols sorted by (length, symbol) for canonical-Huffman decode. */
  readonly symbols: Int32Array;
}

function buildHuffman(lengths: Uint8Array, n: number): Huffman {
  const counts = new Int32Array(MAX_BITS + 1);
  for (let i = 0; i < n; i++) {
    const len = lengths[i];
    if (len > MAX_BITS) throw new Error("inflate: code length exceeds 15");
    counts[len]++;
  }
  const offsets = new Int32Array(MAX_BITS + 2);
  for (let len = 1; len <= MAX_BITS; len++) {
    offsets[len + 1] = offsets[len] + counts[len];
  }
  const symbols = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const len = lengths[i];
    if (len !== 0) symbols[offsets[len]++] = i;
  }
  return { counts, symbols };
}

class BitReader {
  private bitBuf = 0;
  private bitCnt = 0;
  pos: number;

  constructor(
    private readonly buf: Uint8Array,
    start: number,
  ) {
    this.pos = start;
  }

  /** Read `n` (0..24) bits, least-significant bit first. */
  bits(n: number): number {
    let bitBuf = this.bitBuf;
    let bitCnt = this.bitCnt;
    while (bitCnt < n) {
      if (this.pos >= this.buf.length) {
        throw new Error("inflate: unexpected end of input");
      }
      bitBuf |= this.buf[this.pos++] << bitCnt;
      bitCnt += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    this.bitBuf = bitBuf >>> n;
    this.bitCnt = bitCnt - n;
    return val;
  }

  /** Decode one canonical-Huffman symbol (puff.c-style bit-at-a-time walk). */
  decode(h: Huffman): number {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= MAX_BITS; len++) {
      code |= this.bits(1);
      const count = h.counts[len];
      if (code - count < first) return h.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error("inflate: invalid Huffman code");
  }

  /** Drop buffered bits back to the next byte boundary and rewind whole bytes. */
  alignToByte(): void {
    // Discard the sub-byte remainder, then push whole buffered bytes back.
    this.bitBuf >>>= this.bitCnt & 7;
    this.bitCnt -= this.bitCnt & 7;
    this.pos -= this.bitCnt >>> 3;
    this.bitBuf = 0;
    this.bitCnt = 0;
  }

  /** Bytes consumed from `start`, counting a partially-used final byte. */
  bytesConsumed(start: number): number {
    return this.pos - (this.bitCnt >>> 3) - start;
  }

  readByteRaw(): number {
    if (this.pos >= this.buf.length) {
      throw new Error("inflate: unexpected end of input");
    }
    return this.buf[this.pos++];
  }
}

class OutBuffer {
  private data: Uint8Array;
  length = 0;

  constructor(initialCapacity: number) {
    this.data = new Uint8Array(Math.max(64, initialCapacity));
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < needed) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  push(byte: number): void {
    this.ensure(1);
    this.data[this.length++] = byte;
  }

  append(src: Uint8Array): void {
    this.ensure(src.length);
    this.data.set(src, this.length);
    this.length += src.length;
  }

  /** Copy `len` bytes from `dist` back in the output (LZ77 back-reference). */
  copyBack(dist: number, len: number): void {
    if (dist <= 0 || dist > this.length) {
      throw new Error("inflate: invalid back-reference distance");
    }
    this.ensure(len);
    const data = this.data;
    let src = this.length - dist;
    let dst = this.length;
    for (let i = 0; i < len; i++) data[dst++] = data[src++];
    this.length = dst;
  }

  toUint8Array(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

// Fixed Huffman tables (RFC 1951 §3.2.6), built once.
const FIXED_LIT: Huffman = (() => {
  const lengths = new Uint8Array(288);
  for (let i = 0; i < 144; i++) lengths[i] = 8;
  for (let i = 144; i < 256; i++) lengths[i] = 9;
  for (let i = 256; i < 280; i++) lengths[i] = 7;
  for (let i = 280; i < 288; i++) lengths[i] = 8;
  return buildHuffman(lengths, 288);
})();
const FIXED_DIST: Huffman = (() => {
  const lengths = new Uint8Array(30).fill(5);
  return buildHuffman(lengths, 30);
})();

function inflateBlockData(
  reader: BitReader,
  out: OutBuffer,
  litHuff: Huffman,
  distHuff: Huffman,
): void {
  for (;;) {
    const sym = reader.decode(litHuff);
    if (sym < 256) {
      out.push(sym);
      continue;
    }
    if (sym === 256) return; // end of block
    const li = sym - 257;
    if (li >= LENGTH_BASE.length) {
      throw new Error("inflate: invalid length symbol");
    }
    const len = LENGTH_BASE[li] + reader.bits(LENGTH_EXTRA[li]);
    const dsym = reader.decode(distHuff);
    if (dsym >= DIST_BASE.length) {
      throw new Error("inflate: invalid distance symbol");
    }
    const dist = DIST_BASE[dsym] + reader.bits(DIST_EXTRA[dsym]);
    out.copyBack(dist, len);
  }
}

function inflateDynamicTables(reader: BitReader): {
  litHuff: Huffman;
  distHuff: Huffman;
} {
  const hlit = reader.bits(5) + 257;
  const hdist = reader.bits(5) + 1;
  const hclen = reader.bits(4) + 4;
  if (hlit > 286 || hdist > 30) {
    throw new Error("inflate: dynamic block header out of range");
  }

  const clenLengths = new Uint8Array(19);
  for (let i = 0; i < hclen; i++) {
    clenLengths[CLEN_ORDER[i]] = reader.bits(3);
  }
  const clenHuff = buildHuffman(clenLengths, 19);

  const total = hlit + hdist;
  const lengths = new Uint8Array(total);
  let i = 0;
  while (i < total) {
    const sym = reader.decode(clenHuff);
    if (sym < 16) {
      lengths[i++] = sym;
    } else if (sym === 16) {
      if (i === 0) throw new Error("inflate: repeat with no previous length");
      const prev = lengths[i - 1];
      let repeat = reader.bits(2) + 3;
      while (repeat-- > 0 && i < total) lengths[i++] = prev;
    } else if (sym === 17) {
      let repeat = reader.bits(3) + 3;
      while (repeat-- > 0 && i < total) lengths[i++] = 0;
    } else {
      let repeat = reader.bits(7) + 11;
      while (repeat-- > 0 && i < total) lengths[i++] = 0;
    }
  }

  return {
    litHuff: buildHuffman(lengths.subarray(0, hlit), hlit),
    distHuff: buildHuffman(lengths.subarray(hlit, total), hdist),
  };
}

export interface InflateResult {
  readonly output: Uint8Array;
  readonly bytesConsumed: number;
}

/**
 * Inflate a raw DEFLATE stream that begins at `offset` within `buf`.
 * `bytesConsumed` is measured from `offset`.
 */
export function inflateRawAt(buf: Uint8Array, offset: number): InflateResult {
  if (offset < 0 || offset > buf.length) {
    throw new Error("inflate: offset out of range");
  }
  const reader = new BitReader(buf, offset);
  // Guess a starting capacity; grows as needed.
  const out = new OutBuffer(Math.max(64, (buf.length - offset) * 3));

  let final = 0;
  do {
    final = reader.bits(1);
    const type = reader.bits(2);
    if (type === 0) {
      // Stored (uncompressed) block.
      reader.alignToByte();
      const len = reader.readByteRaw() | (reader.readByteRaw() << 8);
      const nlen = reader.readByteRaw() | (reader.readByteRaw() << 8);
      if ((len ^ 0xffff) !== nlen) {
        throw new Error("inflate: stored block length check failed");
      }
      for (let i = 0; i < len; i++) out.push(reader.readByteRaw());
    } else if (type === 1) {
      inflateBlockData(reader, out, FIXED_LIT, FIXED_DIST);
    } else if (type === 2) {
      const { litHuff, distHuff } = inflateDynamicTables(reader);
      inflateBlockData(reader, out, litHuff, distHuff);
    } else {
      throw new Error("inflate: reserved block type 3");
    }
  } while (final === 0);

  return {
    output: out.toUint8Array(),
    bytesConsumed: reader.bytesConsumed(offset),
  };
}

/**
 * Inflate a zlib (RFC 1950) stream beginning at `offset` within `buf` and
 * report the total number of zlib bytes consumed (2-byte header + DEFLATE body
 * + optional 4-byte preset-dictionary id + 4-byte adler32 trailer).
 */
export function inflateZlibAt(buf: Uint8Array, offset: number): InflateResult {
  if (offset < 0 || offset + 2 > buf.length) {
    throw new Error("inflate: zlib header out of range");
  }
  const cmf = buf[offset];
  const flg = buf[offset + 1];
  if ((cmf & 0x0f) !== 8) {
    throw new Error("inflate: unsupported zlib compression method");
  }
  if (((cmf << 8) | flg) % 31 !== 0) {
    throw new Error("inflate: zlib header checksum failed");
  }
  let deflateStart = offset + 2;
  if (flg & 0x20) {
    // FDICT set: a 4-byte preset dictionary id follows the header.
    if (deflateStart + 4 > buf.length) {
      throw new Error("inflate: truncated zlib preset dictionary id");
    }
    deflateStart += 4;
  }

  const raw = inflateRawAt(buf, deflateStart);
  const headerLen = deflateStart - offset;
  const consumed = headerLen + raw.bytesConsumed + 4; // + adler32 trailer
  if (offset + consumed > buf.length) {
    throw new Error("inflate: truncated zlib adler32 trailer");
  }
  return { output: raw.output, bytesConsumed: consumed };
}
