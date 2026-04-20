/**
 * Activity Delivery Service — delivers ActivityPub activities to follower inboxes.
 *
 * Fetches each follower's actor document to resolve their inbox URL,
 * then POSTs the activity JSON with HTTP Signature authentication.
 *
 * Round 11 (delivery retry queue):
 * `deliverToFollowers` attempts each inbox once inline for fast-path
 * latency, then persists any failed (or unresolvable) inbox into
 * `ap_delivery_queue` via `enqueueDelivery`. The hourly cron
 * (`tickDeliveryQueue`) replays the queue on an exponential backoff
 * ladder until either 2xx or the DLQ threshold is reached. This closes
 * the Round 11 audit finding that failed deliveries were silently dropped.
 */

import type { D1Database } from "../../../shared/types/bindings.ts";
import { listFollowers } from "./followers.ts";
import { apFetch, assertSafeUrl } from "./remote-store-client.ts";
import { logError, logInfo, logWarn } from "../../../shared/utils/logger.ts";
import { enqueueDelivery } from "./delivery-queue.ts";

const AP_CONTENT_TYPE = "application/activity+json";
const DELIVERY_BATCH_SIZE = 50;
const FETCH_TIMEOUT_MS = 10_000;
/** Delay before the first retry of a delivery that failed the immediate attempt. */
const INITIAL_RETRY_DELAY_MS = 60_000;

export interface DeliveryResult {
  delivered: number;
  failed: number;
  /** Entries persisted into `ap_delivery_queue` for retry (failed first attempts). */
  requeued?: number;
}

export type ActivityDeliverySigning = {
  signingKeyPem: string;
  keyId: string;
};

export function resolveActivityDeliverySigning(
  env: { PLATFORM_PRIVATE_KEY?: string },
  actorUrl: string,
): ActivityDeliverySigning | null {
  const signingKeyPem = env.PLATFORM_PRIVATE_KEY?.trim();
  if (!signingKeyPem) {
    return null;
  }
  return {
    signingKeyPem,
    keyId: `${actorUrl}#main-key`,
  };
}

/**
 * Delivers an activity to all followers of an actor.
 * Fetches each follower's inbox URL and POSTs the activity.
 *
 * Delivery semantics:
 *   1. For each follower, resolve the inbox URL and attempt one inline POST.
 *   2. Successful inboxes increment `delivered`.
 *   3. Failed inboxes (or unresolvable followers that had a known inbox URL)
 *      are persisted into `ap_delivery_queue` so the hourly cron can retry
 *      them with exponential backoff. They increment `failed` + `requeued`.
 *
 * Individual failures never throw; callers can rely on this function
 * completing even when every inbox errors.
 */
