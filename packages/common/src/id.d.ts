/**
 * ID Generation Utilities
 *
 * Provides cryptographically secure random ID generation
 * for use across all takos packages.
 */
/**
 * Generate a cryptographically secure random ID using alphanumeric characters.
 *
 * Uses crypto.getRandomValues() for secure randomness.
 * Character set: lowercase letters and digits (36 chars).
 *
 * @param length - Length of the ID (default: 12)
 * @returns Random alphanumeric string
 *
 * @example
 * ```typescript
 * const id = generateId(); // e.g., "a1b2c3d4e5f6"
 * const longId = generateId(24); // e.g., "a1b2c3d4e5f6g7h8i9j0k1l2"
 * ```
 */
export declare function generateId(length?: number): string;
//# sourceMappingURL=id.d.ts.map