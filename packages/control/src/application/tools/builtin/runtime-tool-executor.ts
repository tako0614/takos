import type { ToolDefinition, ToolHandler, ToolContext, RuntimeExecResponse } from '../tool-definitions';
import { getDb, sessionRepos, sessions } from '../../../infra/db';
import { eq, and } from 'drizzle-orm';
import { emitRunUsageEvent } from '../../services/offload/usage-client';
import { callRuntimeRequest } from '../../services/execution/runtime-request-handler';
import { buildContainerUnavailableMessage } from './container/availability';

const DEFAULT_TOOL_TIMEOUT_SECONDS = 300;
const MAX_TOOL_TIMEOUT_SECONDS = 1800;

function requireContainer(context: ToolContext): void {
  if (!context.sessionId) {
    throw new Error(buildContainerUnavailableMessage(context, 'using runtime_exec'));
  }
}

export const RUNTIME_EXEC: ToolDefinition = {
  name: 'runtime_exec',
  description: 'Execute commands in takos-runtime (npm, esbuild, git, etc.). Commands are executed sequentially. Files persist in session directory.',
  category: 'runtime',
  parameters: {
    type: 'object',
    properties: {
      commands: {
        type: 'array',
        description: 'Commands to execute sequentially (e.g., ["npm install", "npm run build"])',
        items: { type: 'string', description: 'Command to execute' },
      },
      working_dir: {
        type: 'string',
        description: 'Working directory relative to workspace root (optional, defaults to root)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (optional, default: 300, max: 1800)',
      },
      env: {
        type: 'object',
        description: 'Environment variables for command execution',
      },
    },
    required: ['commands'],
  },
};

export const RUNTIME_STATUS: ToolDefinition = {
  name: 'runtime_status',
  description: 'Check the status of a running runtime process',
  category: 'runtime',
  parameters: {
    type: 'object',
    properties: {
      runtime_id: {
        type: 'string',
        description: 'Runtime process ID returned from runtime_exec',
      },
    },
    required: ['runtime_id'],
  },
};

function validateWorkingDir(workingDir: string): string {
  const normalized = workingDir
    .replace(/\\/g, '/')           // Convert backslashes to forward slashes
    .replace(/\/+/g, '/')          // Remove duplicate slashes
    .replace(/^\/+/, '')           // Remove leading slashes
    .replace(/\/+$/, '');          // Remove trailing slashes

  if (/\0/.test(normalized)) {
    throw new Error('Invalid working directory: contains null bytes');
  }

  if (normalized.includes('..')) {
    throw new Error('Invalid working directory: path traversal not allowed');
  }

  return normalized || '.';
}

function validateCommands(commands: string[]): void {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('Commands must be a non-empty array');
  }

  if (commands.length > 10000) {
    throw new Error('Too many commands: maximum 10000 commands per execution');
  }

  const dangerousPatterns = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?[/\\]($|\s)/i,  // rm -rf / only
    /\breboot\b/i,
    /\bshutdown\b/i,
    /\bpoweroff\b/i,
    /\bhalt\b/i,
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,  // Fork bomb
  ];

  for (const cmd of commands) {
    if (typeof cmd !== 'string' || cmd.trim().length === 0) {
      throw new Error('Each command must be a non-empty string');
    }

    if (cmd.length > 1000000) {
      throw new Error('Command too long: maximum 1000000 characters');
    }

    const trimmedCmd = cmd.trim();

    for (const pattern of dangerousPatterns) {
      if (pattern.test(trimmedCmd)) {
        throw new Error(`Dangerous command pattern detected`);
      }
    }
  }
}

