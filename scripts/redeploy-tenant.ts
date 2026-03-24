/**
 * Redeploy Tenant Worker Script
 *
 * This script redeploys a tenant worker with the latest bundle from R2.
 *
 * Usage:
 *   npx tsx scripts/redeploy-tenant.ts <tenant-id>
 */

import { readFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import {
  filterSensitiveData,
  requireEnvVar,
  validateDispatchNamespace,
  validateHttpsUrl,
} from './shared-worker-helpers.ts';

const rootDir = new URL('..', import.meta.url).pathname;

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// RFC 1123 compliant hostname validation pattern
// Allows labels up to 63 chars, total hostname up to 253 chars
// Labels must start and end with alphanumeric, can contain hyphens
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:(?!-)[a-zA-Z0-9-]{1,63}(?<!-)\.)*(?!-)[a-zA-Z0-9-]{1,63}(?<!-)$/;

// Tenant ID format: 32 lowercase hexadecimal characters
const TENANT_ID_PATTERN = /^[a-f0-9]{32}$/;

/**
 * Type guard for D1 result structure
 */
function isValidD1Result(data: unknown): data is Array<{ results?: Array<{ hostname?: string; metadata?: string }> }> {
  return Array.isArray(data);
}

/**
 * Type guard for tenant metadata
 */
function isValidTenantMetadata(data: unknown): data is { d1_database_id?: string; r2_bucket_name?: string } {
  return typeof data === 'object' && data !== null;
}

/**
 * Validates hostname according to RFC 1123
 * @param hostname - The hostname to validate
 * @returns true if valid, false otherwise
 */
function isValidHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) return false;
  // Check overall pattern
  if (!HOSTNAME_PATTERN.test(hostname)) return false;
  // Check each label length
  const labels = hostname.split('.');
  for (const label of labels) {
    if (label.length > 63) return false;
  }
  return true;
}


interface TenantInfo {
  id: string;
  hostname: string;
  worker_name: string;
  d1_database_id: string;
  r2_bucket_name: string;
}

function parseArgs(argv: string[]): { tenantId?: string; bundlePath?: string } {
  let tenantId: string | undefined;
  let bundlePath = process.env.TENANT_WORKER_BUNDLE_PATH?.trim() || undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === '--bundle') {
      bundlePath = argv[index + 1]?.trim() || undefined;
      index += 1;
      continue;
    }

    if (arg.startsWith('--bundle=')) {
      bundlePath = arg.slice('--bundle='.length).trim() || undefined;
      continue;
    }

    if (!tenantId) {
      tenantId = arg;
      continue;
    }

    throw new Error(`Unexpected argument: ${arg}`);
  }

  return { tenantId, bundlePath };
}

