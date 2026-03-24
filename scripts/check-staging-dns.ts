/**
 * Verify staging DNS and TLS reachability for takos domains.
 *
 * Usage:
 *   pnpm -C scripts tsx check-staging-dns.ts
 */

import { resolve4 } from 'node:dns/promises';
import { connect as connectTls } from 'node:tls';

interface HostCheckResult {
  host: string;
  dnsOk: boolean;
  dnsIps: string[];
  tlsOk: boolean;
  tlsError?: string;
  certSubject?: string;
}

const HOSTS = [
  'test.takos.jp',
  `healthcheck-${Date.now()}.app.test.takos.jp`,
];

async function checkDns(host: string): Promise<{ ok: boolean; ips: string[] }> {
  try {
    const ips = await resolve4(host);
    return { ok: ips.length > 0, ips };
  } catch {
    return { ok: false, ips: [] };
  }
}

function checkTls(host: string, timeoutMs: number): Promise<{ ok: boolean; certSubject?: string; error?: string }> {
  return new Promise((resolve) => {
    const socket = connectTls({
      host,
      port: 443,
      servername: host,
      rejectUnauthorized: true,
      timeout: timeoutMs,
    });

    let settled = false;
    const finish = (result: { ok: boolean; certSubject?: string; error?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.on('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      finish({
        ok: true,
        certSubject: cert?.subject?.CN ? `CN=${cert.subject.CN}` : undefined,
      });
    });

    socket.on('error', (error) => {
      finish({ ok: false, error: error.message });
    });

    socket.on('timeout', () => {
      finish({ ok: false, error: `TLS timeout after ${timeoutMs}ms` });
    });
  });
}

async function runChecks(): Promise<HostCheckResult[]> {
  const results: HostCheckResult[] = [];
  for (const host of HOSTS) {
    const dns = await checkDns(host);
    if (!dns.ok) {
      results.push({
        host,
        dnsOk: false,
        dnsIps: [],
        tlsOk: false,
        tlsError: 'DNS resolution failed',
      });
      continue;
    }

    const tls = await checkTls(host, 8000);
    results.push({
      host,
      dnsOk: true,
      dnsIps: dns.ips,
      tlsOk: tls.ok,
      tlsError: tls.error,
      certSubject: tls.certSubject,
    });
  }
  return results;
}

async function main() {
  const results = await runChecks();
  console.log(JSON.stringify(results, null, 2));

  const failed = results.filter((r) => !r.dnsOk || !r.tlsOk);
  if (failed.length > 0) {
    console.error('\nStaging DNS/TLS check failed.');
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
