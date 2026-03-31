import { BUILTIN_TOOLS, getBuiltinTool } from '@/tools/builtin';
import {
  canRoleAccessTool,
  filterToolsForRole,
  getToolPolicyMetadata,
  validateBuiltinToolPolicies,
} from '@/tools/tool-policy';
import { getRequiredCapabilitiesForTool } from '@/tools/capabilities';


import { assertEquals, assert, assertObjectMatch } from 'jsr:@std/assert';

  Deno.test('tool-policy - validates built-in workspace policy metadata', () => {
  assertEquals(validateBuiltinToolPolicies(BUILTIN_TOOLS), []);
})
  Deno.test('tool-policy - enforces service delete access policy', () => {
  const serviceDelete = getBuiltinTool('service_delete');

    assert(serviceDelete !== undefined);

    assertEquals(canRoleAccessTool('editor', serviceDelete!), false);
    assertEquals(canRoleAccessTool('owner', serviceDelete!), true);
})
  Deno.test('tool-policy - enforces deploy_frontend access policy', () => {
  const deployFrontend = getBuiltinTool('deploy_frontend');

    assert(deployFrontend !== undefined);

    assertEquals(canRoleAccessTool('editor', deployFrontend!), false);
    assertEquals(canRoleAccessTool('admin', deployFrontend!), true);
})
  Deno.test('tool-policy - filters workspace-mapped tools by workspace role', () => {
  const tools = [
      getBuiltinTool('service_list')!,
      getBuiltinTool('service_delete')!,
      getBuiltinTool('skill_list')!,
      getBuiltinTool('skill_update')!,
    ];

    assertEquals(filterToolsForRole(tools, 'viewer').map((tool) => tool.name), [
      'service_list',
      'skill_list',
    ]);
    assertEquals(filterToolsForRole(tools, 'admin').map((tool) => tool.name), [
      'service_list',
      'service_delete',
      'skill_list',
      'skill_update',
    ]);
})
  Deno.test('tool-policy - maps service lifecycle tools to workspace operations', () => {
  assertObjectMatch(getToolPolicyMetadata('service_delete'), {
      operation_id: 'service.delete',
    });
})
  Deno.test('tool-policy - maps repository ownership tools to workspace operations', () => {
  assertObjectMatch(getToolPolicyMetadata('create_repository'), {
      operation_id: 'repo.create',
    });
    assertObjectMatch(getToolPolicyMetadata('repo_fork'), {
      operation_id: 'repo.fork',
    });
})
  Deno.test('tool-policy - hides repo ownership tools from viewers', () => {
  const tools = [
      getBuiltinTool('create_repository')!,
      getBuiltinTool('repo_fork')!,
      getBuiltinTool('store_search')!,
    ];

    assertEquals(filterToolsForRole(tools, 'viewer').map((tool) => tool.name), [
      'store_search',
    ]);
    assertEquals(filterToolsForRole(tools, 'editor').map((tool) => tool.name), [
      'create_repository',
      'repo_fork',
      'store_search',
    ]);
})
  Deno.test('tool-policy - maps skill introspection helpers to workspace operations', () => {
  assertObjectMatch(getToolPolicyMetadata('skill_catalog'), {
      operation_id: 'skill.catalog',
    });
    assertObjectMatch(getToolPolicyMetadata('skill_describe'), {
      operation_id: 'skill.describe',
    });
})
  Deno.test('tool-policy - exposes skill introspection helpers to viewers', () => {
  const tools = [
      getBuiltinTool('skill_catalog')!,
      getBuiltinTool('skill_describe')!,
      getBuiltinTool('skill_delete')!,
    ];

    assertEquals(filterToolsForRole(tools, 'viewer').map((tool) => tool.name), [
      'skill_catalog',
      'skill_describe',
    ]);
})
  Deno.test('tool-policy - maps workspace storage write helpers to storage.write capability', () => {
  assertEquals(getRequiredCapabilitiesForTool('workspace_files_write'), ['storage.write']);
    assertEquals(getRequiredCapabilitiesForTool('workspace_files_create'), ['storage.write']);
    assertEquals(getRequiredCapabilitiesForTool('workspace_files_delete'), ['storage.write']);
})
  Deno.test('tool-policy - maps repository ownership helpers to repo capabilities', () => {
  assertEquals(getRequiredCapabilitiesForTool('create_repository'), ['repo.write']);
    assertEquals(getRequiredCapabilitiesForTool('repo_fork'), ['repo.write']);
    assertEquals(getRequiredCapabilitiesForTool('repo_switch'), ['repo.read']);
})