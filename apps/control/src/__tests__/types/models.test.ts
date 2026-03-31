import modelsSource from '@/shared/types/models.ts?raw';


import { assert, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('shared DB model types - does not keep removed Tenant or Project interfaces alive', () => {
  assert(!(modelsSource).includes('export interface Tenant'));
    assert(!(modelsSource).includes('export interface Project'));
    assert(!(modelsSource).includes('export type ProjectType'));
    assert(!(modelsSource).includes('export type ProjectStatus'));
})
  Deno.test('shared DB model types - does not expose removed tool package table models on the shared DB surface', () => {
  assert(!(modelsSource).includes('export interface ToolPackage'));
    assert(!(modelsSource).includes('export interface WorkspaceTool'));
    assert(!(modelsSource).includes('export interface ToolReview'));
})
  Deno.test('shared DB model types - does not expose removed project_id placeholders on canonical shared models', () => {
  assert(!(/export interface SpaceFile[\s\S]*\bproject_id\b/).test(modelsSource));
    assert(!(/export interface Thread[\s\S]*\bproject_id\b/).test(modelsSource));
})
  Deno.test('shared DB model types - exposes service-facing platform model names instead of worker-facing ones', () => {
  assertStringIncludes(modelsSource, 'export interface Service');
    assertStringIncludes(modelsSource, 'export type ServiceType');
    assertStringIncludes(modelsSource, 'export type ServiceStatus');
    assertStringIncludes(modelsSource, 'service_type: ServiceType;');
    assertStringIncludes(modelsSource, 'service_name: string | null;');
})