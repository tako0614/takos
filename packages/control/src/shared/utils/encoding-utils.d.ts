/** Convert a Uint8Array to a lowercase hex string. */
export declare function bytesToHex(bytes: Uint8Array): string;
/** Convert a hex string to a Uint8Array. */
export declare function hexToBytes(hex: string): Uint8Array;
/** Convert a Uint8Array to a standard base64 string. */
export declare function bytesToBase64(bytes: Uint8Array): string;
/** Convert a standard base64 string to a Uint8Array. */
export declare function base64ToBytes(base64: string): Uint8Array;
/** Compute SHA-256 of a string or ArrayBuffer and return the hex digest. */
export declare function sha256Hex(data: string | ArrayBuffer): Promise<string>;
export declare function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string;
export declare function base64UrlDecode(input: string): Uint8Array;
//# sourceMappingURL=encoding-utils.d.ts.map