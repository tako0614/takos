import type { AgentMessage } from './types';

export const PRODUCT_HINTS = ['takos', 'yurucommu', 'roadtome'] as const;
export type ProductHint = typeof PRODUCT_HINTS[number];

export type DelegationLocale = 'ja' | 'en';

export type DelegationPacket = {
  task: string;
  goal: string | null;
  deliverable: string | null;
  constraints: string[];
  context: string[];
  acceptance_criteria: string[];
  product_hint: ProductHint | null;
  locale: DelegationLocale | null;
  parent_run_id: string;
  parent_thread_id: string;
  root_thread_id: string;
  thread_summary: string | null;
  thread_key_points: string[];
};

export type DelegationPacketObservability = {
  explicit_field_count: number;
  inferred_field_count: number;
  has_thread_summary: boolean;
  constraints_count: number;
  context_count: number;
};

type BuildDelegationPacketInput = {
  task: string;
  goal?: string | null;
  deliverable?: string | null;
  constraints?: string[];
  context?: string[];
  acceptanceCriteria?: string[];
  productHint?: string | null;
  locale?: string | null;
  parentRunId: string;
  parentThreadId: string;
  rootThreadId: string;
  latestUserMessage?: string | null;
  parentRunInput?: Record<string, unknown>;
  threadSummary?: string | null;
  threadKeyPoints?: string[];
  threadLocale?: string | null;
  workspaceLocale?: string | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => !!item);
}

export function isDelegationLocale(value: unknown): value is DelegationLocale {
  return value === 'ja' || value === 'en';
}

export function isProductHint(value: unknown): value is ProductHint {
  return typeof value === 'string' && (PRODUCT_HINTS as readonly string[]).includes(value);
}

export function parseRunInputObject(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
    return {};
  }

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

function flattenDelegationSource(input: Record<string, unknown>): Record<string, unknown> {
  const delegation = input.delegation;
  if (delegation && typeof delegation === 'object' && !Array.isArray(delegation)) {
    return delegation as Record<string, unknown>;
  }
  return input;
}

export function getDelegationPacketFromRunInput(input: unknown): DelegationPacket | null {
  const packetSource = flattenDelegationSource(parseRunInputObject(input));
  const task = normalizeText(packetSource.task);
  const parentRunId = normalizeText(packetSource.parent_run_id);
  const parentThreadId = normalizeText(packetSource.parent_thread_id);
  const rootThreadId = normalizeText(packetSource.root_thread_id);

  if (!task || !parentRunId || !parentThreadId || !rootThreadId) {
    return null;
  }

  const productHint = isProductHint(packetSource.product_hint) ? packetSource.product_hint : null;
  const locale = isDelegationLocale(packetSource.locale) ? packetSource.locale : null;

  return {
    task,
    goal: normalizeText(packetSource.goal),
    deliverable: normalizeText(packetSource.deliverable),
    constraints: normalizeStringArray(packetSource.constraints),
    context: normalizeStringArray(packetSource.context),
    acceptance_criteria: normalizeStringArray(packetSource.acceptance_criteria),
    product_hint: productHint,
    locale,
    parent_run_id: parentRunId,
    parent_thread_id: parentThreadId,
    root_thread_id: rootThreadId,
    thread_summary: normalizeText(packetSource.thread_summary),
    thread_key_points: normalizeStringArray(packetSource.thread_key_points),
  };
}

export function inferProductHintFromTextSamples(samples: Array<string | null | undefined>): ProductHint | null {
  const weights: Record<ProductHint, number> = {
    takos: 0,
    yurucommu: 0,
    roadtome: 0,
  };

  const matchers: Record<ProductHint, RegExp[]> = {
    takos: [
      /\bdocs\/takos\b/i,
      /\btakos\b/i,
      /\btakos-(control|web|runtime|dispatch|agent|executor)\b/i,
      /\bapps\/control\b/i,
    ],
    yurucommu: [
      /\bdocs\/yurucommu\b/i,
      /\byurucommu\b/i,
      /\bproducts\/yurucommu\b/i,
    ],
    roadtome: [
      /\bdocs\/roadtome\b/i,
      /\broadtome\b/i,
      /\broad-to-me\b/i,
      /\broad to me\b/i,
      /\bproducts\/road-to-me\b/i,
    ],
  };

  for (const sample of samples) {
    if (!sample) {
      continue;
    }
    for (const [product, regexes] of Object.entries(matchers) as Array<[ProductHint, RegExp[]]>) {
      for (const regex of regexes) {
        if (regex.test(sample)) {
          weights[product] += 1;
        }
      }
    }
  }

  const ranked = Object.entries(weights)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1]) as Array<[ProductHint, number]>;

  if (ranked.length === 0) {
    return null;
  }
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return null;
  }
  return ranked[0][0];
}

function getStringFromSource(source: Record<string, unknown>, key: string): string | null {
  return normalizeText(source[key]);
}

function getProductHintFromSource(source: Record<string, unknown>): ProductHint | null {
  return isProductHint(source.product_hint) ? source.product_hint : null;
}