export async function deliverToFollowers(
  dbBinding: D1Database,
  actorUrl: string,
  activity: Record<string, unknown>,
  signingKeyPem: string,
  keyId: string,
): Promise<DeliveryResult> {
  let delivered = 0;
  let failed = 0;
  let requeued = 0;
  let offset = 0;

  const activityId = typeof activity.id === "string" && activity.id.length > 0
    ? activity.id
    : `${actorUrl}#${new Date().toISOString()}`;

  // Paginate through all followers
  while (true) {
    const page = await listFollowers(dbBinding, actorUrl, {
      limit: DELIVERY_BATCH_SIZE,
      offset,
    });

    if (page.items.length === 0) break;

    const results = await Promise.allSettled(
      page.items.map(async (followerActorUrl): Promise<
        { ok: true } | { ok: false; inboxUrl: string | null }
      > => {
        try {
          const inboxUrl = await resolveInbox(followerActorUrl);
          if (!inboxUrl) {
            logWarn("Could not resolve inbox for follower", {
              action: "activity_delivery",
              followerActorUrl,
            });
            return { ok: false, inboxUrl: null };
          }

          const success = await signAndDeliver(
            inboxUrl,
            activity,
            signingKeyPem,
            keyId,
          );
          return success ? { ok: true } : { ok: false, inboxUrl };
        } catch (err) {
          logError("Failed to deliver activity to follower", err, {
            action: "activity_delivery",
            followerActorUrl,
          });
          return { ok: false, inboxUrl: null };
        }
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.ok) {
        delivered++;
        continue;
      }
      failed++;

      // Persist failed inboxes into the retry queue. Unresolvable followers
      // (no inbox URL) cannot be retried against a specific inbox, so we
      // skip the enqueue for those — there is nothing to POST to.
      if (
        result.status === "fulfilled" && !result.value.ok &&
        result.value.inboxUrl
      ) {
        try {
          await enqueueDelivery({
            db: dbBinding,
            activityId,
            inboxUrl: result.value.inboxUrl,
            payload: activity,
            signingKeyId: keyId,
            initialDelayMs: INITIAL_RETRY_DELAY_MS,
            initialAttempts: 1,
          });
          requeued++;
        } catch (enqueueErr) {
          logError("Failed to enqueue delivery for retry", enqueueErr, {
            action: "activity_delivery_enqueue",
            inboxUrl: result.value.inboxUrl,
            activityId,
          });
        }
      }
    }

    offset += page.items.length;
    if (offset >= page.total) break;
  }

  if (delivered > 0 || failed > 0 || requeued > 0) {
    logInfo("Activity delivery completed", {
      action: "activity_delivery",
      actorUrl,
      delivered: String(delivered),
      failed: String(failed),
      requeued: String(requeued),
    });
  }

  return { delivered, failed, requeued };
}

/**
 * Resolves the inbox URL of a remote actor by fetching their actor document.
 */
async function resolveInbox(actorUrl: string): Promise<string | null> {
  try {
    const response = await apFetch(actorUrl);
    if (!response.ok) return null;

    const actor = (await response.json()) as Record<string, unknown>;
    const inbox = actor.inbox;
    return typeof inbox === "string" && inbox.length > 0 ? inbox : null;
  } catch (error) {
    logWarn("Failed to resolve follower inbox", {
      action: "activity_delivery_resolve_inbox",
      actorUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Signs and delivers an activity to a remote inbox.
 */
export async function signAndDeliver(
  inboxUrl: string,
  activity: Record<string, unknown>,
  signingKeyPem: string,
  keyId: string,
): Promise<boolean> {
  const body = JSON.stringify(activity);
  const bodyBytes = new TextEncoder().encode(body);

  // Compute Digest header (SHA-256)
  const digestBuffer = await crypto.subtle.digest("SHA-256", bodyBytes);
  const digestBase64 = btoa(
    String.fromCharCode(...new Uint8Array(digestBuffer)),
  );
  const digestHeader = `SHA-256=${digestBase64}`;

  const inboxParsed = new URL(inboxUrl);
  const dateHeader = new Date().toUTCString();
  const hostHeader = inboxParsed.host;
  const requestTarget = `post ${inboxParsed.pathname}${inboxParsed.search}`;

  const headers: Record<string, string> = {
    "Content-Type": AP_CONTENT_TYPE,
    Date: dateHeader,
    Host: hostHeader,
    Digest: digestHeader,
  };

  try {
    const signatureHeader = await buildSignatureHeader(
      requestTarget,
      hostHeader,
      dateHeader,
      digestHeader,
      signingKeyPem,
      keyId,
    );
    headers["Signature"] = signatureHeader;
  } catch (error) {
    logError("Failed to sign delivery request", error, {
      action: "activity_delivery_sign",
      inboxUrl,
      keyId,
    });
    return false;
  }

  try {
    assertSafeUrl(inboxUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(inboxUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
        redirect: "manual",
      });

      // 2xx responses indicate success; 202 Accepted is common for async processing
      return response.status >= 200 && response.status < 300;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    logError("Delivery POST failed", err, {
      action: "activity_delivery_post",
      inboxUrl,
    });
    return false;
  }
}

/**
 * Builds an HTTP Signature header value using RSA-SHA256.
 * Uses the Web Crypto API (compatible with Cloudflare Workers).
 */
async function buildSignatureHeader(
  requestTarget: string,
  host: string,
  date: string,
  digest: string,
  signingKeyPem: string,
  keyId: string,
): Promise<string> {
  const signedHeaders = "(request-target) host date digest";
  const signingString = [
    `(request-target): ${requestTarget}`,
    `host: ${host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join("\n");

  const privateKey = await importPemPrivateKey(signingKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(signingString),
  );

  const signatureBase64 = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  );

  return `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signatureBase64}"`;
}

/**
 * Imports a PEM-encoded RSA private key for use with Web Crypto API.
 */
async function importPemPrivateKey(pem: string): Promise<CryptoKey> {
  const pemBody = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binaryString = atob(pemBody);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}
