// k6 load baseline against local-substrate via Caddy + TLS.
//
// Previously this script hit the worker directly over HTTP (docker network
// short-circuit), which gave great-looking numbers (~5ms p95) that didn't
// reflect what production users see. Now it goes through Caddy with the
// Pebble root injected as the system CA, so the numbers include TLS
// handshake + Caddy proxying overhead.
//
// Run via scripts/k6-baseline.sh which mounts the Pebble root and the
// docker network for us.
//
// NOTE: these thresholds are loose regression-watch numbers, NOT SLO
// targets. Production runs on Cloudflare's edge, not this machine.
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    install_preview: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'installPreview',
    },
    oidc_discovery: {
      executor: 'constant-arrival-rate',
      rate: 10,
      timeUnit: '1s',
      duration: '20s',
      preAllocatedVUs: 5,
      maxVUs: 20,
      exec: 'oidcDiscovery',
    },
  },
  thresholds: {
    'http_req_failed{scenario:install_preview}': ['rate<0.01'],
    'http_req_failed{scenario:oidc_discovery}': ['rate<0.01'],
    // Tight thresholds — actual measured p95 on the local-substrate
    // (via Caddy + TLS) is ~8ms for install_preview and ~5ms for OIDC
    // discovery. Set to ~5× current baseline so a 5× regression fails
    // smoke. Previous values (3000ms / 1500ms) were ~400× looser and
    // wouldn't catch a real performance regression.
    'http_req_duration{scenario:install_preview}': ['p(95)<50'],
    'http_req_duration{scenario:oidc_discovery}': ['p(95)<30'],
  },
};

const PREVIEW_URL = 'https://cloud.takosumi.test/v1/install/preview';
const OIDC_URL = 'https://cloud.takosumi.test/.well-known/openid-configuration';

export function installPreview() {
  const res = http.post(
    PREVIEW_URL,
    JSON.stringify({
      source: {
        gitUrl: 'https://github.com/tako0614/takos.git',
        ref: 'main',
      },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'preview status 200': (r) => r.status === 200,
    'preview has appId': (r) => r.json('appId') !== undefined,
  });
}

export function oidcDiscovery() {
  const res = http.get(OIDC_URL);
  check(res, {
    'oidc status 200': (r) => r.status === 200,
    'oidc has authorization_endpoint': (r) => r.json('authorization_endpoint') !== undefined,
  });
}
