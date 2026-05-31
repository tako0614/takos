/**
 * ID 生成ユーティリティ
 *
 * すべての Takos パッケージで利用できる
 * 暗号学的に安全なランダム ID 生成を提供する。
 */

/**
 * 英数字を使って暗号学的に安全なランダム ID を生成する。
 *
 * 安全性確保のため `crypto.getRandomValues()` を利用する。
 * 使用文字セットは英小文字 + 数字（計 36 文字）。
 *
 * @param length - ID の長さ（既定値: 12）
 * @returns 英数字から生成されるランダム文字列
 *
 * @example
 * ```typescript
 * const id = generateId(); // 例: "a1b2c3d4e5f6"
 * const longId = generateId(24); // 例: "a1b2c3d4e5f6g7h8i9j0k1l2"
 * ```
 */
export function generateId(length: number = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  // Rejection sampling: 256 is not a multiple of 36, so a naive `byte % 36`
  // would over-represent the first (256 % 36 = 4) characters. We discard any
  // byte at or above the largest multiple of 36 that fits in a byte so every
  // accepted byte maps to a uniformly distributed character.
  const acceptLimit = 256 - (256 % chars.length); // 252
  let result = "";
  // Over-allocate the random pool to amortize getRandomValues calls; refill
  // only on the rare occasion that rejections exhaust the buffer.
  let pool = new Uint8Array(0);
  let poolIndex = 0;
  while (result.length < length) {
    if (poolIndex >= pool.length) {
      pool = new Uint8Array(Math.max(length, 16));
      crypto.getRandomValues(pool);
      poolIndex = 0;
    }
    const byte = pool[poolIndex++];
    if (byte >= acceptLimit) continue; // reject to avoid modulo bias
    result += chars[byte % chars.length];
  }
  return result;
}
