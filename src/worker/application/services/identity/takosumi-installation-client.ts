// Takosumi space-Installation dual-write client.
//
// This integration targeted the retired synchronous install facade. That
// surface no longer exists: Takosumi is now an OpenTofu-native deploy control
// plane where installs are driven by Installation + PlanRun / ApplyRun against
// a runner profile, which is not a synchronous install-and-return facade and is
// not orchestrated from the Takos app today.
//
// The dual-write was always opt-in via retired install env config that was unset
// in every configured environment, so this path already returned `null` /
// `false` at runtime; the corresponding retired Env fields have
// been removed. This module keeps the call surface used by space create/delete
// as a no-op stub so the dormant dual-write can be re-wired to the
// OpenTofu-native deploy control API later without reintroducing the retired
// Installer client.
import type { Env } from "../../../shared/types/index.ts";

export interface TakosumiInstallationResult {
  installationId: string;
  deploymentId?: string;
  status: string;
}

export async function createTakosumiInstallation(
  _env: Env,
  _spaceId: string,
  _spaceName: string,
): Promise<TakosumiInstallationResult | null> {
  // Retired synchronous install integration; OpenTofu-native re-wiring is not yet
  // implemented, so this stays a no-op (matching the prior unset-env behavior).
  return null;
}

export async function deleteTakosumiInstallation(
  _env: Env,
  _installationId: string,
): Promise<boolean> {
  // Retired synchronous install integration; no-op until the OpenTofu-native deploy
  // control API uninstall path is wired through.
  return false;
}
