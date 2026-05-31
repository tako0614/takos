#!/usr/bin/env npx tsx
/**
 * Delete a worker from WFP dispatch namespace
 */
import process from "node:process";
import { resolveCloudflareDispatchNamespace } from "./cloudflare-dispatch-namespace.ts";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

async function main() {
  const workerName = process.argv[2];
  if (!workerName) {
    console.error("Usage: npx tsx scripts/delete-wfp-worker.ts <worker-name>");
    process.exit(1);
  }

  const token = process.env.CF_API_TOKEN;
  const accountId = process.env.CF_ACCOUNT_ID;
  const namespace = resolveCloudflareDispatchNamespace();
  if (!token) {
    console.error("CF_API_TOKEN not set");
    process.exit(1);
  }
  if (!accountId) {
    console.error("CF_ACCOUNT_ID not set");
    process.exit(1);
  }

  console.log(`Deleting worker: ${workerName}`);

  const response = await fetch(
    `${CF_API_BASE}/accounts/${accountId}/workers/dispatch/namespaces/${namespace}/scripts/${workerName}`,
    {
      method: "DELETE",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    },
  );

  const data = await response.json() as { success?: boolean };
  console.log(JSON.stringify(data, null, 2));

  if (data.success) {
    console.log("Worker deleted successfully");
  } else {
    console.error("Failed to delete worker");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
