/**
 * Git pkt-line format encoder/decoder.
 *
 * pkt-line format:
 *   - 4-char hex length prefix (includes the 4 bytes themselves)
 *   - "0000" = flush packet
 *   - "0001" = delimiter packet
 */
export declare function encodePktLine(data: string | Uint8Array): Uint8Array;
export declare function flushPkt(): Uint8Array;
export declare function delimPkt(): Uint8Array;
export interface PktLine {
    type: 'data' | 'flush' | 'delim';
    data?: Uint8Array;
}
export declare function parsePktLines(input: Uint8Array): PktLine[];
export declare function pktLineText(line: PktLine): string;
/**
 * Build a response from multiple pkt-line segments.
 */
export declare function buildPktLineResponse(...segments: Uint8Array[]): Uint8Array;
/**
 * Encode a side-band-64k frame.
 * Channel 1 = pack data, Channel 2 = progress, Channel 3 = error
 */
export declare function encodeSideBandData(channel: number, data: Uint8Array): Uint8Array;
//# sourceMappingURL=pkt-line.d.ts.map