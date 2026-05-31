use std::collections::BTreeSet;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

pub const TAKOS_INTERNAL_RPC_VERSION: &str = "takos-internal-v3";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TakosActorContext {
    pub actor_account_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_id: Option<String>,
    pub roles: Vec<String>,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub principal_kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct InternalRpcSignInput<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub body: &'a str,
    pub actor: &'a TakosActorContext,
    pub caller: &'a str,
    pub audience: &'a str,
    pub capabilities: &'a [&'a str],
    pub request_id: Option<&'a str>,
    pub nonce: &'a str,
    pub timestamp: &'a str,
    pub secret: &'a str,
}

#[derive(Debug, Clone)]
pub struct SignedInternalRpc {
    pub headers: Vec<(String, String)>,
}

// The agent only *signs* outbound internal RPCs (see `sign_internal_rpc`,
// wired from `control_rpc.rs`). It never receives signed envelopes to verify —
// the `/start` webhook authenticates with a plain bearer token in `main.rs`.
// The verify side below therefore has no production caller; it is kept solely
// as the round-trip counterpart that proves the signing contract in tests, so
// it is gated behind `#[cfg(test)]` rather than left to rot under a blanket
// `#[allow(dead_code)]`. If an inbound HMAC-verified surface is ever added to
// the agent, move this back to a normal `pub` item and wire it there.
#[cfg(test)]
#[derive(Debug, Clone)]
pub struct InternalRpcVerifyInput<'a> {
    pub method: &'a str,
    pub path: &'a str,
    pub query: Option<&'a str>,
    pub body: &'a str,
    pub secret: &'a str,
    pub headers: &'a [(String, String)],
    pub expected_caller: Option<&'a [&'a str]>,
    pub expected_audience: Option<&'a str>,
    pub required_capabilities: &'a [&'a str],
    pub now_ms: Option<i64>,
    pub max_clock_skew_ms: Option<i64>,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedInternalRpc {
    pub actor: TakosActorContext,
    pub caller: String,
    pub audience: String,
    pub capabilities: Vec<String>,
    pub request_id: String,
    pub nonce: String,
    pub timestamp: String,
}

pub fn sign_internal_rpc(input: &InternalRpcSignInput<'_>) -> Result<SignedInternalRpc, String> {
    let actor_context = encode_actor_context(input.actor)?;
    let body_digest = sha256_hex(input.body);
    let request_id = input.request_id.unwrap_or(&input.actor.request_id);
    let capabilities = normalize_capabilities(input.capabilities);
    let canonical = canonical_internal_rpc(&CanonicalInternalRpcParts {
        method: input.method,
        path: input.path,
        query: input.query,
        timestamp: input.timestamp,
        request_id,
        nonce: input.nonce,
        caller: input.caller,
        audience: input.audience,
        capabilities: &capabilities,
        body_digest: &body_digest,
        actor_context: &actor_context,
    });
    let signature = hmac_sha256_hex(input.secret, &canonical)?;
    Ok(SignedInternalRpc {
        headers: vec![
            (
                "x-takos-internal-version".into(),
                TAKOS_INTERNAL_RPC_VERSION.into(),
            ),
            ("x-takos-actor-context".into(), actor_context),
            ("x-takos-body-digest".into(), body_digest),
            ("x-takos-nonce".into(), input.nonce.into()),
            ("x-takos-request-id".into(), request_id.into()),
            ("x-takos-internal-timestamp".into(), input.timestamp.into()),
            ("x-takos-caller".into(), input.caller.into()),
            ("x-takos-audience".into(), input.audience.into()),
            ("x-takos-capabilities".into(), capabilities.join(",")),
            ("x-takos-internal-signature".into(), signature),
        ],
    })
}

