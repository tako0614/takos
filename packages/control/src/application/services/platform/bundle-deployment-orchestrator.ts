import type { Env } from '../../../shared/types';
import { CommonEnvService } from '../common-env';
import { InfraService } from './infra';
import { TakopackResourceService } from '../takopack/resources';
import { TakopackWorkerService } from '../takopack/workers';
import { BundleManagedMcpService } from '../takopack/tools';
import { BundleShortcutGroupService } from '../takopack/groups';

import type {
  TakopackManifest,
  InstallResult,
  GitInstallOptions,
  TakopackApplyReportEntry,
} from '../takopack/types';

import {
  installBundle,
  installResolvedPackage,
  type BundleDeploymentInstallServices,
  type BundleInstallOptions,
} from './bundle-deployment-install';
import {
  installFromGitSource,
  installFromStoredPackage as installFromStoredPackageImpl,
} from './bundle-deployment-dependencies';
import { uninstallBundleDeployment, type BundleDeploymentUninstaller } from './bundle-deployment-uninstall';
import { listBundleDeployments, getBundleDeployment, rollbackToPrevious } from './bundle-deployment-queries';

export type { TakopackManifest, InstallResult, GitInstallOptions };

export class BundleDeploymentOrchestrator implements BundleDeploymentUninstaller {
  private resourceService: TakopackResourceService;
  private workerService: TakopackWorkerService;
  private toolService: BundleManagedMcpService;
  private groupService: BundleShortcutGroupService;
  private commonEnvService: CommonEnvService;
  private infraService: InfraService;

  constructor(private env: Env) {
    this.resourceService = new TakopackResourceService(env);
    this.workerService = new TakopackWorkerService(env);
    this.toolService = new BundleManagedMcpService(env);
    this.groupService = new BundleShortcutGroupService(env);
    this.commonEnvService = new CommonEnvService(env);
    this.infraService = new InfraService(env);
  }

  private get services(): BundleDeploymentInstallServices {
    return {
      env: this.env,
      resourceService: this.resourceService,
      workerService: this.workerService,
      toolService: this.toolService,
      groupService: this.groupService,
      commonEnvService: this.commonEnvService,
      infraService: this.infraService,
    };
  }

  async install(
    spaceId: string,
    userId: string,
    takopackData: ArrayBuffer,
    options?: BundleInstallOptions,
  ): Promise<InstallResult> {
    return installBundle(
      this.services,
      this,
      (s, u, o) => this.installFromGit(s, u, o),
      spaceId,
      userId,
      takopackData,
      options,
    );
  }

  async installResolvedPackage(
    spaceId: string,
    userId: string,
    input: {
      manifest: TakopackManifest;
      files: Map<string, ArrayBuffer>;
      normalizedApplyReport: TakopackApplyReportEntry[];
      options?: BundleInstallOptions;
    },
  ): Promise<InstallResult> {
    return installResolvedPackage(
      this.services,
      this,
      (s, u, o) => this.installFromGit(s, u, o),
      spaceId,
      userId,
      input,
    );
  }

  async installFromGit(
    spaceId: string,
    userId: string,
    options: GitInstallOptions,
  ): Promise<InstallResult> {
    return installFromGitSource(
      this.env,
      (s, u, d, o) => this.install(s, u, d, o),
      spaceId,
      userId,
      options,
    );
  }

  async list(spaceId: string) {
    return listBundleDeployments(this.env, spaceId);
  }

  async get(spaceId: string, bundleDeploymentId: string) {
    return getBundleDeployment(this.env, spaceId, bundleDeploymentId);
  }

  async rollbackToPrevious(
    spaceId: string,
    userId: string,
    bundleDeploymentId: string,
    options?: {
      requireAutoEnvApproval?: boolean;
      oauthAutoEnvApproved?: boolean;
      takosBaseUrl?: string;
    },
  ): Promise<{ previousVersion: string; targetVersion: string; installed: InstallResult }> {
    return rollbackToPrevious(
      this.env,
      (s, u, ref, opts) => this.installFromStoredPackage(s, u, ref, opts),
      (s, u, o) => this.installFromGit(s, u, o),
      spaceId,
      userId,
      bundleDeploymentId,
      options,
    );
  }

  private async installFromStoredPackage(
    spaceId: string,
    userId: string,
    storedAssetRef: string,
    options?: {
      replaceBundleDeploymentId?: string;
      installAction?: 'install' | 'update' | 'rollback';
      requireAutoEnvApproval?: boolean;
      oauthAutoEnvApproved?: boolean;
      takosBaseUrl?: string;
      sourceRepoId?: string | null;
      sourceRef?: string | null;
    },
  ) {
    return installFromStoredPackageImpl(
      this.env,
      (s, u, d, o) => this.install(s, u, d, o),
      spaceId,
      userId,
      storedAssetRef,
      options,
    );
  }

  async uninstall(spaceId: string, bundleDeploymentId: string, options?: {
    deleteDeploymentRecord?: boolean;
    deleteResources?: boolean;
  }): Promise<void> {
    return uninstallBundleDeployment(
      this.env,
      this.commonEnvService,
      this.infraService,
      spaceId,
      bundleDeploymentId,
      options,
    );
  }
}

export function createBundleDeploymentOrchestrator(env: Env): BundleDeploymentOrchestrator {
  return new BundleDeploymentOrchestrator(env);
}
