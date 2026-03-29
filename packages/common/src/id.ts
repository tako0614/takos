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
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}
