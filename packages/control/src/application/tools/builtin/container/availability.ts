import type { ToolContext } from '../../tool-definitions.ts';

function buildFailureDetails(context: ToolContext): string[] {
  const failure = context.getLastContainerStartFailure();
  if (!failure) {
    return [];
  }

  const lines = [
    'No container is running because the most recent container_start failed.',
    '',
    `Last start error: ${failure.message}`,
  ];

  if (failure.sessionId) {
    lines.push(`Failed session ID: ${failure.sessionId}`);
  }

  return lines;
}

export function appendContainerStartFailureContext(
  context: ToolContext,
  fallbackMessage: string,
  retryHint: string
): string {
  const failureLines = buildFailureDetails(context);
  if (failureLines.length === 0) {
    return fallbackMessage;
  }

  failureLines.push('');
  failureLines.push(retryHint);
  return failureLines.join('\n');
}

export function buildContainerUnavailableMessage(
  context: ToolContext,
  action: string
): string {
  return appendContainerStartFailureContext(
    context,
    `No container is running. Call container_start first before ${action}.`,
    `Resolve that error and call container_start again before ${action}.`
  );
}

export function buildContainerStatusUnavailableMessage(context: ToolContext): string {
  return appendContainerStartFailureContext(
    context,
    'No container is running.\n\nCall container_start to start a development container before using file operations.',
    'Resolve that error and call container_start again before using file operations.'
  );
}

export function requireContainerSession(
  context: ToolContext,
  action: string
): string {
  if (!context.sessionId) {
    throw new Error(buildContainerUnavailableMessage(context, action));
  }

  return context.sessionId;
}
