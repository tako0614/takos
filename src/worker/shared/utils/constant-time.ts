/**
 * Compare two strings in constant time over their UTF-8 representation.
 *
 * The length difference is folded into the accumulator and the loop visits
 * the longer operand, so unequal lengths do not short-circuit the check.
 */
const textEncoder = new TextEncoder();

export function constantTimeEqualsString(left: string, right: string): boolean {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}
