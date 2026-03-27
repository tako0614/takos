import type { Env } from '../../../shared/types';
import { D1TransactionManager } from '../../../shared/utils/db-transaction';
import type { CommonEnvAuditActor } from './audit';
import {
  CommonEnvReconcileJobStore,
  type CommonEnvReconcileTrigger,
} from './reconcile-jobs';
import {
  type LinkSource,
  type SyncState,
} from './repository';
import { CommonEnvReconciler } from './reconciler';
import { CommonEnvOrchestrator } from './orchestrator';
import type { TakosBuiltinStatus } from './takos-builtins';

import {
  listSpaceCommonEnv,
  upsertSpaceCommonEnv,
  ensureSystemCommonEnv,
  deleteSpaceCommonEnv,
} from './space-env-ops';
import {
  ensureRequiredServiceLinks,
  listServiceCommonEnvLinks as listServiceCommonEnvLinksOp,
  listServiceManualLinkNames as listServiceManualLinkNamesOp,
  listServiceBuiltins as listServiceBuiltinsOp,
} from './service-link-ops';
import {
  upsertServiceTakosAccessTokenConfig as upsertServiceTakosAccessTokenConfigOp,
  deleteServiceTakosAccessTokenConfig as deleteServiceTakosAccessTokenConfigOp,
  deleteServiceTakosAccessTokenConfigs as deleteServiceTakosAccessTokenConfigsOp,
  setServiceManualLinks as setServiceManualLinksOp,
  patchServiceManualLinks as patchServiceManualLinksOp,
  markRequiredKeysLocallyOverriddenForService as markRequiredKeysLocallyOverriddenForServiceOp,
} from './manual-link-ops';

export class CommonEnvService {
  private readonly jobs: CommonEnvReconcileJobStore;
  private readonly reconciler: CommonEnvReconciler;
  private readonly orchestrator: CommonEnvOrchestrator;
  private readonly txManager: D1TransactionManager;

  constructor(private env: Env) {
    this.jobs = new CommonEnvReconcileJobStore(env);
    this.reconciler = new CommonEnvReconciler(env);
    this.orchestrator = new CommonEnvOrchestrator(env, this.jobs, this.reconciler);
    this.txManager = new D1TransactionManager(env.DB);
  }

  private get spaceEnvDeps() {
    return { env: this.env, txManager: this.txManager };
  }

  private get serviceLinkDeps() {
    return { env: this.env, txManager: this.txManager };
  }

  private get manualLinkDeps() {
    return { env: this.env, txManager: this.txManager, orchestrator: this.orchestrator };
  }

  // --- Space env CRUD ---

  async listSpaceCommonEnv(spaceId: string): Promise<Array<{
    name: string;
    secret: boolean;
    value: string;
    updatedAt: string;
  }>> {
    return listSpaceCommonEnv(this.spaceEnvDeps, spaceId);
  }

