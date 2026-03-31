import type {
  AppContainer,
  AppWorker,
  ServiceBinding,
  WorkerScaling,
} from '../app-manifest-types.ts';
import {
  asRecord,
  asRequiredString,
  asStringArray,
  asStringMap,
  normalizeRepoPath,
} from '../app-manifest-utils.ts';
import { parseHealthCheck } from './parse-containers.ts';

// ============================================================
// Worker scaling parser
// ============================================================

function parseScaling(raw: unknown, _prefix: string): WorkerScaling | undefined {
  if (!raw) return undefined;
  const record = asRecord(raw);
  return {
    ...(record.minInstances != null ? { minInstances: Number(record.minInstances) } : {}),
    ...(record.maxConcurrency != null ? { maxConcurrency: Number(record.maxConcurrency) } : {}),
  };
}

// ============================================================
// Worker build parser
// ============================================================

function parseWorkerBuild(workerName: string, workerSpec: Record<string, unknown>) {
  const buildSpec = asRecord(workerSpec.build);
  const artifactSpec = asRecord(workerSpec.artifact);
  const fromWorkflow = asRecord(buildSpec.fromWorkflow);
  if (buildSpec.command != null || buildSpec.output != null || buildSpec.cwd != null || workerSpec.entry != null) {
    throw new Error(`spec.workers.${workerName} local build fields are not supported; use build.fromWorkflow`);
  }
  if (Object.keys(buildSpec).length > 0) {
    if (Object.keys(fromWorkflow).length === 0) {
      throw new Error(`spec.workers.${workerName}.build.fromWorkflow is required`);
    }
    const workflowPath = normalizeRepoPath(asRequiredString(fromWorkflow.path, `spec.workers.${workerName}.build.fromWorkflow.path`));
    if (!workflowPath.startsWith('.takos/workflows/')) {
      throw new Error(`spec.workers.${workerName}.build.fromWorkflow.path must be under .takos/workflows/`);
    }
    return {
      build: {
        fromWorkflow: {
          path: workflowPath,
          job: asRequiredString(fromWorkflow.job, `spec.workers.${workerName}.build.fromWorkflow.job`),
          artifact: asRequiredString(fromWorkflow.artifact, `spec.workers.${workerName}.build.fromWorkflow.artifact`),
          artifactPath: normalizeRepoPath(asRequiredString(fromWorkflow.artifactPath, `spec.workers.${workerName}.build.fromWorkflow.artifactPath`)),
        },
      },
    };
  }
  if (artifactSpec.kind === 'bundle') {
    const deploymentId = typeof artifactSpec.deploymentId === 'string' && artifactSpec.deploymentId.trim().length > 0
      ? artifactSpec.deploymentId.trim()
      : undefined;
    const artifactRef = typeof artifactSpec.artifactRef === 'string' && artifactSpec.artifactRef.trim().length > 0
      ? artifactSpec.artifactRef.trim()
      : undefined;
    if (!deploymentId && !artifactRef) {
      throw new Error(`spec.workers.${workerName}.artifact.bundle requires deploymentId or artifactRef`);
    }
    return {
      artifact: {
        kind: 'bundle' as const,
        ...(deploymentId ? { deploymentId } : {}),
        ...(artifactRef ? { artifactRef } : {}),
      },
    };
  }
  throw new Error(`spec.workers.${workerName} must define build.fromWorkflow or artifact.kind=bundle`);
}

// ============================================================
// Worker bindings parser
// ============================================================

function parseWorkerBindings(workerName: string, workerSpec: Record<string, unknown>): { bindings: AppWorker['bindings'] } {
  const bindingsRecord = asRecord(workerSpec.bindings);
  const d1 = asStringArray(bindingsRecord.d1, `spec.workers.${workerName}.bindings.d1`);
  const r2 = asStringArray(bindingsRecord.r2, `spec.workers.${workerName}.bindings.r2`);
  const kv = asStringArray(bindingsRecord.kv, `spec.workers.${workerName}.bindings.kv`);
  const vectorize = asStringArray(bindingsRecord.vectorize, `spec.workers.${workerName}.bindings.vectorize`);
  const queues = asStringArray(bindingsRecord.queues, `spec.workers.${workerName}.bindings.queues`);
  const analytics = asStringArray(bindingsRecord.analytics, `spec.workers.${workerName}.bindings.analytics`);
  const workflows = asStringArray(bindingsRecord.workflows, `spec.workers.${workerName}.bindings.workflows`);
  const durableObjectsArr = asStringArray(bindingsRecord.durableObjects, `spec.workers.${workerName}.bindings.durableObjects`);

  // services: string[] | { name, version }[] — both forms accepted
  let services: ServiceBinding[] | undefined;
  const servicesRaw = bindingsRecord.services;
  if (servicesRaw != null) {
    if (!Array.isArray(servicesRaw)) {
      throw new Error(`spec.workers.${workerName}.bindings.services must be an array`);
    }
    services = servicesRaw.map((entry, i) => {
      if (typeof entry === 'string') return entry;
      const obj = asRecord(entry);
      return {
        name: asRequiredString(obj.name, `spec.workers.${workerName}.bindings.services[${i}].name`),
        ...(obj.version ? { version: String(obj.version) } : {}),
      };
    });
  }

  return {
    bindings: {
      ...(d1 ? { d1 } : {}),
      ...(r2 ? { r2 } : {}),
      ...(kv ? { kv } : {}),
      ...(vectorize ? { vectorize } : {}),
      ...(queues ? { queues } : {}),
      ...(analytics ? { analytics } : {}),
      ...(workflows ? { workflows } : {}),
      ...(durableObjectsArr ? { durableObjects: durableObjectsArr } : {}),
      ...(services ? { services } : {}),
    },
  };
}

