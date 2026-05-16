// k6 load baseline for local-substrate critical paths.
// Run via:
//   docker run --rm -i --network local-substrate_takos-local-internal \
//     -v "$PWD/scripts:/scripts:ro" \
//     grafana/k6:0.55.0 run /scripts/k6-baseline.js
//
// Thresholds are deliberately loose for the local-substrate; the goal is
// regression detection ("p95 jumped 5×, what changed?") not capacity
// planning. Tune in CI once we have a stable baseline measured per host.
import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    install_preview: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: "installPreview",
    },
    oidc_discovery: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "20s",
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: "oidcDiscovery",
    },
  },
  thresholds: {
    "http_req_failed{scenario:install_preview}": ["rate<0.01"],
    "http_req_failed{scenario:oidc_discovery}": ["rate<0.01"],
    "http_req_duration{scenario:install_preview}": ["p(95)<1500"],
    "http_req_duration{scenario:oidc_discovery}": ["p(95)<500"],
  },
};

// Inside the docker network, hit services directly — Pebble TLS is the
// outer ingress; the network calls would otherwise hit cert-trust friction.
const PREVIEW_URL = "http://takosumi-cloud-worker:8787/v1/install/preview";
const OIDC_URL =
  "http://takosumi-cloud-worker:8787/.well-known/openid-configuration";

export function installPreview() {
  const res = http.post(
    PREVIEW_URL,
    JSON.stringify({
      source: {
        gitUrl: "https://github.com/tako0614/takos.git",
        ref: "main",
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
  check(res, {
    "preview status 200": (r) => r.status === 200,
    "preview has appId": (r) => r.json("appId") !== undefined,
  });
}

export function oidcDiscovery() {
  const res = http.get(OIDC_URL);
  check(res, {
    "oidc status 200": (r) => r.status === 200,
    "oidc has authorization_endpoint": (r) =>
      r.json("authorization_endpoint") !== undefined,
  });
}
