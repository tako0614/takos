import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ActionContext } from "../executor.ts";
import { pushLog } from "../../logging.ts";
import { resolvePathWithin } from "../../paths.ts";

export async function setupNode(
  inputs: {
    "node-version": string;
    "node-version-file"?: string;
    cache?: "npm" | "pnpm" | "yarn";
    "cache-dependency-path"?: string;
    "registry-url"?: string;
  },
  context: ActionContext,
): Promise<void> {
  pushLog(context.logs, "Running actions/setup-node");

  const stripVersionPrefix = (v: string): string => v.trim().replace(/^v/, "");
  const currentVersion = stripVersionPrefix(process.version);

  let nodeVersion = inputs["node-version"];

  if (!nodeVersion && inputs["node-version-file"]) {
    const allowedVersionFiles = [".nvmrc", ".node-version", "package.json"];
    const requestedFile = inputs["node-version-file"];
    if (!allowedVersionFiles.includes(requestedFile)) {
      pushLog(
        context.logs,
        `Warning: node-version-file must be one of: ${
          allowedVersionFiles.join(", ")
        }`,
      );
    } else {
      const versionFilePath = resolvePathWithin(
        context.workspacePath,
        requestedFile,
        "node-version-file",
      );
      try {
        const content = await fs.readFile(versionFilePath, "utf-8");
        nodeVersion = stripVersionPrefix(content);
        pushLog(
          context.logs,
          `Read Node.js version from file: ${requestedFile}`,
        );
      } catch {
        pushLog(
          context.logs,
          `Warning: Could not read version file: ${requestedFile}`,
        );
      }
    }
  }

  if (!nodeVersion) {
    const nvmrcPath = path.join(context.workspacePath, ".nvmrc");
    const nodeVersionPath = path.join(context.workspacePath, ".node-version");

    for (const versionFile of [nvmrcPath, nodeVersionPath]) {
      try {
        const content = await fs.readFile(versionFile, "utf-8");
        nodeVersion = stripVersionPrefix(content);
        pushLog(
          context.logs,
          `Read Node.js version from ${
            path.basename(versionFile)
          }: ${nodeVersion}`,
        );
        break;
      } catch {
        // File not found, try next
      }
    }
  }

  if (!nodeVersion) {
    nodeVersion = currentVersion;
    pushLog(context.logs, `Using current Node.js version: ${nodeVersion}`);
  }

  pushLog(context.logs, `Requested Node.js version: ${nodeVersion}`);
  pushLog(context.logs, `Current Node.js version: ${currentVersion}`);

  context.setOutput("node-version", currentVersion);

  if (!currentVersion.startsWith(nodeVersion.split(".")[0])) {
    pushLog(
      context.logs,
      `Warning: Requested major version ${nodeVersion} differs from installed ${currentVersion}`,
    );
  }

  if (inputs.cache) {
    pushLog(context.logs, `Setting up ${inputs.cache} cache...`);
    context.setOutput("cache-hit", "false"); // Simplified for now
  }

  if (inputs["registry-url"]) {
    context.setEnv("NPM_CONFIG_REGISTRY", inputs["registry-url"]);
    pushLog(context.logs, `Set npm registry: ${inputs["registry-url"]}`);
  }

  pushLog(context.logs, "Node.js setup completed");
}
