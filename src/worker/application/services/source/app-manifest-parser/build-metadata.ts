export function buildMetadataDisabledMessage(field: string): string {
  return `${field} is no longer supported by the Takos app manifest parser; ` +
    `resolve artifacts upstream with the Takosumi OpenTofu module PlanRun flow and ` +
    `apply the reviewed expected guard returned by PlanRun.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function assertComputeInputDoesNotUseBuildMetadata(
  prefix: string,
  raw: unknown,
): void {
  if (!isRecord(raw)) return;
  if (raw.build != null) {
    throw new Error(buildMetadataDisabledMessage(`${prefix}.build`));
  }

  const containers = raw.containers;
  if (!isRecord(containers)) return;
  for (const [name, value] of Object.entries(containers)) {
    assertComputeInputDoesNotUseBuildMetadata(
      `${prefix}.containers.${name}`,
      value,
    );
  }
}

export function assertManifestInputDoesNotUseBuildMetadata(raw: unknown): void {
  if (!isRecord(raw)) return;

  const compute = raw.compute;
  if (isRecord(compute)) {
    for (const [name, value] of Object.entries(compute)) {
      assertComputeInputDoesNotUseBuildMetadata(`compute.${name}`, value);
    }
  }

  const overrides = raw.overrides;
  if (!isRecord(overrides)) return;
  for (const [envName, envOverride] of Object.entries(overrides)) {
    if (!isRecord(envOverride) || !isRecord(envOverride.compute)) continue;
    for (const [name, value] of Object.entries(envOverride.compute)) {
      assertComputeInputDoesNotUseBuildMetadata(
        `overrides.${envName}.compute.${name}`,
        value,
      );
    }
  }
}
