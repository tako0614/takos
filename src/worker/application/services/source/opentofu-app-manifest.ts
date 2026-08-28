export function selectInstallableSourcePathFromRepo(
  entries: ReadonlyArray<string>,
): string | null {
  for (const candidate of [
    "main.tf",
    "outputs.tf",
    "takos.tf",
    "opentofu/main.tf",
    "opentofu/outputs.tf",
    "infra/main.tf",
    "infra/outputs.tf",
    "deploy/opentofu/cloudflare/main.tf",
    "deploy/opentofu/cloudflare/outputs.tf",
  ]) {
    if (entries.includes(candidate)) return candidate;
  }
  return null;
}