export const runtimeExecHandler: ToolHandler = async (args, context) => {
  const commands = args.commands as string[];

  validateCommands(commands);
  const workingDir = validateWorkingDir((args.working_dir as string) || '.');

  const timeout = Math.min((args.timeout as number) || DEFAULT_TOOL_TIMEOUT_SECONDS, MAX_TOOL_TIMEOUT_SECONDS);
  const userEnvVars = args.env as Record<string, string> | undefined;

  const { env, db } = context;

  const envVars: Record<string, string> = { ...userEnvVars };

  if (context.sessionId) {
    envVars.TAKOS_SESSION_ID = context.sessionId;

    const drizzle = getDb(db);
    const primaryRepo = await drizzle.select({ repoId: sessionRepos.repoId })
      .from(sessionRepos).where(and(eq(sessionRepos.sessionId, context.sessionId), eq(sessionRepos.isPrimary, true))).get();
    if (primaryRepo?.repoId) {
      envVars.TAKOS_REPO_ID = primaryRepo.repoId;
    } else {
      const session = await drizzle.select({ repoId: sessions.repoId })
        .from(sessions).where(eq(sessions.id, context.sessionId)).get();
      if (session?.repoId) {
        envVars.TAKOS_REPO_ID = session.repoId;
      }
    }
  }

  envVars.TAKOS_API_URL = env.ADMIN_DOMAIN
    ? `https://${env.ADMIN_DOMAIN}`
    : 'http://localhost:8080/cli-proxy';

  if (!env.RUNTIME_HOST) {
    throw new Error('RUNTIME_HOST binding is required for runtime_exec');
  }

  requireContainer(context);

  const clientTimeoutMs = (timeout + 10) * 1000;

  const execStartMs = Date.now();
  const response = await (async () => {
    try {
      return await callRuntimeRequest(env, '/session/exec', {
        method: 'POST',
        body: {
          session_id: context.sessionId,
          space_id: context.spaceId,
          commands,
          working_dir: workingDir,
          env: envVars,
          timeout,
        },
        timeoutMs: clientTimeoutMs,
        signal: context.abortSignal,
      });
    } finally {
      const elapsedSeconds = Math.ceil((Date.now() - execStartMs) / 1000);
      try {
        await emitRunUsageEvent(context.env, {
          runId: context.runId,
          meterType: 'exec_seconds',
          units: elapsedSeconds,
          referenceType: 'runtime_exec',
        });
      } catch {
        // Non-fatal
      }
    }
  })();

  if (!response.ok) {
    const error = await response.json() as { error: string };
    throw new Error(error.error || 'Runtime execution failed');
  }

  const result = await response.json() as {
    success: boolean;
    exit_code: number;
    output: string;
  };

  if (!result.success) {
    return `Commands failed (exit code ${result.exit_code}).\n\nOutput:\n${result.output}`;
  }

  return `Commands completed successfully.\n\nOutput:\n${result.output}`;
};

export const runtimeStatusHandler: ToolHandler = async (args, context) => {
  const runtimeId = args.runtime_id as string;

  const { env } = context;

  if (!env.RUNTIME_HOST) {
    throw new Error('RUNTIME_HOST binding is required for runtime_status');
  }

  const response = await callRuntimeRequest(env, `/status/${runtimeId}`, {
    method: 'GET',
    timeoutMs: 30000,
    signal: context.abortSignal,
  });

  if (response.status === 404) {
    return `Runtime process not found: ${runtimeId}`;
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get status: ${response.status} - ${error}`);
  }

  const result = await response.json() as RuntimeExecResponse;

  let statusText = `Runtime: ${runtimeId}\nStatus: ${result.status}`;

  if (result.exit_code !== undefined) {
    statusText += `\nExit Code: ${result.exit_code}`;
  }

  if (result.output) {
    statusText += `\n\nOutput:\n${result.output}`;
  }

  if (result.error) {
    statusText += `\n\nError:\n${result.error}`;
  }

  return statusText;
};

export const RUNTIME_TOOLS: ToolDefinition[] = [
  RUNTIME_EXEC,
  RUNTIME_STATUS,
];

export const RUNTIME_HANDLERS: Record<string, ToolHandler> = {
  runtime_exec: runtimeExecHandler,
  runtime_status: runtimeStatusHandler,
};