async function main() {
  let args: { tenantId?: string; bundlePath?: string };
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Failed to parse arguments');
    process.exit(1);
  }

  const { tenantId, bundlePath: rawBundlePath } = args;

  if (!tenantId) {
    console.log('Usage: npx tsx scripts/redeploy-tenant.ts <tenant-id> [--bundle <path-to-worker-bundle>]');
    console.log('\nExample:');
    console.log('  npx tsx scripts/redeploy-tenant.ts 590c28a76652d13b68e786990bac763a --bundle ../yurucommu/dist/worker-with-frontend.js');
    process.exit(1);
  }

  // DISPATCH_NAMESPACE default is acceptable because:
  // 1. This is a deployment script that requires explicit invocation
  // 2. The namespace name 'takos-tenants' is not sensitive - it's a known infrastructure identifier
  // 3. CF_ACCOUNT_ID and CF_API_TOKEN (the actual secrets) have no defaults
  // 4. Using an incorrect namespace would simply fail the deployment, not cause security issues
  // 5. This matches the documented production namespace, reducing misconfiguration risk
  const DISPATCH_NAMESPACE = process.env.WFP_DISPATCH_NAMESPACE || 'takos-tenants';

  // Validate DISPATCH_NAMESPACE format and length
  validateDispatchNamespace(DISPATCH_NAMESPACE);

  // Validate CF_API_BASE uses HTTPS
  validateHttpsUrl(CF_API_BASE, 'CF_API_BASE');

  // Read secrets from environment - no fallback defaults for security
  const CF_ACCOUNT_ID = requireEnvVar(
    'CF_ACCOUNT_ID',
    process.env.CF_ACCOUNT_ID,
    'export CF_ACCOUNT_ID=your-account-id'
  );
  const CF_API_TOKEN = requireEnvVar(
    'CF_API_TOKEN',
    process.env.CF_API_TOKEN,
    'export CF_API_TOKEN=your-token'
  );

  // Validate tenantId format to prevent command injection
  // SECURITY: This validation is critical - tenantId is used in shell commands and SQL queries.
  // The pattern [a-f0-9]{32} ensures only lowercase hex characters are allowed,
  // preventing shell metacharacters and SQL injection.
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    console.error('Error: Invalid tenant ID format. Expected 32 hex characters.');
    process.exit(1);
  }

  console.log(`[Security] Validated tenant ID format: ${tenantId}`);

  // Read the worker bundle
  if (!rawBundlePath) {
    console.error('Error: Worker bundle path is required.');
    console.log('Pass --bundle <path> or set TENANT_WORKER_BUNDLE_PATH.');
    process.exit(1);
  }

  const bundlePath = resolvePath(process.cwd(), rawBundlePath);
  let workerScript: string;

  try {
    workerScript = readFileSync(bundlePath, 'utf-8');
    console.log(`Loaded worker bundle: ${(workerScript.length / 1024).toFixed(2)} KB`);
  } catch (error) {
    console.error(`Error: Worker bundle not found at ${bundlePath}`);
    console.log('Build the target worker bundle first and pass its path via --bundle or TENANT_WORKER_BUNDLE_PATH.');
    process.exit(1);
  }

  // Tenant info - will be populated from database
  const tenant: TenantInfo = {
    id: tenantId,
    hostname: '',
    worker_name: `tenant-${tenantId}`,
    d1_database_id: '',
    r2_bucket_name: `takos-media-${tenantId}`,
  };

  // Need to get tenant info from D1
  console.log(`\nLooking up tenant ${tenantId}...`);

  const { execSync } = await import('child_process');

  try {
    const result = execSync(
      `npx wrangler d1 execute takos-control-db --command "SELECT hostname, metadata FROM tenants WHERE id = '${tenantId}'" --json --remote`,
      { cwd: join(rootDir, 'apps', 'control'), encoding: 'utf-8' }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(result);
    } catch (parseError) {
      console.error('Failed to parse wrangler output as JSON:', parseError);
      console.error('Raw output:', result);
      process.exit(1);
    }

    // Runtime type validation for parsed JSON structure
    if (!isValidD1Result(parsed)) {
      console.error('Error: Unexpected wrangler D1 response structure');
      console.error('Expected array with results property, got:', typeof parsed);
      process.exit(1);
    }

    if (parsed[0]?.results?.[0]) {
      const row = parsed[0].results[0];
      tenant.hostname = row.hostname || '';
      // Validate hostname format before use
      if (tenant.hostname && !isValidHostname(tenant.hostname)) {
        console.error('Error: Invalid hostname format from database');
        console.error('Hostname must be RFC 1123 compliant (e.g., example.com)');
        console.error('Received:', tenant.hostname);
        process.exit(1);
      }

      if (row.metadata) {
        let parsedMetadata: unknown;
        try {
          parsedMetadata = JSON.parse(row.metadata);
        } catch (metadataParseError) {
          console.error('Failed to parse tenant metadata JSON:', metadataParseError);
          console.error('Raw metadata:', row.metadata);
          process.exit(1);
        }

        // Runtime type validation for metadata structure
        if (!isValidTenantMetadata(parsedMetadata)) {
          console.error('Error: Unexpected tenant metadata structure');
          console.error('Expected object with optional d1_database_id and r2_bucket_name strings');
          process.exit(1);
        }

        tenant.d1_database_id = parsedMetadata.d1_database_id || '';
        tenant.r2_bucket_name = parsedMetadata.r2_bucket_name || '';
      }
      console.log(`Found tenant hostname: ${tenant.hostname}`);
      console.log(`Found tenant D1: ${tenant.d1_database_id}`);
      console.log(`Found tenant R2: ${tenant.r2_bucket_name}`);
    } else {
      console.error('Could not find tenant');
      process.exit(1);
    }
  } catch (error) {
    console.error('Failed to query tenant:', error);
    process.exit(1);
  }

  // Read PLATFORM_PUBLIC_KEY from file or environment
  // SECURITY: Public key is required for tenant worker signature verification
  let PLATFORM_PUBLIC_KEY = process.env.PLATFORM_PUBLIC_KEY;
  if (!PLATFORM_PUBLIC_KEY) {
    const publicKeyPath = join(rootDir, 'public_key.pem');
    try {
      PLATFORM_PUBLIC_KEY = readFileSync(publicKeyPath, 'utf-8').trim();
      console.log(`\nLoaded public key from ${publicKeyPath}`);
    } catch {
      console.error('\nError: PLATFORM_PUBLIC_KEY is required but not configured.');
      console.error('The public key is essential for tenant worker security.');
      console.error('\nSet it with one of the following methods:');
      console.error('  1. Environment variable: export PLATFORM_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."');
      console.error(`  2. File: Create ${publicKeyPath} with the public key content`);
      process.exit(1);
    }
  }

  // Validate that the public key is not empty after loading
  if (!PLATFORM_PUBLIC_KEY.trim()) {
    console.error('\nError: PLATFORM_PUBLIC_KEY is empty.');
    console.error('A valid public key is required for tenant worker security.');
    process.exit(1);
  }

  // Deploy worker
  console.log(`\nDeploying worker: ${tenant.worker_name}...`);

  const metadata = {
    main_module: 'worker.js',
    bindings: [
      { type: 'd1', name: 'DB', id: tenant.d1_database_id },
      { type: 'r2_bucket', name: 'MEDIA', bucket_name: tenant.r2_bucket_name },
      { type: 'plain_text', name: 'PLATFORM_PUBLIC_KEY', text: PLATFORM_PUBLIC_KEY },
      { type: 'plain_text', name: 'TENANT_ID', text: tenant.id },
      { type: 'plain_text', name: 'HOSTNAME', text: tenant.hostname },
    ],
    compatibility_date: '2024-01-01',
    compatibility_flags: ['nodejs_compat'],
  };

  const formData = new FormData();
  formData.append('worker.js', new Blob([workerScript], { type: 'application/javascript+module' }), 'worker.js');
  formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));

  const response = await fetch(
    `${CF_API_BASE}/accounts/${CF_ACCOUNT_ID}/workers/dispatch/namespaces/${DISPATCH_NAMESPACE}/scripts/${tenant.worker_name}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
      },
      body: formData,
    }
  );

  // Validate HTTP status before parsing JSON
  if (!response.ok) {
    console.error(`HTTP error: ${response.status} ${response.statusText}`);
    try {
      const errorBody = await response.text();
      // Filter sensitive information before logging
      console.error('Response body:', filterSensitiveData(errorBody));
    } catch {
      // Ignore error reading body
    }
    process.exit(1);
  }

  let result: { success: boolean; errors: Array<{ message: string }> };
  try {
    result = await response.json() as { success: boolean; errors: Array<{ message: string }> };
  } catch (error) {
    console.error('Failed to parse response JSON:', error);
    process.exit(1);
  }

  if (result.success) {
    console.log(`\n✓ Successfully deployed ${tenant.worker_name}!`);
    console.log(`\nTest at: https://${tenant.hostname}/`);
  } else {
    console.error('\nDeployment failed:');
    console.error(result.errors.map((e: { message: string }) => e.message).join('\n'));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
