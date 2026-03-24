import { describe, expect, it } from 'vitest';
import { BUILTIN_TOOLS, getBuiltinTool } from '@/tools/builtin';
import {
  canRoleAccessTool,
  filterToolsForRole,
  getToolPolicyMetadata,
  validateBuiltinToolPolicies,
} from '@/tools/tool-policy';
import { getRequiredCapabilitiesForTool } from '@/tools/capabilities';

describe('tool-policy', () => {
  it('validates built-in workspace policy metadata', () => {
    expect(validateBuiltinToolPolicies(BUILTIN_TOOLS)).toEqual([]);
  });

  it('enforces service delete access policy', () => {
    const serviceDelete = getBuiltinTool('service_delete');

    expect(serviceDelete).toBeDefined();

    expect(canRoleAccessTool('editor', serviceDelete!)).toBe(false);
    expect(canRoleAccessTool('owner', serviceDelete!)).toBe(true);
  });

  it('enforces deploy_frontend access policy', () => {
    const deployFrontend = getBuiltinTool('deploy_frontend');

    expect(deployFrontend).toBeDefined();

    expect(canRoleAccessTool('editor', deployFrontend!)).toBe(false);
    expect(canRoleAccessTool('admin', deployFrontend!)).toBe(true);
  });

  it('filters workspace-mapped tools by workspace role', () => {
    const tools = [
      getBuiltinTool('service_list')!,
      getBuiltinTool('service_delete')!,
      getBuiltinTool('skill_list')!,
      getBuiltinTool('skill_update')!,
    ];

    expect(filterToolsForRole(tools, 'viewer').map((tool) => tool.name)).toEqual([
      'service_list',
      'skill_list',
    ]);
    expect(filterToolsForRole(tools, 'admin').map((tool) => tool.name)).toEqual([
      'service_list',
      'service_delete',
      'skill_list',
      'skill_update',
    ]);
  });

  it('maps service lifecycle tools to workspace operations', () => {
    expect(getToolPolicyMetadata('service_delete')).toMatchObject({
      operation_id: 'service.delete',
    });
  });

  it('maps repository ownership tools to workspace operations', () => {
    expect(getToolPolicyMetadata('create_repository')).toMatchObject({
      operation_id: 'repo.create',
    });
    expect(getToolPolicyMetadata('repo_fork')).toMatchObject({
      operation_id: 'repo.fork',
    });
  });

  it('hides repo ownership tools from viewers', () => {
    const tools = [
      getBuiltinTool('create_repository')!,
      getBuiltinTool('repo_fork')!,
      getBuiltinTool('store_search')!,
    ];

    expect(filterToolsForRole(tools, 'viewer').map((tool) => tool.name)).toEqual([
      'store_search',
    ]);
    expect(filterToolsForRole(tools, 'editor').map((tool) => tool.name)).toEqual([
      'create_repository',
      'repo_fork',
      'store_search',
    ]);
  });

  it('maps skill introspection helpers to workspace operations', () => {
    expect(getToolPolicyMetadata('skill_catalog')).toMatchObject({
      operation_id: 'skill.catalog',
    });
    expect(getToolPolicyMetadata('skill_describe')).toMatchObject({
      operation_id: 'skill.describe',
    });
  });

  it('exposes skill introspection helpers to viewers', () => {
    const tools = [
      getBuiltinTool('skill_catalog')!,
      getBuiltinTool('skill_describe')!,
      getBuiltinTool('skill_delete')!,
    ];

    expect(filterToolsForRole(tools, 'viewer').map((tool) => tool.name)).toEqual([
      'skill_catalog',
      'skill_describe',
    ]);
  });

  it('maps workspace storage write helpers to storage.write capability', () => {
    expect(getRequiredCapabilitiesForTool('workspace_files_write')).toEqual(['storage.write']);
    expect(getRequiredCapabilitiesForTool('workspace_files_create')).toEqual(['storage.write']);
    expect(getRequiredCapabilitiesForTool('workspace_files_delete')).toEqual(['storage.write']);
  });

  it('maps repository ownership helpers to repo capabilities', () => {
    expect(getRequiredCapabilitiesForTool('create_repository')).toEqual(['repo.write']);
    expect(getRequiredCapabilitiesForTool('repo_fork')).toEqual(['repo.write']);
    expect(getRequiredCapabilitiesForTool('repo_switch')).toEqual(['repo.read']);
  });
});
