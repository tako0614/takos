import type { PackfileReadLimits } from "../git-smart/protocol/packfile-reader.ts";
import type { Env } from "../../../shared/types/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { parseIntValue } from "takos-common/env-parse";

export type RemoteFetchLimits = {
  fullPack: {
    maxPackfileBytes: number | null;
    readLimits: PackfileReadLimits;
  };
  blobPack: {
    maxPackfileBytes: number | null;
    readLimits: PackfileReadLimits;
  };
  archive: {
    maxArchiveBytes: number | null;
  };
};

function parseConfiguredLimit(
  envName: string,
  rawValue: string | undefined,
  defaultValue: number,
  options?: { min?: number; max?: number },
): number | undefined {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (
    normalized === "0" || normalized === "off" || normalized === "none" ||
    normalized === "unlimited"
  ) {
    return undefined;
  }
  return parseIntValue(envName, rawValue, defaultValue, {
    min: options?.min ?? 1,
    ...(options?.max !== undefined ? { max: options.max } : {}),
    warn: (message: string) =>
      logWarn(message, { module: "platform/remote-fetch-config" }),
  });
}

export function getRemoteFetchLimits(env: Env): RemoteFetchLimits {
  return {
    fullPack: {
      maxPackfileBytes: parseConfiguredLimit(
        "TAKOS_APP_DEPLOY_REMOTE_PACKFILE_MAX_BYTES",
        env.TAKOS_APP_DEPLOY_REMOTE_PACKFILE_MAX_BYTES,
        100 * 1024 * 1024,
      ) ?? null,
      readLimits: {
        maxObjectCount: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_OBJECTS_MAX",
          env.TAKOS_APP_DEPLOY_REMOTE_OBJECTS_MAX,
          500_000,
        ),
        maxInflatedTotal: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_INFLATED_TOTAL_MAX_BYTES",
          env.TAKOS_APP_DEPLOY_REMOTE_INFLATED_TOTAL_MAX_BYTES,
          1024 * 1024 * 1024,
        ),
        maxObjectInflated: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_OBJECT_MAX_BYTES",
          env.TAKOS_APP_DEPLOY_REMOTE_OBJECT_MAX_BYTES,
          256 * 1024 * 1024,
        ),
        maxDeltaResultInflated: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_DELTA_RESULT_MAX_BYTES",
          env.TAKOS_APP_DEPLOY_REMOTE_DELTA_RESULT_MAX_BYTES,
          64 * 1024 * 1024,
        ),
        maxDeltaChainDepth: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_DELTA_CHAIN_MAX_DEPTH",
          env.TAKOS_APP_DEPLOY_REMOTE_DELTA_CHAIN_MAX_DEPTH,
          50,
        ),
      },
    },
    blobPack: {
      maxPackfileBytes: parseConfiguredLimit(
        "TAKOS_APP_DEPLOY_REMOTE_BLOB_PACKFILE_MAX_BYTES",
        env.TAKOS_APP_DEPLOY_REMOTE_BLOB_PACKFILE_MAX_BYTES,
        100 * 1024 * 1024,
      ) ?? null,
      readLimits: {
        maxObjectCount: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_BLOB_OBJECTS_MAX",
          env.TAKOS_APP_DEPLOY_REMOTE_BLOB_OBJECTS_MAX,
          128,
        ),
        maxInflatedTotal: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_BLOB_INFLATED_TOTAL_MAX_BYTES",
          env.TAKOS_APP_DEPLOY_REMOTE_BLOB_INFLATED_TOTAL_MAX_BYTES,
          128 * 1024 * 1024,
        ),
        maxObjectInflated: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_BLOB_OBJECT_MAX_BYTES",
          env.TAKOS_APP_DEPLOY_REMOTE_BLOB_OBJECT_MAX_BYTES,
          128 * 1024 * 1024,
        ),
        maxDeltaResultInflated: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_BLOB_DELTA_RESULT_MAX_BYTES",
          env.TAKOS_APP_DEPLOY_REMOTE_BLOB_DELTA_RESULT_MAX_BYTES,
          128 * 1024 * 1024,
        ),
        maxDeltaChainDepth: parseConfiguredLimit(
          "TAKOS_APP_DEPLOY_REMOTE_BLOB_DELTA_CHAIN_MAX_DEPTH",
          env.TAKOS_APP_DEPLOY_REMOTE_BLOB_DELTA_CHAIN_MAX_DEPTH,
          50,
        ),
      },
    },
    archive: {
      maxArchiveBytes: parseConfiguredLimit(
        "TAKOS_APP_DEPLOY_REMOTE_ARCHIVE_MAX_BYTES",
        env.TAKOS_APP_DEPLOY_REMOTE_ARCHIVE_MAX_BYTES,
        200 * 1024 * 1024,
      ) ?? null,
    },
  };
}
