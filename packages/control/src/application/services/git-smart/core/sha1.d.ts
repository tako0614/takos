/**
 * SHA-1 hashing using Web Crypto API (crypto.subtle).
 * Used for standard git object ID computation.
 */
import { hexToBytes } from '../../../../shared/utils/encoding-utils';
export declare function sha1(data: Uint8Array): Promise<string>;
export declare function sha1Bytes(data: Uint8Array): Promise<ArrayBuffer>;
export declare function hexFromBuffer(buffer: ArrayBuffer): string;
export { hexToBytes };
export declare function concatBytes(...arrays: Uint8Array[]): Uint8Array;
//# sourceMappingURL=sha1.d.ts.map