import { describe, expect, it, vi } from 'vitest';

vi.mock('@takos/control-hosts/container-runtime', () => ({
  Container: class {},
  HostContainerRuntime: class {},
}));

import {
  getRequiredProxyCapability,
  validateProxyResourceAccess,
} from '@/runtime/container-hosts/executor-host';

describe('executor-host proxy capability boundaries', () => {
  it('maps binding and control paths to distinct capabilities', () => {
    expect(getRequiredProxyCapability('/proxy/db/first')).toBe('bindings');
    expect(getRequiredProxyCapability('/proxy/runtime/fetch')).toBe('bindings');
    expect(getRequiredProxyCapability('/proxy/browser/fetch')).toBe('bindings');
    expect(getRequiredProxyCapability('/proxy/heartbeat')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/heartbeat')).toBe('control');
    expect(getRequiredProxyCapability('/proxy/run/reset')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/run-reset')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/run-record')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/run-bootstrap')).toBe('control');
    expect(getRequiredProxyCapability('/proxy/api-keys')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/api-keys')).toBe('control');
    expect(getRequiredProxyCapability('/proxy/billing/run-usage')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/billing-run-usage')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/run-context')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/no-llm-complete')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/conversation-history')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/skill-plan')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/memory-activation')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/memory-finalize')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/add-message')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/update-run-status')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/current-session')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/is-cancelled')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/tool-catalog')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/tool-execute')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/tool-cleanup')).toBe('control');
    expect(getRequiredProxyCapability('/rpc/control/run-event')).toBe('control');
  });

  it('rejects unknown proxy paths', () => {
    expect(getRequiredProxyCapability('/proxy/unknown')).toBeNull();
    // /proxy/token/refresh no longer exists
    expect(getRequiredProxyCapability('/proxy/token/refresh')).toBeNull();
  });

  it('allows only run-bound notifier fetches', () => {
    expect(validateProxyResourceAccess('/proxy/do/fetch', { run_id: 'run-1' }, {
      namespace: 'RUN_NOTIFIER',
      name: 'run-1',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/do/fetch', { run_id: 'run-1' }, {
      namespace: 'RUN_NOTIFIER',
      name: 'run-2',
    })).toBe(false);
    expect(validateProxyResourceAccess('/proxy/do/fetch', { run_id: 'run-1' }, {
      namespace: 'OTHER',
      name: 'run-1',
    })).toBe(false);
  });

  it('allows only the index queue through the generic queue proxy', () => {
    expect(validateProxyResourceAccess('/proxy/queue/send', {}, { queue: 'index' })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/queue/send', {}, { queue: 'other' })).toBe(false);
  });

  it('allows only runtime-host URLs on the runtime proxy allowlist', () => {
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', {}, {
      url: 'https://runtime-host/session/exec',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', {}, {
      url: 'https://runtime-host/repos/clone',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', {}, {
      url: 'https://runtime-host/metrics',
    })).toBe(false);
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', {}, {
      url: 'https://example.com/session/exec',
    })).toBe(false);
  });

  it('allows only browser-host URLs on the browser proxy allowlist', () => {
    expect(validateProxyResourceAccess('/proxy/browser/fetch', {}, {
      url: 'https://browser-host.internal/create',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', {}, {
      url: 'https://browser-host.internal/session/sid-1/action',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', {}, {
      url: 'https://browser-host.internal/session/sid-1/screenshot',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', {}, {
      url: 'https://browser-host.internal/unknown',
    })).toBe(false);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', {}, {
      url: 'https://example.com/session/sid-1/goto',
    })).toBe(false);
  });
});
