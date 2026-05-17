#!/usr/bin/env python3
"""
Passkey register + authenticate E2E against the local-substrate cloud worker.

Walks:
  1. Mint a subject via the upstream OAuth flow (existing oauth-mock).
  2. POST /v1/auth/passkeys/register/options {subject}  → challenge + rp+user
  3. Generate a fresh P-256 keypair (the 'authenticator').
  4. POST /v1/auth/passkeys/register/complete {subject, credentialId, publicKeyJwk}
  5. POST /v1/auth/passkeys/authenticate/options {subject}  → challenge
  6. Build authenticatorData + clientDataJSON, sign with the private key.
  7. POST /v1/auth/passkeys/authenticate/complete and assert a session record
     comes back.

Run as: scripts/passkey-e2e.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import ssl
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, utils as ec_utils

import atexit
import subprocess

SUBSTRATE_DIR = Path(__file__).resolve().parent.parent
CA_PATH = SUBSTRATE_DIR / "caddy" / "runtime" / "pebble-issuance-root.pem"


def cleanup_subject(subject: str | None, credential_id: str | None) -> None:
    """Remove the test-created subject and passkey credential from D1.
    Backend doesn't expose DELETE endpoints for either yet, so we go
    straight to the sqlite file via docker cp + python sqlite3.

    Best-effort — if docker isn't available (CI without docker-in-docker)
    we skip the cleanup with a stderr breadcrumb so D1 accumulation is
    visible but the smoke itself is not affected.
    """
    if not subject and not credential_id:
        return
    docker_ok = subprocess.run(
        ["docker", "info"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if docker_ok.returncode != 0:
        sys.stderr.write(
            "[passkey-e2e] cleanup skipped: docker daemon not reachable "
            "(D1 will accumulate test entries; harmless for next run)\n",
        )
        return
    try:
        sqlite_path = subprocess.check_output(
            [
                "docker", "exec", "local-substrate-takosumi-cloud-worker-1",
                "sh", "-c", "find /data/d1 -name '*.sqlite' | head -1",
            ],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        if not sqlite_path:
            return
        subprocess.run(
            ["docker", "cp",
             f"local-substrate-takosumi-cloud-worker-1:{sqlite_path}",
             "/tmp/d1-cleanup.sqlite"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        import sqlite3
        con = sqlite3.connect("/tmp/d1-cleanup.sqlite")
        # The document column is JSON. Use json_extract so a stray
        # 'credentialId' or 'subject' substring inside unrelated text
        # can't accidentally widen the DELETE.
        try:
            cur = con.cursor()
            if credential_id:
                cur.execute(
                    "DELETE FROM takosumi_accounts_documents "
                    "WHERE json_extract(document, '$.credentialId') = ?",
                    (credential_id,),
                )
            if subject:
                cur.execute(
                    "DELETE FROM takosumi_accounts_documents "
                    "WHERE json_extract(document, '$.subject') = ?",
                    (subject,),
                )
            con.commit()
        finally:
            con.close()
        subprocess.run(
            ["docker", "cp", "/tmp/d1-cleanup.sqlite",
             f"local-substrate-takosumi-cloud-worker-1:{sqlite_path}"],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        sys.stderr.write(
            f"[passkey-e2e] cleanup best-effort failed: {exc}\n",
        )


# Mutable holder so atexit can read the final subject/credential
_state: dict[str, str | None] = {"subject": None, "credential_id": None}
atexit.register(lambda: cleanup_subject(_state["subject"], _state["credential_id"]))
RP_ID = "cloud.takosumi.test"
ORIGIN = "https://cloud.takosumi.test"
BASE = "https://cloud.takosumi.test"

if not CA_PATH.exists():
    sys.exit(f"Pebble CA not found at {CA_PATH} — run scripts/up.sh first")

SSL_CTX = ssl.create_default_context(cafile=str(CA_PATH))


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def b64url_decode(s: str) -> bytes:
    s = s + "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


import http.cookiejar

# Single jar persisted across the OAuth dance so the worker's state-binding
# cookie (set on /authorize) is sent back on /callback. Without this the
# worker's CSRF defense (state-cookie vs query-state comparison) fails.
_COOKIE_JAR = http.cookiejar.CookieJar()


def http_request(method: str, path: str, body: dict | None = None,
                 follow: bool = False, url: str | None = None) -> tuple[int, dict, str]:
    target = url if url is not None else (BASE + path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(target, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=SSL_CTX),
        urllib.request.HTTPCookieProcessor(_COOKIE_JAR),
        urllib.request.HTTPRedirectHandler() if follow else _NoRedirectHandler(),
    )
    try:
        with opener.open(req) as resp:
            return resp.status, dict(resp.headers), resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode() if exc.fp else ""


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):  # noqa: D401
        return fp

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = (
        http_error_302
    )


def mint_subject_via_oauth() -> str:
    state = "passkey_e2e_" + secrets.token_hex(8)
    status, headers, _body = http_request(
        "GET", f"/v1/auth/upstream/authorize?provider=google&state={state}",
    )
    if status != 302:
        sys.exit(f"oauth authorize did not 302 (got {status})")
    loc = headers["Location"]
    # follow mock /authorize → /sign-in/callback?code=..., reusing the
    # shared cookie jar so the worker's state cookie survives the dance.
    _status, headers2, _body2 = http_request("GET", "", url=loc)
    loc2 = headers2["Location"]
    code = urllib.parse.parse_qs(urllib.parse.urlparse(loc2).query)["code"][0]
    status, _headers, body = http_request(
        "GET",
        f"/v1/auth/upstream/callback?provider=google&code={code}&state={state}",
    )
    if status != 200:
        sys.exit(f"oauth callback failed: {status} {body}")
    data = json.loads(body)
    return data["subject"]


def make_authenticator_data(rp_id: str, sign_count: int = 1) -> bytes:
    """Minimal WebAuthn authenticatorData: rpIdHash(32) | flags(1) | counter(4).
    For an assertion we only need UP (user present, 0x01)."""
    rp_id_hash = hashlib.sha256(rp_id.encode()).digest()
    flags = bytes([0x01])  # UP
    counter = sign_count.to_bytes(4, "big")
    return rp_id_hash + flags + counter


def main() -> None:
    print("[1/7] Minting an account subject via the oauth-mock...")
    subject = mint_subject_via_oauth()
    _state["subject"] = subject
    print(f"      subject={subject}")

    print("[2/7] Generating a fresh P-256 keypair as our virtual authenticator...")
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_numbers = private_key.public_key().public_numbers()
    # P-256: x and y are 32 bytes each, big-endian.
    pub_x = public_numbers.x.to_bytes(32, "big")
    pub_y = public_numbers.y.to_bytes(32, "big")
    public_key_jwk = {
        "kty": "EC",
        "crv": "P-256",
        "x": b64url_encode(pub_x),
        "y": b64url_encode(pub_y),
    }
    credential_id = b64url_encode(secrets.token_bytes(32))
    _state["credential_id"] = credential_id
    print(f"      credentialId={credential_id[:20]}...")

    print("[3/7] POST /v1/auth/passkeys/register/options...")
    status, _h, body = http_request(
        "POST", "/v1/auth/passkeys/register/options", {"subject": subject},
    )
    if status != 200:
        sys.exit(f"register/options failed: {status} {body}")
    reg_opts = json.loads(body)
    print(f"      challenge={reg_opts.get('challenge', '')[:24]}...")

    print("[4/7] POST /v1/auth/passkeys/register/complete...")
    status, _h, body = http_request(
        "POST", "/v1/auth/passkeys/register/complete",
        {
            "subject": subject,
            "credentialId": credential_id,
            "publicKeyJwk": public_key_jwk,
            "signCount": 0,
            "transports": ["internal"],
        },
    )
    if status != 200:
        sys.exit(f"register/complete failed: {status} {body}")
    print(f"      registered: {json.loads(body)}")

    print("[5/7] POST /v1/auth/passkeys/authenticate/options...")
    status, _h, body = http_request(
        "POST", "/v1/auth/passkeys/authenticate/options",
        {"subject": subject},
    )
    if status != 200:
        sys.exit(f"authenticate/options failed: {status} {body}")
    auth_opts = json.loads(body)
    challenge = auth_opts["challenge"]
    print(f"      auth challenge={challenge[:24]}...")

    print("[6/7] Building assertion + signing with the private key...")
    authenticator_data = make_authenticator_data(RP_ID, sign_count=1)
    client_data = json.dumps({
        "type": "webauthn.get",
        "challenge": challenge,
        "origin": ORIGIN,
    }, separators=(",", ":")).encode()
    signed_data = authenticator_data + hashlib.sha256(client_data).digest()
    der_sig = private_key.sign(signed_data, ec.ECDSA(hashes.SHA256()))
    r, s = ec_utils.decode_dss_signature(der_sig)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    print("[7/7] POST /v1/auth/passkeys/authenticate/complete...")
    status, _h, body = http_request(
        "POST", "/v1/auth/passkeys/authenticate/complete",
        {
            "credentialId": credential_id,
            "expectedChallenge": challenge,
            "authenticatorData": b64url_encode(authenticator_data),
            "clientDataJSON": b64url_encode(client_data),
            "signature": b64url_encode(raw_sig),
        },
    )
    if status != 200:
        sys.exit(f"authenticate/complete failed: {status} {body}")
    auth_resp = json.loads(body)
    if not auth_resp.get("subject") or not auth_resp.get("session_id"):
        sys.exit(f"authenticate/complete returned unexpected shape: {auth_resp}")

    print()
    print(f"OK passkey register + assert verified — "
          f"subject={auth_resp['subject'][:24]}... "
          f"session={auth_resp['session_id'][:24]}...")


if __name__ == "__main__":
    main()