function getLocaleFromSource(source: Record<string, unknown>): DelegationLocale | null {
  return isDelegationLocale(source.locale) ? source.locale : null;
}

export function buildDelegationPacket(input: BuildDelegationPacketInput): {
  packet: DelegationPacket;
  observability: DelegationPacketObservability;
} {
  const explicitTask = normalizeText(input.task);
  if (!explicitTask) {
    throw new Error('Delegation task must be a non-empty string');
  }

  const parentRunSource = flattenDelegationSource(parseRunInputObject(input.parentRunInput ?? {}));

  let explicitFieldCount = 1; // task is always explicit for spawn_agent
  let inferredFieldCount = 0;

  const explicitGoal = normalizeText(input.goal);
  const explicitDeliverable = normalizeText(input.deliverable);
  const explicitConstraints = normalizeStringArray(input.constraints);
  const explicitContext = normalizeStringArray(input.context);
  const explicitAcceptanceCriteria = normalizeStringArray(input.acceptanceCriteria);
  const explicitProductHint = isProductHint(input.productHint) ? input.productHint : null;
  const explicitLocale = isDelegationLocale(input.locale) ? input.locale : null;

  if (explicitGoal) explicitFieldCount++;
  if (explicitDeliverable) explicitFieldCount++;
  if (explicitConstraints.length > 0) explicitFieldCount++;
  if (explicitContext.length > 0) explicitFieldCount++;
  if (explicitAcceptanceCriteria.length > 0) explicitFieldCount++;
  if (explicitProductHint) explicitFieldCount++;
  if (explicitLocale) explicitFieldCount++;

  const inferredGoal = normalizeText(input.latestUserMessage)
    ?? getStringFromSource(parentRunSource, 'goal')
    ?? getStringFromSource(parentRunSource, 'task');
  const goal = explicitGoal ?? inferredGoal;
  if (!explicitGoal && goal) inferredFieldCount++;

  const deliverable = explicitDeliverable ?? getStringFromSource(parentRunSource, 'deliverable');
  if (!explicitDeliverable && deliverable) inferredFieldCount++;

  const productHint = explicitProductHint ?? getProductHintFromSource(parentRunSource) ?? inferProductHintFromTextSamples([
    explicitTask,
    goal,
    deliverable,
    input.latestUserMessage ?? null,
    input.threadSummary ?? null,
    ...(input.threadKeyPoints ?? []),
  ]);
  if (!explicitProductHint && productHint) inferredFieldCount++;

  const locale = explicitLocale
    ?? getLocaleFromSource(parentRunSource)
    ?? (isDelegationLocale(input.threadLocale) ? input.threadLocale : null)
    ?? (isDelegationLocale(input.workspaceLocale) ? input.workspaceLocale : null);
  if (!explicitLocale && locale) inferredFieldCount++;

  const packet: DelegationPacket = {
    task: explicitTask,
    goal,
    deliverable,
    constraints: explicitConstraints,
    context: explicitContext,
    acceptance_criteria: explicitAcceptanceCriteria,
    product_hint: productHint,
    locale,
    parent_run_id: input.parentRunId,
    parent_thread_id: input.parentThreadId,
    root_thread_id: input.rootThreadId,
    thread_summary: normalizeText(input.threadSummary),
    thread_key_points: (input.threadKeyPoints ?? []).map((item) => item.trim()).filter(Boolean),
  };

  return {
    packet,
    observability: {
      explicit_field_count: explicitFieldCount,
      inferred_field_count: inferredFieldCount,
      has_thread_summary: !!packet.thread_summary,
      constraints_count: packet.constraints.length,
      context_count: packet.context.length,
    },
  };
}

export function buildDelegationSystemMessage(packet: DelegationPacket): AgentMessage {
  const lines = ['Delegated execution context:'];

  if (packet.goal) lines.push(`Goal: ${packet.goal}`);
  if (packet.product_hint) lines.push(`Product hint: ${packet.product_hint}`);
  if (packet.deliverable) lines.push(`Deliverable: ${packet.deliverable}`);
  if (packet.thread_summary) lines.push(`Parent thread summary: ${packet.thread_summary}`);
  if (packet.thread_key_points.length > 0) {
    lines.push('Parent thread key points:');
    for (const keyPoint of packet.thread_key_points) {
      lines.push(`- ${keyPoint}`);
    }
  }
  if (packet.constraints.length > 0) {
    lines.push('Constraints:');
    for (const constraint of packet.constraints) {
      lines.push(`- ${constraint}`);
    }
  }
  if (packet.context.length > 0) {
    lines.push('Relevant context:');
    for (const item of packet.context) {
      lines.push(`- ${item}`);
    }
  }
  if (packet.acceptance_criteria.length > 0) {
    lines.push('Acceptance criteria:');
    for (const criterion of packet.acceptance_criteria) {
      lines.push(`- ${criterion}`);
    }
  }

  return {
    role: 'system',
    content: lines.join('\n'),
  };
}

export function buildDelegationUserMessage(packet: DelegationPacket): AgentMessage {
  return {
    role: 'user',
    content: `[Delegated sub-task from parent agent (run: ${packet.parent_run_id})]\n\n${packet.task}`,
  };
}