  async upsertSpaceCommonEnv(params: {
    spaceId: string;
    name: string;
    value: string;
    secret?: boolean;
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    return upsertSpaceCommonEnv(this.spaceEnvDeps, params);
  }

  async ensureSystemCommonEnv(spaceId: string, entries: Array<{
    name: string;
    value: string;
    secret?: boolean;
  }>): Promise<void> {
    return ensureSystemCommonEnv(this.spaceEnvDeps, spaceId, entries);
  }

  async deleteSpaceCommonEnv(spaceId: string, nameRaw: string, actor?: CommonEnvAuditActor): Promise<boolean> {
    return deleteSpaceCommonEnv(this.spaceEnvDeps, spaceId, nameRaw, actor);
  }

  // --- Service link queries and required links ---

  async ensureRequiredServiceLinks(params: {
    spaceId: string;
    serviceIds: string[];
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    return ensureRequiredServiceLinks(this.serviceLinkDeps, params);
  }

  async ensureRequiredLinks(params: {
    spaceId: string;
    workerIds: string[];
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    return this.ensureRequiredServiceLinks({
      spaceId: params.spaceId,
      serviceIds: params.workerIds,
      keys: params.keys,
      actor: params.actor,
    });
  }

  async listServiceCommonEnvLinks(spaceId: string, serviceId: string): Promise<Array<{
    name: string;
    source: LinkSource;
    hasCommonValue: boolean;
    syncState: SyncState;
    syncReason: string | null;
  }>> {
    return listServiceCommonEnvLinksOp(this.serviceLinkDeps, spaceId, serviceId);
  }

  async listWorkerCommonEnvLinks(spaceId: string, workerId: string): Promise<Array<{
    name: string;
    source: LinkSource;
    hasCommonValue: boolean;
    syncState: SyncState;
    syncReason: string | null;
  }>> {
    return this.listServiceCommonEnvLinks(spaceId, workerId);
  }

  async listServiceManualLinkNames(spaceId: string, serviceId: string): Promise<string[]> {
    return listServiceManualLinkNamesOp(this.serviceLinkDeps, spaceId, serviceId);
  }

  async listWorkerManualLinkNames(spaceId: string, workerId: string): Promise<string[]> {
    return this.listServiceManualLinkNames(spaceId, workerId);
  }

  async listServiceBuiltins(
    spaceId: string,
    serviceId: string,
  ): Promise<Record<string, TakosBuiltinStatus>> {
    return listServiceBuiltinsOp(this.serviceLinkDeps, spaceId, serviceId);
  }

  async listWorkerBuiltins(
    spaceId: string,
    workerId: string,
  ): Promise<Record<string, TakosBuiltinStatus>> {
    return this.listServiceBuiltins(spaceId, workerId);
  }

  // --- Takos builtin config ---

  async upsertServiceTakosAccessTokenConfig(params: {
    spaceId: string;
    serviceId: string;
    scopes: string[];
  }): Promise<void> {
    return upsertServiceTakosAccessTokenConfigOp(this.manualLinkDeps, params);
  }

  async upsertWorkerTakosAccessTokenConfig(params: {
    spaceId: string;
    workerId: string;
    scopes: string[];
  }): Promise<void> {
    return this.upsertServiceTakosAccessTokenConfig({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      scopes: params.scopes,
    });
  }

  async deleteServiceTakosAccessTokenConfig(params: {
    spaceId: string;
    serviceId: string;
  }): Promise<void> {
    return deleteServiceTakosAccessTokenConfigOp(this.manualLinkDeps, params);
  }

  async deleteWorkerTakosAccessTokenConfig(params: {
    spaceId: string;
    workerId: string;
  }): Promise<void> {
    return this.deleteServiceTakosAccessTokenConfig({
      spaceId: params.spaceId,
      serviceId: params.workerId,
    });
  }

  async deleteServiceTakosAccessTokenConfigs(params: {
    spaceId: string;
    serviceIds: string[];
  }): Promise<void> {
    return deleteServiceTakosAccessTokenConfigsOp(this.manualLinkDeps, params);
  }

  async deleteWorkerTakosAccessTokenConfigs(params: {
    spaceId: string;
    workerIds: string[];
  }): Promise<void> {
    return this.deleteServiceTakosAccessTokenConfigs({
      spaceId: params.spaceId,
      serviceIds: params.workerIds,
    });
  }

  // --- Manual link mutations ---

  async setWorkerManualLinks(params: {
    spaceId: string;
    workerId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    return this.setServiceManualLinks({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      keys: params.keys,
      actor: params.actor,
    });
  }

  async setServiceManualLinks(params: {
    spaceId: string;
    serviceId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    return setServiceManualLinksOp(this.manualLinkDeps, params);
  }

  async patchWorkerManualLinks(params: {
    spaceId: string;
    workerId: string;
    add?: string[];
    remove?: string[];
    set?: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<{ added: string[]; removed: string[] }> {
    return this.patchServiceManualLinks({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      add: params.add,
      remove: params.remove,
      set: params.set,
      actor: params.actor,
    });
  }

  async patchServiceManualLinks(params: {
    spaceId: string;
    serviceId: string;
    add?: string[];
    remove?: string[];
    set?: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<{ added: string[]; removed: string[] }> {
    return patchServiceManualLinksOp(this.manualLinkDeps, params);
  }

  async markRequiredKeysLocallyOverridden(params: {
    spaceId: string;
    workerId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    return this.markRequiredKeysLocallyOverriddenForService({
      spaceId: params.spaceId,
      serviceId: params.workerId,
      keys: params.keys,
      actor: params.actor,
    });
  }

  async markRequiredKeysLocallyOverriddenForService(params: {
    spaceId: string;
    serviceId: string;
    keys: string[];
    actor?: CommonEnvAuditActor;
  }): Promise<void> {
    return markRequiredKeysLocallyOverriddenForServiceOp(this.manualLinkDeps, params);
  }

  // --- Reconciliation / orchestration ---

  async enqueueServiceReconcile(params: {
    spaceId: string; serviceId: string; targetKeys?: string[]; trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.orchestrator.enqueueServiceReconcile(params);
  }

  async enqueueWorkerReconcile(params: {
    spaceId: string; workerId: string; targetKeys?: string[]; trigger: CommonEnvReconcileTrigger;
  }): Promise<void> {
    const { workerId: serviceId, ...rest } = params;
    return this.enqueueServiceReconcile({ ...rest, serviceId });
  }

  async reconcileWorkersForEnvKey(spaceId: string, envNameRaw: string, trigger: CommonEnvReconcileTrigger = 'workspace_env_put'): Promise<void> {
    await this.orchestrator.reconcileServicesForEnvKey(spaceId, envNameRaw, trigger);
  }

  async reconcileServicesForEnvKey(spaceId: string, envNameRaw: string, trigger: CommonEnvReconcileTrigger = 'workspace_env_put'): Promise<void> {
    await this.orchestrator.reconcileServicesForEnvKey(spaceId, envNameRaw, trigger);
  }

  async reconcileWorkers(params: {
    spaceId: string; workerIds: string[]; keys?: string[]; trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.orchestrator.reconcileServices({ spaceId: params.spaceId, serviceIds: params.workerIds, keys: params.keys, trigger: params.trigger });
  }

  async reconcileServices(params: {
    spaceId: string; serviceIds: string[]; keys?: string[]; trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.orchestrator.reconcileServices(params);
  }

  async processReconcileJobs(limit = 50): Promise<{ processed: number; completed: number; retried: number }> {
    return this.orchestrator.processReconcileJobs(limit);
  }

  async enqueuePeriodicDriftSweep(limit = 100): Promise<number> {
    return this.orchestrator.enqueuePeriodicDriftSweep(limit);
  }

  async reconcileWorkerCommonEnv(spaceId: string, workerId: string, options?: {
    targetKeys?: Set<string>; trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.reconcileServiceCommonEnv(spaceId, workerId, options);
  }

  async reconcileServiceCommonEnv(spaceId: string, serviceId: string, options?: {
    targetKeys?: Set<string>; trigger?: CommonEnvReconcileTrigger;
  }): Promise<void> {
    await this.reconciler.reconcileServiceCommonEnv(spaceId, serviceId, options);
  }
}

export function createCommonEnvService(env: Env): CommonEnvService {
  return new CommonEnvService(env);
}

export { CommonEnvService as ServiceCommonEnvService };