// ============================================================
// Worker triggers parser
// ============================================================

function parseWorkerTriggers(workerName: string, workerSpec: Record<string, unknown>): { triggers: AppWorker['triggers'] } {
  const triggersRecord = asRecord(workerSpec.triggers);
  const schedulesRaw = triggersRecord.schedules;
  const queuesRaw = triggersRecord.queues;
  const schedules = schedulesRaw == null ? undefined : (() => {
    if (!Array.isArray(schedulesRaw)) {
      throw new Error(`spec.workers.${workerName}.triggers.schedules must be an array`);
    }
    return schedulesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        cron: asRequiredString(record.cron, `spec.workers.${workerName}.triggers.schedules[${index}].cron`),
        export: asRequiredString(record.export, `spec.workers.${workerName}.triggers.schedules[${index}].export`),
      };
    });
  })();
  const queues = queuesRaw == null ? undefined : (() => {
    if (!Array.isArray(queuesRaw)) {
      throw new Error(`spec.workers.${workerName}.triggers.queues must be an array`);
    }
    return queuesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        queue: asRequiredString(record.queue, `spec.workers.${workerName}.triggers.queues[${index}].queue`),
        export: asRequiredString(record.export, `spec.workers.${workerName}.triggers.queues[${index}].export`),
      };
    });
  })();
  return {
    triggers: {
      ...(schedules ? { schedules } : {}),
      ...(queues ? { queues } : {}),
    },
  };
}

// ============================================================
// Workers parser
// ============================================================

export function parseWorkers(
  specRecord: Record<string, unknown>,
  containers: Record<string, AppContainer>,
): Record<string, AppWorker> {
  const workersRecord = asRecord(specRecord.workers);
  const workers: Record<string, AppWorker> = {};
  const workerNames = Object.keys(workersRecord);
  if (workerNames.length === 0) {
    throw new Error('spec.workers must contain at least one worker');
  }

  for (const [workerName, workerValue] of Object.entries(workersRecord)) {
    const workerSpec = asRecord(workerValue);
    const build = parseWorkerBuild(workerName, workerSpec);

    // Validate container references
    let containerRefs: string[] | undefined;
    const containersRaw = workerSpec.containers;
    if (containersRaw != null) {
      if (!Array.isArray(containersRaw)) {
        throw new Error(`spec.workers.${workerName}.containers must be an array of container names`);
      }
      containerRefs = containersRaw.map((entry, i) => {
        const ref = asRequiredString(entry, `spec.workers.${workerName}.containers[${i}]`);
        if (!containers[ref]) {
          throw new Error(`spec.workers.${workerName}.containers[${i}] references unknown container: ${ref}`);
        }
        return ref;
      });
    }

    const workerHealthCheck = parseHealthCheck(workerSpec.healthCheck, `spec.workers.${workerName}`);
    const workerScaling = parseScaling(workerSpec.scaling, `spec.workers.${workerName}`);
    const workerDependsOn = asStringArray(workerSpec.dependsOn, `spec.workers.${workerName}.dependsOn`);
    workers[workerName] = {
      ...(containerRefs && containerRefs.length > 0 ? { containers: containerRefs } : {}),
      ...build,
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(workerSpec.env, `spec.workers.${workerName}.env`); return v ? { env: v } : {}; })()),
      ...(workerSpec.bindings ? parseWorkerBindings(workerName, workerSpec) : {}),
      ...(workerSpec.triggers ? parseWorkerTriggers(workerName, workerSpec) : {}),
      ...(workerHealthCheck ? { healthCheck: workerHealthCheck } : {}),
      ...(workerScaling ? { scaling: workerScaling } : {}),
      ...(workerDependsOn ? { dependsOn: workerDependsOn } : {}),
    };
  }

  return workers;
}

// ============================================================
// Synthetic services builder (for resource validation)
// ============================================================

/**
 * Build a synthetic service map from workers so that
 * `parseResources` / `validateResourceBindings` can work.
 */
export function buildSyntheticServicesFromWorkers(
  workers: Record<string, AppWorker>,
): Record<string, { type: 'worker'; bindings?: AppWorker['bindings']; triggers?: AppWorker['triggers'] }> {
  const services: Record<string, { type: 'worker'; bindings?: AppWorker['bindings']; triggers?: AppWorker['triggers'] }> = {};
  for (const [name, worker] of Object.entries(workers)) {
    services[name] = {
      type: 'worker',
      ...(worker.bindings ? { bindings: worker.bindings } : {}),
      ...(worker.triggers ? { triggers: worker.triggers } : {}),
    };
  }
  return services;
}
