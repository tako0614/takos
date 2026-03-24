/**
 * Check Worker Bindings Script
 *
 * Checks the current bindings for a tenant worker in the WFP dispatch namespace.
 */

import {
  filterSensitiveData,
  requireEnvVar,
  validateDispatchNamespace,
  validateHttpsUrl,
  validateWorkerName,
} from './shared-worker-helpers.ts';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

async function main() {
  const workerName = process.argv[2];

  const DISPATCH_NAMESPACE = process.env.WFP_DISPATCH_NAMESPACE || 'takos-tenants';

  // Validate DISPATCH_NAMESPACE format and length
  validateDispatchNamespace(DISPATCH_NAMESPACE);

  // Validate CF_API_BASE uses HTTPS
  validateHttpsUrl(CF_API_BASE, 'CF_API_BASE');

  const CF_API_TOKEN = requireEnvVar(
    'CF_API_TOKEN',
    process.env.CF_API_TOKEN,
    'export CF_API_TOKEN=your-token'
  );
  const CF_ACCOUNT_ID = requireEnvVar(
    'CF_ACCOUNT_ID',
    process.env.CF_ACCOUNT_ID,
    'export CF_ACCOUNT_ID=your-account-id'
  );

  if (!workerName) {
    console.error('Error: Worker name is required as first argument');
    console.log('\nUsage: npx ts-node scripts/check-worker-bindings.ts <worker-name>');
    process.exit(1);
  }

  // Validate workerName format to prevent injection attacks
  validateWorkerName(workerName);

  console.log(`Checking bindings for worker: ${workerName}`);
  console.log(`Dispatch namespace: ${DISPATCH_NAMESPACE}`);

  // Get worker bindings
  const response = await fetch(
    `${CF_API_BASE}/accounts/${CF_ACCOUNT_ID}/workers/dispatch/namespaces/${DISPATCH_NAMESPACE}/scripts/${workerName}/bindings`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
      },
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

  let result: { success: boolean; errors?: Array<{ message: string }>; result?: unknown };
  try {
    result = await response.json();
  } catch (error) {
    console.error('Failed to parse response JSON:', error);
    process.exit(1);
  }

  if (!result.success) {
    console.error('Failed to get bindings:');
    console.error(JSON.stringify(result.errors, null, 2));
    process.exit(1);
  }

  console.log('\nBindings:');
  console.log(JSON.stringify(result.result, null, 2));

  // Also get the worker settings
  const settingsResponse = await fetch(
    `${CF_API_BASE}/accounts/${CF_ACCOUNT_ID}/workers/dispatch/namespaces/${DISPATCH_NAMESPACE}/scripts/${workerName}/settings`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${CF_API_TOKEN}`,
      },
    }
  );

  // Validate HTTP status before parsing JSON
  if (!settingsResponse.ok) {
    console.error(`HTTP error for settings: ${settingsResponse.status} ${settingsResponse.statusText}`);
    try {
      const errorBody = await settingsResponse.text();
      // Filter sensitive information before logging
      console.error('Response body:', filterSensitiveData(errorBody));
    } catch {
      // Ignore error reading body
    }
    process.exit(1);
  }

  let settingsResult: { success: boolean; result?: unknown };
  try {
    settingsResult = await settingsResponse.json();
  } catch (error) {
    console.error('Failed to parse settings response JSON:', error);
    process.exit(1);
  }

  console.log('\nSettings:');
  console.log(JSON.stringify(settingsResult.result, null, 2));
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