#[cfg(test)]
pub fn verify_internal_rpc(
    input: &InternalRpcVerifyInput<'_>,
) -> Result<Option<VerifiedInternalRpc>, String> {
    let version = read_header(input.headers, "x-takos-internal-version");
    if version != Some(TAKOS_INTERNAL_RPC_VERSION) {
        return Ok(None);
    }
    let (
        Some(signature),
        Some(timestamp),
        Some(request_id),
        Some(nonce),
        Some(caller),
        Some(audience),
        Some(body_digest),
        Some(actor_context),
    ) = (
        read_header(input.headers, "x-takos-internal-signature"),
        read_header(input.headers, "x-takos-internal-timestamp"),
        read_header(input.headers, "x-takos-request-id"),
        read_header(input.headers, "x-takos-nonce"),
        read_header(input.headers, "x-takos-caller"),
        read_header(input.headers, "x-takos-audience"),
        read_header(input.headers, "x-takos-body-digest"),
        read_header(input.headers, "x-takos-actor-context"),
    )
    else {
        return Ok(None);
    };

    if !timestamp_within_skew(timestamp, input.now_ms, input.max_clock_skew_ms) {
        return Ok(None);
    }
    if let Some(expected) = input.expected_caller {
        if !expected.contains(&caller) {
            return Ok(None);
        }
    }
    if input
        .expected_audience
        .is_some_and(|expected| expected != audience)
    {
        return Ok(None);
    }
    let capabilities =
        normalize_capability_header(read_header(input.headers, "x-takos-capabilities"));
    for capability in input.required_capabilities {
        if !capabilities.iter().any(|value| value == capability) {
            return Ok(None);
        }
    }
    if sha256_hex(input.body) != body_digest {
        return Ok(None);
    }
    let actor = decode_actor_context(actor_context)?;
    if actor.request_id != request_id {
        return Ok(None);
    }
    let canonical = canonical_internal_rpc(&CanonicalInternalRpcParts {
        method: input.method,
        path: input.path,
        query: input.query,
        timestamp,
        request_id,
        nonce,
        caller,
        audience,
        capabilities: &capabilities,
        body_digest,
        actor_context,
    });
    let expected_signature = hmac_sha256_hex(input.secret, &canonical)?;
    if !constant_time_eq(&expected_signature, signature) {
        return Ok(None);
    }
    Ok(Some(VerifiedInternalRpc {
        actor,
        caller: caller.into(),
        audience: audience.into(),
        capabilities,
        request_id: request_id.into(),
        nonce: nonce.into(),
        timestamp: timestamp.into(),
    }))
}

struct CanonicalInternalRpcParts<'a> {
    method: &'a str,
    path: &'a str,
    query: Option<&'a str>,
    timestamp: &'a str,
    request_id: &'a str,
    nonce: &'a str,
    caller: &'a str,
    audience: &'a str,
    capabilities: &'a [String],
    body_digest: &'a str,
    actor_context: &'a str,
}

fn canonical_internal_rpc(parts: &CanonicalInternalRpcParts<'_>) -> String {
    [
        TAKOS_INTERNAL_RPC_VERSION,
        &parts.method.to_uppercase(),
        &path_with_query(parts.path, parts.query),
        parts.timestamp,
        parts.request_id,
        parts.nonce,
        parts.caller,
        parts.audience,
        &parts.capabilities.join(","),
        parts.body_digest,
        parts.actor_context,
    ]
    .join("\n")
}

fn encode_actor_context(actor: &TakosActorContext) -> Result<String, String> {
    serde_json::to_string(actor)
        .map(|json| STANDARD.encode(json.as_bytes()))
        .map_err(|error| error.to_string())
}

#[cfg(test)]
fn decode_actor_context(value: &str) -> Result<TakosActorContext, String> {
    let bytes = STANDARD.decode(value).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn normalize_capabilities(capabilities: &[&str]) -> Vec<String> {
    capabilities
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(String::from)
        .collect()
}

#[cfg(test)]
fn normalize_capability_header(value: Option<&str>) -> Vec<String> {
    value
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(String::from)
        .collect()
}

#[cfg(test)]
fn read_header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn path_with_query(path: &str, query: Option<&str>) -> String {
    match query.filter(|value| !value.is_empty()) {
        Some(query) if query.starts_with('?') => format!("{path}{query}"),
        Some(query) => format!("{path}?{query}"),
        None => path.into(),
    }
}

#[cfg(test)]
fn timestamp_within_skew(
    timestamp: &str,
    now_ms: Option<i64>,
    max_clock_skew_ms: Option<i64>,
) -> bool {
    let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(timestamp) else {
        return false;
    };
    let now = now_ms.unwrap_or_else(current_time_ms);
    let skew = max_clock_skew_ms.unwrap_or(5 * 60 * 1000);
    (now - parsed.timestamp_millis()).abs() <= skew
}

#[cfg(test)]
fn current_time_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| {
            // i64 ms holds dates well past year 292,000,000 — safe in practice.
            #[allow(clippy::cast_possible_truncation)]
            let millis = duration.as_millis() as i64;
            millis
        })
        .unwrap_or(0)
}

