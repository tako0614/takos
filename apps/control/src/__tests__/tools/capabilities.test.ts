import { describe, it, expect } from 'vitest';
import { getRequiredCapabilitiesForTool } from '@/tools/capabilities';

describe('getRequiredCapabilitiesForTool', () => {
  describe('egress.http tools', () => {
    it.each([
      'web_fetch',
      'browser_open',
      'browser_goto',
      'mcp_add_server',
      'domain_verify',
    ])('requires egress.http for %s', (toolName) => {
      const caps = getRequiredCapabilitiesForTool(toolName);
      expect(caps).toContain('egress.http');
    });
  });

  describe('repo.read tools', () => {
    it.each([
      'file_read',
      'file_list',
      'repo_list',
      'repo_status',
      'repo_switch',
    ])('requires repo.read for %s', (toolName) => {
      const caps = getRequiredCapabilitiesForTool(toolName);
      expect(caps).toContain('repo.read');
    });
  });

  describe('repo.write tools', () => {
    it.each([
      'create_repository',
      'repo_fork',
      'container_commit',
      'file_write',
      'file_write_binary',
      'file_delete',
      'file_mkdir',
      'file_rename',
      'file_copy',
    ])('requires repo.write for %s', (toolName) => {
      const caps = getRequiredCapabilitiesForTool(toolName);
      expect(caps).toContain('repo.write');
    });
  });

  describe('storage.read tools', () => {
    it.each([
      'search',
      'workspace_files_list',
      'workspace_files_read',
    ])('requires storage.read for %s', (toolName) => {
      const caps = getRequiredCapabilitiesForTool(toolName);
      expect(caps).toContain('storage.read');
    });
  });

  describe('storage.write tools', () => {
    it.each([
      'workspace_files_write',
      'workspace_files_create',
      'workspace_files_mkdir',
      'workspace_files_delete',
      'workspace_files_rename',
      'workspace_files_move',
    ])('requires storage.write for %s', (toolName) => {
      const caps = getRequiredCapabilitiesForTool(toolName);
      expect(caps).toContain('storage.write');
    });
  });

  describe('tools with no special capabilities', () => {
    it.each([
      'remember',
      'recall',
      'container_start',
      'container_stop',
      'runtime_exec',
      'create_artifact',
      'spawn_agent',
      'wait_agent',
      'some_unknown_tool',
    ])('returns empty array for %s', (toolName) => {
      const caps = getRequiredCapabilitiesForTool(toolName);
      expect(caps).toEqual([]);
    });
  });
});
