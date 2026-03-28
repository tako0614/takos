/**
 * Binding formatting helpers for WFP.
 *
 * Extracted from service.ts to keep the facade thin.
 * These functions convert domain-level WorkerBinding objects into the
 * wire format expected by the Cloudflare API.
 */

import type { WorkerBinding, CloudflareBindingRecord } from './wfp-contracts';
import { BadRequestError } from '@takoserver/common/errors';

/**
 * Convert a strongly-typed WorkerBinding into the Cloudflare API record shape.
 */
export function formatBinding(binding: WorkerBinding): Record<string, unknown> {
  switch (binding.type) {
    case 'plain_text':
      return { type: 'plain_text', name: binding.name, text: binding.text };
    case 'secret_text':
      return { type: 'secret_text', name: binding.name, text: binding.text };
    case 'd1':
      return { type: 'd1', name: binding.name, id: binding.database_id };
    case 'r2_bucket':
      return { type: 'r2_bucket', name: binding.name, bucket_name: binding.bucket_name };
    case 'kv_namespace':
      return { type: 'kv_namespace', name: binding.name, namespace_id: binding.namespace_id };
    case 'queue':
      return {
        type: 'queue',
        name: binding.name,
        ...(binding.queue_name ? { queue_name: binding.queue_name } : {}),
        ...(typeof binding.delivery_delay === 'number' ? { delivery_delay: binding.delivery_delay } : {}),
      };
    case 'analytics_engine':
      return {
        type: 'analytics_engine',
        name: binding.name,
        ...(binding.dataset ? { dataset: binding.dataset } : {}),
      };
    case 'workflow':
      return {
        type: 'workflow',
        name: binding.name,
        ...(binding.workflow_name ? { workflow_name: binding.workflow_name } : {}),
        ...(binding.class_name ? { class_name: binding.class_name } : {}),
        ...(binding.script_name ? { script_name: binding.script_name } : {}),
      };
    case 'vectorize':
      return { type: 'vectorize', name: binding.name, index_name: binding.index_name };
    case 'service':
      return { type: 'service', name: binding.name, service: binding.service, environment: binding.environment };
    case 'durable_object_namespace':
      return {
        type: 'durable_object_namespace',
        name: binding.name,
        class_name: binding.class_name,
        ...(binding.script_name ? { script_name: binding.script_name } : {}),
      };
    default:
      throw new BadRequestError(`Unknown binding type: ${binding.type}`);
  }
}

/**
 * Convert an arbitrary binding-like object into the wire format suitable for
 * a settings PATCH request.  Handles WorkerBinding, CloudflareBindingRecord,
 * and raw record shapes gracefully.
 */
export function formatBindingForUpdate(
  binding: WorkerBinding | CloudflareBindingRecord | Record<string, unknown>,
): Record<string, unknown> {
  if (!binding || typeof binding !== 'object') {
    throw new BadRequestError('Invalid worker binding for update: expected object');
  }

  const candidate = binding as Record<string, unknown>;
  const type = typeof candidate.type === 'string' ? candidate.type : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';

  switch (type) {
    case 'plain_text':
    case 'secret_text':
      if (!name) break;
      return {
        type,
        name,
        ...(typeof candidate.text === 'string' ? { text: candidate.text } : {}),
      };
    case 'd1': {
      if (!name) break;
      const databaseId = typeof candidate.database_id === 'string'
        ? candidate.database_id
        : typeof candidate.id === 'string'
          ? candidate.id
          : undefined;
      if (databaseId) {
        return { type: 'd1', name, id: databaseId };
      }
      break;
    }
    case 'r2_bucket':
      if (!name) break;
      return {
        type: 'r2_bucket',
        name,
        ...(typeof candidate.bucket_name === 'string' ? { bucket_name: candidate.bucket_name } : {}),
      };
    case 'kv_namespace':
      if (!name) break;
      return {
        type: 'kv_namespace',
        name,
        ...(typeof candidate.namespace_id === 'string' ? { namespace_id: candidate.namespace_id } : {}),
      };
    case 'queue':
      if (!name) break;
      return {
        type: 'queue',
        name,
        ...(typeof candidate.queue_name === 'string' ? { queue_name: candidate.queue_name } : {}),
        ...(typeof candidate.delivery_delay === 'number' ? { delivery_delay: candidate.delivery_delay } : {}),
      };
    case 'analytics_engine':
      if (!name) break;
      return {
        type: 'analytics_engine',
        name,
        ...(typeof candidate.dataset === 'string' ? { dataset: candidate.dataset } : {}),
      };
    case 'workflow':
      if (!name) break;
      return {
        type: 'workflow',
        name,
        ...(typeof candidate.workflow_name === 'string' ? { workflow_name: candidate.workflow_name } : {}),
        ...(typeof candidate.class_name === 'string' ? { class_name: candidate.class_name } : {}),
        ...(typeof candidate.script_name === 'string' ? { script_name: candidate.script_name } : {}),
      };
    case 'vectorize':
      if (!name) break;
      return {
        type: 'vectorize',
        name,
        ...(typeof candidate.index_name === 'string'
          ? { index_name: candidate.index_name }
          : typeof candidate.id === 'string'
            ? { index_name: candidate.id }
            : {}),
      };
    case 'service':
      if (!name) break;
      return {
        type: 'service',
        name,
        ...(typeof candidate.service === 'string' ? { service: candidate.service } : {}),
        ...(typeof candidate.environment === 'string' ? { environment: candidate.environment } : {}),
      };
    case 'durable_object_namespace':
      if (!name) break;
      return {
        type: 'durable_object_namespace',
        name,
        ...(typeof candidate.class_name === 'string' ? { class_name: candidate.class_name } : {}),
        ...(typeof candidate.script_name === 'string' ? { script_name: candidate.script_name } : {}),
      };
    default:
      break;
  }

  // Fail-open for unknown/unexpected binding shapes to avoid dropping data on settings PATCH.
  return {
    ...candidate,
    ...(type ? { type } : {}),
    ...(name ? { name } : {}),
  };
}
