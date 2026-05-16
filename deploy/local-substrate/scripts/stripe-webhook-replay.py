#!/usr/bin/env python3
"""
Replays a Stripe webhook event against the local-substrate cloud worker,
signing it with the local fixture WEBHOOK_SECRET so the worker's signature
verification passes. Walks:

  1. Mint an account subject via the existing oauth-mock flow (so the
     event has a real subject to attach billing state to).
  2. Build a Stripe checkout.session.completed event referencing that
     subject (via client_reference_id).
  3. Sign with HMAC-SHA256(timestamp + '.' + payload) using
     'whsec_local_substrate_fixture_v1'.
  4. POST /v1/billing/stripe/webhook with the Stripe-Signature header.
  5. Assert received=true, duplicate=false, status="applied" (or similar).
  6. Replay the same event → assert duplicate=true (idempotency).

Run as: scripts/stripe-webhook-replay.py
"""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SUBSTRATE_DIR = Path(__file__).resolve().parent.parent
CA_PATH = SUBSTRATE_DIR / "caddy" / "runtime" / "pebble-issuance-root.pem"
BASE = "https://cloud.takosumi.test"
WEBHOOK_SECRET = "whsec_local_substrate_fixture_v1"

if not CA_PATH.exists():
    sys.exit(f"Pebble CA not found at {CA_PATH} — run scripts/up.sh first")

SSL_CTX = ssl.create_default_context(cafile=str(CA_PATH))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def http_error_302(self, req, fp, code, msg, headers):  # noqa: D401
        return fp

    http_error_301 = http_error_303 = http_error_307 = http_error_308 = (
        http_error_302
    )


def request(method: str, path: str, *, body: dict | bytes | None = None,
            headers: dict[str, str] | None = None) -> tuple[int, dict, str]:
    url = BASE + path
    data: bytes | None
    if isinstance(body, bytes):
        data = body
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if data is not None and "Content-Type" not in (headers or {}):
        req.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=SSL_CTX), _NoRedirect(),
    )
    try:
        with opener.open(req) as resp:
            return resp.status, dict(resp.headers), resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode() if exc.fp else ""


def mint_subject_via_oauth() -> str:
    state = "stripe_e2e_" + secrets.token_hex(8)
    status, headers, _body = request(
        "GET",
        f"/v1/auth/upstream/authorize?provider=google&state={state}",
    )
    if status != 302:
        sys.exit(f"oauth authorize did not 302 (got {status})")
    loc = headers["Location"]
    req = urllib.request.Request(loc)
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=SSL_CTX), _NoRedirect(),
    )
    with opener.open(req) as resp:
        loc2 = resp.headers["Location"]
    code = urllib.parse.parse_qs(urllib.parse.urlparse(loc2).query)["code"][0]
    status, _h, body = request(
        "GET",
        f"/v1/auth/upstream/callback?provider=google&code={code}&state={state}",
    )
    if status != 200:
        sys.exit(f"oauth callback failed: {status} {body}")
    return json.loads(body)["subject"]


def sign_stripe_event(payload: bytes, secret: str, timestamp: int) -> str:
    """Stripe webhook signature: t=<unix>,v1=<hex hmac sha256 of t.payload>"""
    signed = f"{timestamp}.{payload.decode()}".encode()
    sig = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={sig}"


def build_checkout_event(*, event_id: str, subject: str,
                         customer: str, subscription: str) -> dict:
    """Minimal checkout.session.completed event shape with the fields the
    accounts-service normalizer needs. Subject is read from metadata
    .takosumi_subject (not client_reference_id)."""
    return {
        "id": event_id,
        "object": "event",
        "type": "checkout.session.completed",
        "api_version": "2024-11-20.acacia",
        "created": int(time.time()),
        "data": {
            "object": {
                "id": "cs_test_" + secrets.token_hex(8),
                "object": "checkout.session",
                "client_reference_id": subject,
                "customer": customer,
                "subscription": subscription,
                "payment_status": "paid",
                "status": "complete",
                "mode": "subscription",
                "metadata": {
                    "takosumi_subject": subject,
                    "plan_code": "local-test-plan",
                },
            },
        },
    }


def post_webhook(event: dict) -> tuple[int, str]:
    payload = json.dumps(event, separators=(",", ":")).encode()
    timestamp = int(time.time())
    sig = sign_stripe_event(payload, WEBHOOK_SECRET, timestamp)
    status, _h, body = request(
        "POST", "/v1/billing/stripe/webhook",
        body=payload,
        headers={"Stripe-Signature": sig, "Content-Type": "application/json"},
    )
    return status, body


def main() -> None:
    print("[1/4] Minting subject via oauth-mock...")
    subject = mint_subject_via_oauth()
    print(f"      subject={subject}")

    event_id = "evt_test_" + secrets.token_hex(8)
    customer = "cus_test_" + secrets.token_hex(8)
    subscription = "sub_test_" + secrets.token_hex(8)
    event = build_checkout_event(
        event_id=event_id, subject=subject,
        customer=customer, subscription=subscription,
    )

    print("[2/4] POSTing checkout.session.completed webhook...")
    status, body = post_webhook(event)
    if status != 200:
        sys.exit(f"webhook POST failed: {status} {body}")
    parsed = json.loads(body)
    if not parsed.get("received"):
        sys.exit(f"received=false: {parsed}")
    if parsed.get("duplicate"):
        sys.exit(f"first delivery should not be duplicate: {parsed}")
    print(f"      {parsed}")

    print("[3/4] Replaying same event to verify idempotency...")
    status, body = post_webhook(event)
    if status != 200:
        sys.exit(f"replay POST failed: {status} {body}")
    parsed2 = json.loads(body)
    if not parsed2.get("duplicate"):
        sys.exit(f"second delivery should be duplicate: {parsed2}")
    print(f"      {parsed2}")

    print("[4/4] Verifying signature rejection (wrong secret)...")
    payload = json.dumps(event, separators=(",", ":")).encode()
    timestamp = int(time.time())
    bad_sig = sign_stripe_event(payload, "whsec_wrong_secret", timestamp)
    status, _h, body = request(
        "POST", "/v1/billing/stripe/webhook",
        body=payload,
        headers={"Stripe-Signature": bad_sig, "Content-Type": "application/json"},
    )
    if status != 400:
        sys.exit(f"wrong-secret POST should be 400, got {status}: {body}")
    print(f"      rejected with 400 as expected")

    print()
    print(f"OK stripe webhook verified — event_id={event_id} "
          f"first.status={parsed.get('status')} dup.status={parsed2.get('status')}")


if __name__ == "__main__":
    main()
