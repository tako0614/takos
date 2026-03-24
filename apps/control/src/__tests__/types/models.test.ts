import { describe, expect, it } from 'vitest';
import modelsSource from '@/shared/types/models.ts?raw';

describe('shared DB model types', () => {
  it('does not keep removed Tenant or Project interfaces alive', () => {
    expect(modelsSource).not.toContain('export interface Tenant');
    expect(modelsSource).not.toContain('export interface Project');
    expect(modelsSource).not.toContain('export type ProjectType');
    expect(modelsSource).not.toContain('export type ProjectStatus');
  });

  it('does not expose removed tool package table models on the shared DB surface', () => {
    expect(modelsSource).not.toContain('export interface ToolPackage');
    expect(modelsSource).not.toContain('export interface WorkspaceTool');
    expect(modelsSource).not.toContain('export interface ToolReview');
  });

  it('does not expose removed project_id placeholders on canonical shared models', () => {
    expect(modelsSource).not.toMatch(/export interface WorkspaceFile[\s\S]*\bproject_id\b/);
    expect(modelsSource).not.toMatch(/export interface Thread[\s\S]*\bproject_id\b/);
  });

  it('exposes service-facing platform model names instead of worker-facing ones', () => {
    expect(modelsSource).toContain('export interface Service');
    expect(modelsSource).toContain('export type ServiceType');
    expect(modelsSource).toContain('export type ServiceStatus');
    expect(modelsSource).toContain('service_type: ServiceType;');
    expect(modelsSource).toContain('service_name: string | null;');
  });
});
