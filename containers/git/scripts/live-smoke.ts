#!/usr/bin/env bun

import assert from "node:assert/strict";
import {
  TAKOS_GIT_CAPABILITIES,
  TAKOS_GIT_INTERNAL_PATHS,
  type TakosActorContext,
} from "takos-git-contract";
import { signTakosumiInternalRequest as signTakosInternalRequest } from "takosumi-contract/internal/rpc";

const SERVICE_ID = "takos-git";
const DEFAULT_TIMEOUT_MS = 10_000;

const baseUrl = process.env.TAKOS_GIT_INTERNAL_URL?.trim();
if (!baseUrl) {
  skip("TAKOS_GIT_INTERNAL_URL is not set");
  process.exit(0);
}

const timeoutMs = readTimeoutMs();
const healthUrl = serviceUrl("/health");

await checkHealth(healthUrl);

const secret = process.env.TAKOS_INTERNAL_SERVICE_SECRET?.trim();
if (!secret) {
  skip(
    "TAKOS_INTERNAL_SERVICE_SECRET is not set; skipping signed repository list",
  );
  process.exit(0);
}

await checkSignedRepositoryList(secret);
console.log("ok takos-git live smoke passed");

async function checkHealth(url: URL): Promise<void> {
  const response = await fetchWithTimeout(url);
  const bodyText = await response.text();
  assert.equal(
    response.status,
    200,
    `GET ${url} expected 200, got ${response.status}: ${truncate(bodyText)}`,
  );
  const body = parseJsonRecord(bodyText, `GET ${url}`);
  assert.equal(body.ok, true, "health response ok must be true");
  assert.equal(
    body.service,
    SERVICE_ID,
    `health response service must be ${SERVICE_ID}`,
  );
  console.log(`ok ${SERVICE_ID} health ${url}`);
}

async function checkSignedRepositoryList(secret: string): Promise<void> {
  const path = TAKOS_GIT_INTERNAL_PATHS.repositories;
  const url = serviceUrl(path);
  const requestId = `live-smoke-${crypto.randomUUID()}`;
  const actor: TakosActorContext = {
    actorAccountId: process.env.TAKOS_LIVE_SMOKE_ACTOR_ACCOUNT_ID?.trim() ||
      "acct_live_smoke",
    roles: readActorRoles(),
    requestId,
    principalKind: "service",
    serviceId: "takos-live-smoke",
    spaceId: process.env.TAKOS_LIVE_SMOKE_SPACE_ID?.trim() ||
      "space_live_smoke",
  };
  const signed = await signTakosInternalRequest({
    method: "GET",
    path,
    query: "",
    body: "",
    actor,
    caller: process.env.TAKOS_LIVE_SMOKE_CALLER?.trim() || "takosumi",
    audience: SERVICE_ID,
    capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
    requestId,
    timestamp: new Date().toISOString(),
    secret,
  });
  const response = await fetchWithTimeout(url, { headers: signed.headers });
  const bodyText = await response.text();
  assert.equal(
    response.status,
    200,
    `GET ${url} expected 200, got ${response.status}: ${truncate(bodyText)}`,
  );
  const body = parseJsonRecord(bodyText, `GET ${url}`);
  assert(
    Array.isArray(body.repositories),
    "repository list response must include repositories array",
  );
  console.log(`ok ${SERVICE_ID} signed repository list ${url}`);
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function serviceUrl(path: string): URL {
  return new URL(path, baseUrl);
}

function readTimeoutMs(): number {
  const value = process.env.TAKOS_LIVE_SMOKE_TIMEOUT_MS?.trim();
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `TAKOS_LIVE_SMOKE_TIMEOUT_MS must be a positive number, got ${value}`,
    );
  }
  return parsed;
}

function readActorRoles(): string[] {
  const roles = process.env.TAKOS_LIVE_SMOKE_ACTOR_ROLES?.split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  return roles && roles.length > 0 ? roles : ["owner"];
}

function parseJsonRecord(text: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  assert(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    `${label} must return a JSON object`,
  );
  return parsed as Record<string, unknown>;
}

function truncate(value: string): string {
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function skip(reason: string): void {
  console.log(`skip ${SERVICE_ID} live smoke: ${reason}`);
}
