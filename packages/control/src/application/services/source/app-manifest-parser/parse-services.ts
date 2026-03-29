import type {
  AppService,
  AppMcpServer,
  AppFileHandler,
  ServiceBinding,
} from '../app-manifest-types';
import {
  asRecord,
  asString,
  asRequiredString,
  asStringArray,
  asStringMap,
  normalizeRepoPath,
} from '../app-manifest-utils';
import { parseHealthCheck, parseVolumes } from './parse-containers';

// ============================================================
// Service bindings list parser (services only)
// ============================================================

function parseServiceBindingsList(raw: unknown, prefix: string): ServiceBinding[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) {
    throw new Error(`${prefix} must be an array`);
  }
  return raw.map((entry, i) => {
    if (typeof entry === 'string') return entry;
    const obj = asRecord(entry);
    return {
      name: asRequiredString(obj.name, `${prefix}[${i}].name`),
      ...(obj.version ? { version: String(obj.version) } : {}),
    };
  });
}

// ============================================================
// Service triggers parser (schedules only)
// ============================================================

function parseServiceTriggers(name: string, serviceSpec: Record<string, unknown>): { triggers: AppService['triggers'] } | undefined {
  const raw = serviceSpec.triggers;
  if (!raw) return undefined;
  const triggersRecord = asRecord(raw);
  const schedulesRaw = triggersRecord.schedules;
  const schedules = schedulesRaw == null ? undefined : (() => {
    if (!Array.isArray(schedulesRaw)) {
      throw new Error(`spec.services.${name}.triggers.schedules must be an array`);
    }
    return schedulesRaw.map((entry, index) => {
      const record = asRecord(entry);
      return {
        cron: asRequiredString(record.cron, `spec.services.${name}.triggers.schedules[${index}].cron`),
        export: asRequiredString(record.export, `spec.services.${name}.triggers.schedules[${index}].export`),
      };
    });
  })();
  if (!schedules) return undefined;
  return {
    triggers: {
      ...(schedules ? { schedules } : {}),
    },
  };
}

// ============================================================
// Services parser
// ============================================================

export function parseServices(specRecord: Record<string, unknown>): Record<string, AppService> {
  const servicesRecord = asRecord(specRecord.services);
  const services: Record<string, AppService> = {};
  for (const [name, value] of Object.entries(servicesRecord)) {
    const s = asRecord(value);
    const port = Number(s.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`spec.services.${name}.port must be a positive number`);
    }
    const serviceHealthCheck = parseHealthCheck(s.healthCheck, `spec.services.${name}`);
    const serviceVolumes = parseVolumes(s.volumes, `spec.services.${name}`);
    const serviceDependsOn = asStringArray(s.dependsOn, `spec.services.${name}.dependsOn`);
    const serviceTriggers = parseServiceTriggers(name, s);

    // Parse service bindings (services only)
    let serviceBindings: AppService['bindings'] | undefined;
    if (s.bindings) {
      const bindingsRecord = asRecord(s.bindings);
      const svcBindings = parseServiceBindingsList(bindingsRecord.services, `spec.services.${name}.bindings.services`);
      if (svcBindings) {
        serviceBindings = { services: svcBindings };
      }
    }

    services[name] = {
      dockerfile: normalizeRepoPath(asRequiredString(s.dockerfile, `spec.services.${name}.dockerfile`)),
      port,
      ...(s.instanceType ? { instanceType: String(s.instanceType) } : {}),
      ...(s.maxInstances ? { maxInstances: Number(s.maxInstances) } : {}),
      ...(s.ipv4 === true ? { ipv4: true } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(s.env, `spec.services.${name}.env`); return v ? { env: v } : {}; })()),
      ...(serviceHealthCheck ? { healthCheck: serviceHealthCheck } : {}),
      ...(serviceBindings ? { bindings: serviceBindings } : {}),
      ...(serviceTriggers ? serviceTriggers : {}),
      ...(serviceVolumes ? { volumes: serviceVolumes } : {}),
      ...(serviceDependsOn ? { dependsOn: serviceDependsOn } : {}),
    };
  }
  return services;
}

// ============================================================
// MCP servers parser
// ============================================================

export function parseMcpServers(specRecord: Record<string, unknown>): AppMcpServer[] | undefined {
  const mcpServersRaw = specRecord.mcpServers;
  if (mcpServersRaw == null) return undefined;
  if (!Array.isArray(mcpServersRaw)) throw new Error('spec.mcpServers must be an array');
  return mcpServersRaw.map((entry, index) => {
    const server = asRecord(entry);
    const endpoint = asString(server.endpoint, `spec.mcpServers[${index}].endpoint`);
    const route = asString(server.route, `spec.mcpServers[${index}].route`);
    if (!endpoint && !route) {
      throw new Error(`spec.mcpServers[${index}].endpoint or spec.mcpServers[${index}].route is required`);
    }
    const authSecretRef = asString(server.authSecretRef, `spec.mcpServers[${index}].authSecretRef`);
    return {
      name: asRequiredString(server.name, `spec.mcpServers[${index}].name`),
      ...(endpoint ? { endpoint } : {}),
      ...(route ? { route } : {}),
      ...((() => { const v = asString(server.transport, `spec.mcpServers[${index}].transport`); return v ? { transport: v as 'streamable-http' } : {}; })()),
      ...(authSecretRef ? { authSecretRef } : {}),
    };
  });
}

// ============================================================
// File handlers parser
// ============================================================

export function parseFileHandlers(specRecord: Record<string, unknown>): AppFileHandler[] | undefined {
  const fileHandlersRaw = specRecord.fileHandlers;
  if (fileHandlersRaw == null) return undefined;
  if (!Array.isArray(fileHandlersRaw)) throw new Error('spec.fileHandlers must be an array');
  return fileHandlersRaw.map((entry, index) => {
    const handler = asRecord(entry);
    return {
      name: asRequiredString(handler.name, `spec.fileHandlers[${index}].name`),
      ...((() => { const v = asStringArray(handler.mimeTypes, `spec.fileHandlers[${index}].mimeTypes`); return v ? { mimeTypes: v } : {}; })()),
      ...((() => { const v = asStringArray(handler.extensions, `spec.fileHandlers[${index}].extensions`); return v ? { extensions: v } : {}; })()),
      openPath: asRequiredString(handler.openPath, `spec.fileHandlers[${index}].openPath`),
    };
  });
}
