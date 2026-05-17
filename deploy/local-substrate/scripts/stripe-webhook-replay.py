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

import atexit
import subprocess

SUBSTRATE_DIR = Path(__file__).resolve().parent.parent
CA_PATH = SUBSTRATE_DIR / "caddy" / "runtime" / "pebble-issuance-root.pem"


def cleanup_billing(subject: str | None, customer: str | None) -> None:
    """Wipe the test-created billing_account + webhook_events from D1.

    Best-effort — if docker isn't available (CI without docker-in-docker)
    we skip the cleanup with a stderr breadcrumb. The DELETE uses
    json_extract to compare the exact subject / customer fields so a
    stray substring match (e.g. customer id appearing in a stripe event
    payload for an unrelated subject) can't widen the delete.
    """
    if not subject and not customer:
        return
    docker_ok = subprocess.run(
        ["docker", "info"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if docker_ok.returncode != 0:
        sys.stderr.write(
            "[stripe-webhook-replay] cleanup skipped: docker daemon not "
            "reachable (D1 will accumulate test entries; harmless for "
            "next run)\n",
        )
        return
    try:
        sqlite_path = subprocess.check_output(
            ["docker", "exec", "local-substrate-takosumi-cloud-worker-1",
             "sh", "-c", "find /data/d1 -name '*.sqlite' | head -1"],
            stderr=subprocess.DEVNULL,
        ).decode().strip()
        if not sqlite_path:
            return
        subprocess.run(
            ["docker", "cp",
             f"local-substrate-takosumi-cloud-worker-1:{sqlite_path}",
             "/tmp/d1-stripe-cleanup.sqlite"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        import sqlite3
        con = sqlite3.connect("/tmp/d1-stripe-cleanup.sqlite")
        try:
            if subject:
                con.execute(
                    "DELETE FROM takosumi_accounts_documents "
                    "WHERE json_extract(document, '$.subject') = ?",
                    (subject,),
                )
            if customer:
                con.execute(
                    "DELETE FROM takosumi_accounts_documents "
                    "WHERE json_extract(document, '$.customerId') = ? "
                    "   OR json_extract(document, '$.stripeCustomerId') = ?",
                    (customer, customer),
                )
            con.commit()
        finally:
            con.close()
        subprocess.run(
            ["docker", "cp", "/tmp/d1-stripe-cleanup.sqlite",
             f"local-substrate-takosumi-cloud-worker-1:{sqlite_path}"],
            check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        sys.stderr.write(
            f"[stripe-webhook-replay] cleanup best-effort failed: {exc}\n",
        )


_state: dict[str, str | None] = {"subject": None, "customer": None}
atexit.register(lambda: cleanup_billing(_state["subject"], _state["customer"]))
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


import http.cookiejar

# Shared jar so the worker's OAuth state cookie survives the dance.
_COOKIE_JAR = http.cookiejar.CookieJar()


def request(method: str, path: str, *, body: dict | bytes | None = None,
            headers: dict[str, str] | None = None,
            url: str | None = None) -> tuple[int, dict, str]:
    target = url if url is not None else (BASE + path)
    data: bytes | None
    if isinstance(body, bytes):
        data = body
    elif body is not None:
        data = json.dumps(body).encode()
    else:
        data = None
    req = urllib.request.Request(target, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if data is not None and "Content-Type" not in (headers or {}):
        req.add_header("Content-Type", "application/json")
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=SSL_CTX),
        urllib.request.HTTPCookieProcessor(_COOKIE_JAR),
        _NoRedirect(),
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
    # Mock /authorize → /sign-in/callback?code=..., reusing the jar so
    # the worker's state cookie sticks across the dance.
    _status, headers2, _body2 = request("GET", "", url=headers["Location"])
    loc2 = headers2["Location"]
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


def _event_envelope(event_type: str, obj: dict, *, event_id: str | None = None) -> dict:
    return {
        "id": event_id or ("evt_test_" + secrets.token_hex(8)),
        "object": "event",
        "type": event_type,
        "api_version": "2024-11-20.acacia",
        "created": int(time.time()),
        "data": {"object": obj},
    }


def build_checkout_event(*, event_id: str, subject: str,
                         customer: str, subscription: str) -> dict:
    return _event_envelope("checkout.session.completed", {
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
    }, event_id=event_id)


def build_invoice_paid_event(*, customer: str, subscription: str) -> dict:
    return _event_envelope("invoice.paid", {
        "id": "in_test_" + secrets.token_hex(8),
        "object": "invoice",
        "customer": customer,
        "subscription": subscription,
        "status": "paid",
        "lines": {"data": [{
            "period": {
                "start": int(time.time()) - 3600,
                "end": int(time.time()) + 30 * 86400,
            },
        }]},
    })


def build_invoice_failed_event(*, customer: str) -> dict:
    return _event_envelope("invoice.payment_failed", {
        "id": "in_test_" + secrets.token_hex(8),
        "object": "invoice",
        "customer": customer,
        "status": "open",
        "next_payment_attempt": int(time.time()) + 86400,
        "attempt_count": 1,
    })


def build_subscription_updated_event(*, customer: str, subscription: str) -> dict:
    return _event_envelope("customer.subscription.updated", {
        "id": subscription,
        "object": "subscription",
        "customer": customer,
        "status": "active",
        "current_period_end": int(time.time()) + 30 * 86400,
        "items": {"data": [{"price": {"id": "price_test_basic"}}]},
    })


def build_subscription_deleted_event(*, customer: str, subscription: str) -> dict:
    return _event_envelope("customer.subscription.deleted", {
        "id": subscription,
        "object": "subscription",
        "customer": customer,
        "status": "canceled",
    })


def build_invoice_dunning_updated_event(*, customer: str) -> dict:
    # invoice.updated with dunning signals — backend's normalizer surfaces
    # this as kind='invoice_dunning_updated' only when next_payment_attempt
    # / attempt_count are present in previous_attributes.
    base_obj = {
        "id": "in_test_" + secrets.token_hex(8),
        "object": "invoice",
        "customer": customer,
        "status": "open",
        "next_payment_attempt": int(time.time()) + 86400,
        "attempt_count": 2,
    }
    return {
        "id": "evt_test_" + secrets.token_hex(8),
        "object": "event",
        "type": "invoice.updated",
        "api_version": "2024-11-20.acacia",
        "created": int(time.time()),
        "data": {
            "object": base_obj,
            "previous_attributes": {
                "next_payment_attempt": int(time.time()) - 86400,
                "attempt_count": 1,
            },
        },
    }


def build_invoice_marked_uncollectible_event(*, customer: str) -> dict:
    return _event_envelope("invoice.marked_uncollectible", {
        "id": "in_test_" + secrets.token_hex(8),
        "object": "invoice",
        "customer": customer,
        "status": "uncollectible",
    })


def build_invoice_finalized_event(*, customer: str) -> dict:
    return _event_envelope("invoice.finalized", {
        "id": "in_test_" + secrets.token_hex(8),
        "object": "invoice",
        "customer": customer,
        "status": "open",
        "metadata": {"tax_policy_ref": "tax_policy_v1_local"},
    })


def post_webhook(event: dict, *, ts_offset: int = 0,
                 secret: str = WEBHOOK_SECRET) -> tuple[int, str]:
    payload = json.dumps(event, separators=(",", ":")).encode()
    timestamp = int(time.time()) + ts_offset
    sig = sign_stripe_event(payload, secret, timestamp)
    status, _h, body = request(
        "POST", "/v1/billing/stripe/webhook",
        body=payload,
        headers={"Stripe-Signature": sig, "Content-Type": "application/json"},
    )
    return status, body


def main() -> None:
    print("[1/9] Minting subject via oauth-mock...")
    subject = mint_subject_via_oauth()
    _state["subject"] = subject
    print(f"      subject={subject}")

    event_id = "evt_test_" + secrets.token_hex(8)
    customer = "cus_test_" + secrets.token_hex(8)
    subscription = "sub_test_" + secrets.token_hex(8)
    _state["customer"] = customer

    # ---- checkout: 1st delivery + replay + wrong secret ----
    checkout = build_checkout_event(
        event_id=event_id, subject=subject,
        customer=customer, subscription=subscription,
    )

    print("[2/9] POST checkout.session.completed (first delivery)...")
    status, body = post_webhook(checkout)
    if status != 200:
        sys.exit(f"checkout POST failed: {status} {body}")
    parsed = json.loads(body)
    if not parsed.get("received") or parsed.get("duplicate"):
        sys.exit(f"unexpected first-delivery shape: {parsed}")
    print(f"      {parsed}")

    print("[3/9] Replay same event — expect duplicate=true...")
    status, body = post_webhook(checkout)
    parsed = json.loads(body)
    if status != 200 or not parsed.get("duplicate"):
        sys.exit(f"replay did not de-dup: {status} {parsed}")
    print(f"      {parsed}")

    print("[4/9] Wrong secret — expect 400 invalid_signature...")
    status, body = post_webhook(checkout, secret="whsec_wrong_secret_v0")
    if status != 400:
        sys.exit(f"wrong-secret POST should be 400, got {status}: {body}")
    print(f"      rejected with 400 as expected")

    print("[5/9] Timestamp 6min old — expect 400 (tolerance is 300s)...")
    stale = build_checkout_event(
        event_id="evt_test_stale_" + secrets.token_hex(8),
        subject=subject, customer=customer, subscription=subscription,
    )
    status, body = post_webhook(stale, ts_offset=-400)
    if status != 400:
        sys.exit(f"stale-timestamp POST should be 400, got {status}: {body}")
    print(f"      rejected with 400 as expected")

    # ---- additional event types ----
    print("[6/9] POST invoice.paid (continuation of same customer)...")
    status, body = post_webhook(
        build_invoice_paid_event(customer=customer, subscription=subscription),
    )
    parsed = json.loads(body)
    if status != 200 or not parsed.get("received"):
        sys.exit(f"invoice.paid failed: {status} {parsed}")
    print(f"      {parsed}")

    print("[7/9] POST invoice.payment_failed...")
    status, body = post_webhook(
        build_invoice_failed_event(customer=customer),
    )
    parsed = json.loads(body)
    if status != 200 or not parsed.get("received"):
        sys.exit(f"invoice.payment_failed failed: {status} {parsed}")
    print(f"      {parsed}")

    print("[8/9] POST customer.subscription.updated...")
    status, body = post_webhook(
        build_subscription_updated_event(customer=customer, subscription=subscription),
    )
    parsed = json.loads(body)
    if status != 200 or not parsed.get("received"):
        sys.exit(f"customer.subscription.updated failed: {status} {parsed}")
    print(f"      {parsed}")

    print("[9/12] POST customer.subscription.deleted...")
    status, body = post_webhook(
        build_subscription_deleted_event(customer=customer, subscription=subscription),
    )
    parsed = json.loads(body)
    if status != 200 or not parsed.get("received"):
        sys.exit(f"customer.subscription.deleted failed: {status} {parsed}")
    print(f"      {parsed}")

    print("[10/12] POST invoice.updated (dunning signal)...")
    status, body = post_webhook(
        build_invoice_dunning_updated_event(customer=customer),
    )
    parsed = json.loads(body)
    if status != 200 or not parsed.get("received"):
        sys.exit(f"invoice.updated dunning failed: {status} {parsed}")
    print(f"      {parsed}")

    print("[11/12] POST invoice.marked_uncollectible...")
    status, body = post_webhook(
        build_invoice_marked_uncollectible_event(customer=customer),
    )
    parsed = json.loads(body)
    if status != 200 or not parsed.get("received"):
        sys.exit(f"invoice.marked_uncollectible failed: {status} {parsed}")
    print(f"      {parsed}")

    print("[12/12] POST invoice.finalized (tax_policy)...")
    status, body = post_webhook(
        build_invoice_finalized_event(customer=customer),
    )
    parsed = json.loads(body)
    if status != 200 or not parsed.get("received"):
        sys.exit(f"invoice.finalized failed: {status} {parsed}")
    print(f"      {parsed}")

    print()
    print(f"OK stripe webhook fully exercised — 5 event types + replay-dedup + "
          f"wrong-secret reject + stale-timestamp reject (initial event={event_id})")


if __name__ == "__main__":
    main()
