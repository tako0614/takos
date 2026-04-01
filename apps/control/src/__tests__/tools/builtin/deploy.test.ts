import { assertEquals } from 'jsr:@std/assert';

import { DEPLOY_FRONTEND, DEPLOY_TOOLS } from '@/tools/builtin/deploy';

Deno.test('deploy tools - DEPLOY_FRONTEND definition - has the correct name and required params', () => {
  assertEquals(DEPLOY_FRONTEND.name, 'deploy_frontend');
  assertEquals(DEPLOY_FRONTEND.category, 'deploy');
  assertEquals(DEPLOY_FRONTEND.parameters.required, ['app_name']);
});

Deno.test('deploy tools - DEPLOY_TOOLS - exports the deploy_frontend tool', () => {
  assertEquals(DEPLOY_TOOLS.length, 1);
  assertEquals(DEPLOY_TOOLS[0].name, 'deploy_frontend');
});