fn sha256_hex(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))
}

fn hmac_sha256_hex(secret: &str, message: &str) -> Result<String, String> {
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).map_err(|error| error.to_string())?;
    mac.update(message.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

#[cfg(test)]
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes()
        .zip(b.bytes())
        .fold(0_u8, |diff, (left, right)| diff | (left ^ right))
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn actor() -> TakosActorContext {
        TakosActorContext {
            actor_account_id: "acct_1".into(),
            space_id: Some("space_1".into()),
            roles: vec!["owner".into()],
            request_id: "req_v3".into(),
            principal_kind: Some("account".into()),
            service_id: None,
            agent_id: None,
        }
    }

    #[test]
    fn signs_and_verifies_v3_internal_rpc() {
        let actor = actor();
        let signed = sign_internal_rpc(&InternalRpcSignInput {
            method: "post",
            path: "/api/internal/v1/runtime/agents/agent_1/heartbeat",
            query: Some("?trace=1"),
            body: "{\"agentId\":\"agent_1\"}",
            actor: &actor,
            caller: "takos-agent",
            audience: "takosumi",
            capabilities: &["runtime-agent.heartbeat"],
            request_id: None,
            nonce: "nonce_1",
            timestamp: "2026-05-01T00:00:00.000Z",
            secret: "test-secret",
        })
        .expect("sign");

        let verified = verify_internal_rpc(&InternalRpcVerifyInput {
            method: "POST",
            path: "/api/internal/v1/runtime/agents/agent_1/heartbeat",
            query: Some("?trace=1"),
            body: "{\"agentId\":\"agent_1\"}",
            secret: "test-secret",
            headers: &signed.headers,
            expected_caller: Some(&["takos-agent"]),
            expected_audience: Some("takosumi"),
            required_capabilities: &["runtime-agent.heartbeat"],
            now_ms: Some(1_777_593_630_000),
            max_clock_skew_ms: Some(i64::MAX),
        })
        .expect("verify")
        .expect("verified");

        assert_eq!(verified.actor.actor_account_id, "acct_1");
        assert_eq!(verified.caller, "takos-agent");
        assert_eq!(verified.audience, "takosumi");
        assert_eq!(verified.capabilities, vec!["runtime-agent.heartbeat"]);
    }

    #[test]
    fn rejects_body_and_capability_mismatch() {
        let actor = actor();
        let signed = sign_internal_rpc(&InternalRpcSignInput {
            method: "GET",
            path: "/internal/repositories",
            query: None,
            body: "",
            actor: &actor,
            caller: "takos-agent",
            audience: "takos-git",
            capabilities: &["git.repo.read"],
            request_id: None,
            nonce: "nonce_2",
            timestamp: "2026-05-01T00:00:00.000Z",
            secret: "test-secret",
        })
        .expect("sign");

        assert!(verify_internal_rpc(&InternalRpcVerifyInput {
            method: "GET",
            path: "/internal/repositories",
            query: None,
            body: "tampered",
            secret: "test-secret",
            headers: &signed.headers,
            expected_caller: Some(&["takos-agent"]),
            expected_audience: Some("takos-git"),
            required_capabilities: &["git.repo.read"],
            now_ms: Some(1_777_593_630_000),
            max_clock_skew_ms: Some(i64::MAX),
        })
        .expect("verify")
        .is_none());

        assert!(verify_internal_rpc(&InternalRpcVerifyInput {
            method: "GET",
            path: "/internal/repositories",
            query: None,
            body: "",
            secret: "test-secret",
            headers: &signed.headers,
            expected_caller: Some(&["takos-agent"]),
            expected_audience: Some("takos-git"),
            required_capabilities: &["git.repo.write"],
            now_ms: Some(1_777_593_630_000),
            max_clock_skew_ms: Some(i64::MAX),
        })
        .expect("verify")
        .is_none());
    }
}
