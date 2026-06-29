//! Shared secret-redaction for error strings before they reach logs, persisted
//! run records, or any other sink. Both the run-failure path (`main.rs`) and the
//! model-provider error path (`model.rs`) route through `redact_secret_text` so a
//! credential echoed in an upstream error body or a decode error cannot leak via
//! one path while being scrubbed on another.

/// Redact secret-like tokens and emails from a whitespace-delimited message.
/// Also handles the `Bearer <token>` pattern where the token is a separate word.
pub fn redact_secret_text(message: &str) -> String {
    let mut parts: Vec<String> = message
        .split_whitespace()
        .map(|part| {
            if part_contains_secret_token(part) || looks_like_email(part) {
                "<redacted>".to_string()
            } else {
                part.to_string()
            }
        })
        .collect();
    // Bearer tokens follow the literal "Bearer <token>" pattern with a space,
    // so the per-part scan above only covers the token when it carries a known
    // shape. Walk pairs of parts to also redact the trailing token when the
    // preceding part is `Bearer`.
    let mut index = 0;
    while index < parts.len() {
        if parts[index].eq_ignore_ascii_case("bearer")
            && index + 1 < parts.len()
            && parts[index + 1] != "<redacted>"
        {
            parts[index + 1] = "<redacted>".to_string();
        }
        index += 1;
    }
    parts.join(" ")
}

pub fn part_contains_secret_token(part: &str) -> bool {
    // Common provider key shapes. Substring (not whole-token) so embedded
    // tokens inside JSON-like fragments (`"key":"sk-…"`) are still redacted.
    const PREFIX_NEEDLES: &[&str] = &[
        "sk-",
        "sk_live_",
        "sk_test_",
        "ghp_",
        // Google API keys (Gemini / GCP) — `AIza` + 35 chars.
        "AIza",
    ];
    for needle in PREFIX_NEEDLES {
        if part.contains(needle) {
            return true;
        }
    }
    // AWS access key id: literal "AKIA" + 16 base32-ish chars [0-9A-Z]. Scan
    // every starting index because the token may be embedded in a longer
    // word (e.g. JSON quoting).
    let bytes = part.as_bytes();
    if bytes.len() >= 20 {
        for start in 0..=bytes.len().saturating_sub(20) {
            if &bytes[start..start + 4] == b"AKIA"
                && bytes[start + 4..start + 20]
                    .iter()
                    .all(|byte| byte.is_ascii_digit() || byte.is_ascii_uppercase())
            {
                return true;
            }
        }
    }
    // JWT-shaped: `eyJ...` (base64url of a JSON header). Require the prefix
    // plus at least one dot to avoid matching arbitrary words.
    if part.contains("eyJ") && part.contains('.') {
        return true;
    }
    false
}

fn looks_like_email(part: &str) -> bool {
    // Naive shape check: contains exactly one '@' surrounded by non-empty
    // local / domain parts and the domain has at least one dot. Stricter
    // grammars need regex; the heuristic is enough for error-message scrub.
    let Some(at) = part.find('@') else {
        return false;
    };
    if part.matches('@').count() != 1 {
        return false;
    }
    let (local, rest) = part.split_at(at);
    let domain = &rest[1..];
    if local.is_empty() || domain.is_empty() {
        return false;
    }
    domain.contains('.') && domain.bytes().all(|byte| !byte.is_ascii_whitespace())
}
