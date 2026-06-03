//! Shared stable hashing for identity / idempotency keys.

/// FNV-1a 64-bit hash of `value`, formatted as lowercase hex.
///
/// Used for both assistant-message idempotency keys (`control_rpc`) and stable
/// tool-call IDs (`tool_bridge`). Both depend on the hash staying byte-stable
/// over time, so they share one implementation — a copy-paste would let a future
/// tweak to one silently diverge the other (duplicate messages / unstable IDs).
pub fn fnv1a_hex(value: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:x}")
}
