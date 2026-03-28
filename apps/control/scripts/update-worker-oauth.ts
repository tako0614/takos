#!/usr/bin/env npx tsx
/**
 * Update worker OAuth credentials
 *
 * Usage: CLOUDFLARE_API_TOKEN=xxx npx tsx scripts/update-worker-oauth.ts <worker-name> <client-id> <client-secret>
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error('Usage: CLOUDFLARE_API_TOKEN=xxx npx tsx scripts/update-worker-oauth.ts <worker-name> <client-id> <client-secret>');
    process.exit(1);
  }

  const [workerName, clientId, clientSecret] = args;
  // Canonical env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
  // CF_API_TOKEN and CF_ACCOUNT_ID are deprecated aliases kept for backward compatibility.
  const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
  const dispatchNamespace = process.env.CF_DISPATCH_NAMESPACE || 'takos-tenants';

  if (!apiToken) {
    console.error('CLOUDFLARE_API_TOKEN environment variable is required');
    process.exit(1);
  }
  if (!accountId) {
    console.error('CLOUDFLARE_ACCOUNT_ID environment variable is required');
    process.exit(1);
  }

  console.log(`Updating OAuth credentials for worker: ${workerName}`);
  console.log(`Client ID: ${clientId}`);

  // First, get current settings
  const getUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces/${dispatchNamespace}/scripts/${workerName}/settings`;

  const currentSettings = await fetch(getUrl, {
    headers: {
      'Authorization': `Bearer ${apiToken}`,
    },
  });

  if (!currentSettings.ok) {
    console.error('Failed to get current settings:', await currentSettings.text());
    process.exit(1);
  }

  const settingsData = await currentSettings.json() as { result: { bindings: Array<{ name: string; type: string; text?: string }> } };
  console.log('Current bindings:', settingsData.result.bindings.map(b => b.name));

  // Update the TAKOS_CLIENT_ID and TAKOS_CLIENT_SECRET bindings
  const bindings = settingsData.result.bindings.map(b => {
    if (b.name === 'TAKOS_CLIENT_ID') {
      return { ...b, text: clientId };
    }
    if (b.name === 'TAKOS_CLIENT_SECRET') {
      return { ...b, text: clientSecret };
    }
    return b;
  });

  // Check if bindings exist, if not add them
  if (!bindings.find(b => b.name === 'TAKOS_CLIENT_ID')) {
    bindings.push({ name: 'TAKOS_CLIENT_ID', type: 'plain_text', text: clientId });
  }
  if (!bindings.find(b => b.name === 'TAKOS_CLIENT_SECRET')) {
    bindings.push({ name: 'TAKOS_CLIENT_SECRET', type: 'secret_text', text: clientSecret });
  }

  // Update settings
  const updateUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/dispatch/namespaces/${dispatchNamespace}/scripts/${workerName}/settings`;

  const updateResponse = await fetch(updateUrl, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bindings }),
  });

  if (!updateResponse.ok) {
    console.error('Failed to update settings:', await updateResponse.text());
    process.exit(1);
  }

  console.log('Successfully updated OAuth credentials!');
}

main().catch(console.error);
