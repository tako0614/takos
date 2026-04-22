/**
 * R2 object storage commands: list, get, put, delete, upload-dir.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { sanitizeErrorMessage } from "takos-control/core/wfp-client";
import { Buffer } from "node:buffer";
import {
  createClient,
  DEFAULT_R2_PAGE_SIZE,
  enforceTenantR2AccessPolicy,
  fail,
  type GlobalOptions,
  MAX_R2_PAGE_SIZE,
  normalizePrefix,
  parsePositiveInt,
  print,
  resolveBucketName,
  type ResolvedConfig,
  takeOption,
} from "./index.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function putR2Object(
  config: ResolvedConfig,
  bucketName: string,
  key: string,
  data: Buffer,
  contentType: string,
): Promise<void> {
  const client = createClient(config);
  const response = await client.fetchRaw(
    `/accounts/${config.accountId}/r2/buckets/${bucketName}/objects/${
      encodeURIComponent(key)
    }`,
    {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: data,
    },
  );

  if (!response.ok) {
    const text = await response.text();
    fail(
      `R2 put failed (${key}): ${response.status} ${
        sanitizeErrorMessage(text || response.statusText)
      }`,
    );
  }
}

function collectFilesRecursive(rootDir: string): string[] {
  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function cmdR2List(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  if (!bucketArg) {
    fail(
      "Bucket is required. Usage: r2 list <bucket> [--prefix <prefix>] [--cursor <cursor>]",
    );
  }

  const prefix = takeOption(localArgs, "--prefix");
  const cursor = takeOption(localArgs, "--cursor");
  const limit = parsePositiveInt(
    takeOption(localArgs, "--limit"),
    "--limit",
    DEFAULT_R2_PAGE_SIZE,
    MAX_R2_PAGE_SIZE,
  );
  enforceTenantR2AccessPolicy(options, "list", prefix || "");

  const bucketName = resolveBucketName(config, bucketArg);
  const client = createClient(config);

  const query = new URLSearchParams();
  query.set("per_page", String(limit));
  if (prefix) query.set("prefix", prefix);
  if (cursor) query.set("cursor", cursor);

  const pathSuffix = query.toString().length > 0 ? `?${query.toString()}` : "";
  const result = await client.accountGet<{
    objects: Array<
      { key: string; size: number; uploaded: string; etag: string }
    >;
    truncated: boolean;
    cursor?: string;
  }>(`/r2/buckets/${bucketName}/objects${pathSuffix}`);

  if (options.isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.table(result.objects || []);
    print(`truncated: ${result.truncated ? "yes" : "no"}`, options.isJson);
    if (result.cursor) {
      print(`next cursor: ${result.cursor}`, options.isJson);
    }
  }

  return (result.objects || []).length;
}

export async function cmdR2Get(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const key = localArgs.shift();
  if (!bucketArg || !key) {
    fail("Usage: r2 get <bucket> <key> [--output <path>]");
  }

  const outputPath = takeOption(localArgs, "--output");
  enforceTenantR2AccessPolicy(options, "get", key);
  const bucketName = resolveBucketName(config, bucketArg);
  const client = createClient(config);

  const response = await client.fetchRaw(
    `/accounts/${config.accountId}/r2/buckets/${bucketName}/objects/${
      encodeURIComponent(key)
    }`,
    { method: "GET" },
  );

  if (!response.ok) {
    const text = await response.text();
    fail(
      `R2 get failed: ${response.status} ${
        sanitizeErrorMessage(text || response.statusText)
      }`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, buffer);

    if (options.isJson) {
      console.log(
        JSON.stringify(
          { bucket: bucketName, key, output: resolved, bytes: buffer.length },
          null,
          2,
        ),
      );
    } else {
      print(`Saved ${buffer.length} bytes to ${resolved}`, options.isJson);
    }
    return 1;
  }

  if (options.isJson) {
    console.log(
      JSON.stringify(
        {
          bucket: bucketName,
          key,
          bytes: buffer.length,
          body: buffer.toString("utf8"),
        },
        null,
        2,
      ),
    );
  } else {
    process.stdout.write(buffer.toString("utf8"));
    if (!buffer.toString("utf8").endsWith("\n")) {
      process.stdout.write("\n");
    }
  }

  return 1;
}

export async function cmdR2Put(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const key = localArgs.shift();
  const filePath = localArgs.shift();

  if (!bucketArg || !key || !filePath) {
    fail("Usage: r2 put <bucket> <key> <file> [--content-type <type>]");
  }

  const contentType = takeOption(localArgs, "--content-type") ||
    "application/octet-stream";
  enforceTenantR2AccessPolicy(options, "put", key);
  const bucketName = resolveBucketName(config, bucketArg);
  const resolvedFilePath = path.resolve(filePath);

  if (!fs.existsSync(resolvedFilePath)) {
    fail(`File not found: ${resolvedFilePath}`);
  }

  const stat = fs.statSync(resolvedFilePath);
  if (!stat.isFile()) {
    fail(`Not a file: ${resolvedFilePath}`);
  }

  const data = fs.readFileSync(resolvedFilePath);
  await putR2Object(config, bucketName, key, data, contentType);

  if (options.isJson) {
    console.log(
      JSON.stringify(
        { bucket: bucketName, key, file: resolvedFilePath, bytes: data.length },
        null,
        2,
      ),
    );
  } else {
    print(
      `Uploaded ${resolvedFilePath} -> ${bucketName}/${key} (${data.length} bytes)`,
      options.isJson,
    );
  }

  return 1;
}

export async function cmdR2Delete(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const key = localArgs.shift();
  if (!bucketArg || !key) {
    fail("Usage: r2 delete <bucket> <key>");
  }

  enforceTenantR2AccessPolicy(options, "delete", key);
  const bucketName = resolveBucketName(config, bucketArg);
  const client = createClient(config);
  const response = await client.fetchRaw(
    `/accounts/${config.accountId}/r2/buckets/${bucketName}/objects/${
      encodeURIComponent(key)
    }`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    const text = await response.text();
    fail(
      `R2 delete failed: ${response.status} ${
        sanitizeErrorMessage(text || response.statusText)
      }`,
    );
  }

  if (options.isJson) {
    console.log(
      JSON.stringify({ bucket: bucketName, key, deleted: true }, null, 2),
    );
  } else {
    print(`Deleted ${bucketName}/${key}`, options.isJson);
  }

  return 1;
}

export async function cmdR2UploadDir(
  config: ResolvedConfig,
  options: GlobalOptions,
  args: string[],
): Promise<number> {
  const localArgs = [...args];
  const bucketArg = localArgs.shift();
  const dirPath = localArgs.shift();
  const prefixArg = localArgs.shift();

  if (!bucketArg || !dirPath) {
    fail(
      "Usage: r2 upload-dir <bucket> <dir> [prefix] [--content-type <type>]",
    );
  }

  const contentType = takeOption(localArgs, "--content-type") ||
    "application/octet-stream";
  const bucketName = resolveBucketName(config, bucketArg);
  const resolvedDirPath = path.resolve(dirPath);
  const normalizedPrefix = normalizePrefix(prefixArg);
  enforceTenantR2AccessPolicy(options, "upload-dir", normalizedPrefix);

  if (!fs.existsSync(resolvedDirPath)) {
    fail(`Directory not found: ${resolvedDirPath}`);
  }

  const stat = fs.statSync(resolvedDirPath);
  if (!stat.isDirectory()) {
    fail(`Not a directory: ${resolvedDirPath}`);
  }

  const files = collectFilesRecursive(resolvedDirPath);

  let uploaded = 0;
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    const rel = path.relative(resolvedDirPath, file).split(path.sep).join("/");
    const objectKey = normalizedPrefix ? `${normalizedPrefix}/${rel}` : rel;
    try {
      const data = fs.readFileSync(file);
      await putR2Object(config, bucketName, objectKey, data, contentType);
      uploaded += 1;
      if (!options.isJson) {
        print(`uploaded: ${objectKey}`, options.isJson);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ file: objectKey, error: sanitizeErrorMessage(message) });
      if (!options.isJson) {
        print(`failed: ${objectKey} (${message})`, options.isJson);
      }
    }
  }

  if (options.isJson) {
    console.log(JSON.stringify(
      {
        bucket: bucketName,
        directory: resolvedDirPath,
        prefix: normalizedPrefix || null,
        uploaded,
        failed: errors.length,
        errors,
      },
      null,
      2,
    ));
  } else {
    print(
      `Upload summary: uploaded=${uploaded}, failed=${errors.length}`,
      options.isJson,
    );
  }

  return uploaded;
}
