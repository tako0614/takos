/**
 * Validation Utilities
 *
 * Provides common validation functions for input sanitization
 * and security across all takos packages.
 */
/**
 * Check if a hostname is localhost or a local address.
 *
 * @param hostname - Hostname to check
 * @returns true if the hostname is local
 */
export declare function isLocalhost(hostname: string): boolean;
/**
 * Check if an IP address is a private/internal address.
 *
 * @param ip - IP address to check
 * @returns true if the IP is private
 */
export declare function isPrivateIP(ip: string): boolean;
//# sourceMappingURL=validation.d.ts.map