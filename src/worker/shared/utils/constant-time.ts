/**
 * Compare two strings in constant time over their UTF-8 representation.
 *
 * The length difference is folded into the accumulator and the loop visits
 * every byte in the longer operand. This keeps callers from accidentally
 * short-circuiting on a length mismatch and makes the comparison semantics
 * explicit for secrets containing multi-byte characters.
 */
export function constantTimeEqualsString(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
