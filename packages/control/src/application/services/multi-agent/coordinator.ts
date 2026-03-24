/**
 * Multi-Agent Framework — Coordinator.
 *
 * The AgentCoordinator manages agent lifecycle, message routing, and
 * workflow execution. It supports multiple coordination strategies:
 *
 * - sequential: Execute steps one after another
 * - parallel:   Execute independent steps concurrently
 * - pipeline:   Chain steps where output feeds into next input
 * - scatter-gather: Fan-out to multiple agents, collect results
 */

import type {
  AgentId,
  AgentRole,
  AgentWorker,
  AgentWorkerConfig,
  AgentMessage,
  AgentResponse,
  AgentEvent,
  AgentEventHandler,
  WorkflowDefinition,
  WorkflowResult,
  WorkflowStep,
  StepResult,
  AgentHealthInfo,
} from './types';
import { generateId } from '../../../shared/utils';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';

export class AgentCoordinator {
  private agents = new Map<AgentId, AgentWorker>();
  private roleIndex = new Map<AgentRole, Set<AgentId>>();
  private eventHandlers: AgentEventHandler[] = [];
  private _startedAt = Date.now();

  // ── Agent Registry ──────────────────────────────────────────────

  register(agent: AgentWorker, config?: AgentWorkerConfig): void {
    if (this.agents.has(agent.id)) {
      logWarn(`Agent ${agent.id} already registered, replacing`, { module: 'coordinator' });
    }

    this.agents.set(agent.id, agent);

    if (!this.roleIndex.has(agent.role)) {
      this.roleIndex.set(agent.role, new Set());
    }
    this.roleIndex.get(agent.role)!.add(agent.id);

    logInfo(`Registered agent ${agent.id} (${agent.role})`, { module: 'coordinator' });
  }

  unregister(agentId: AgentId): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.roleIndex.get(agent.role)?.delete(agentId);
    this.agents.delete(agentId);
  }

  getAgent(agentId: AgentId): AgentWorker | undefined {
    return this.agents.get(agentId);
  }

  getAgentsByRole(role: AgentRole): AgentWorker[] {
    const ids = this.roleIndex.get(role);
    if (!ids) return [];
    return Array.from(ids).map((id) => this.agents.get(id)!).filter(Boolean);
  }

  // ── Message Routing ─────────────────────────────────────────────

  async sendMessage(message: AgentMessage): Promise<AgentResponse> {
    const target = this.agents.get(message.to);
    if (!target) {
      return {
        messageId: message.id,
        status: 'error',
        error: `Agent ${message.to} not found`,
      };
    }

    await this.emitEvent({
      type: 'agent.message_sent',
      agentId: message.from,
      timestamp: Date.now(),
      data: { to: message.to, type: message.type },
    });

    const response = await target.handleMessage(message);

    await this.emitEvent({
      type: 'agent.message_received',
      agentId: message.to,
      timestamp: Date.now(),
      data: { from: message.from, type: message.type, status: response.status },
    });

    return response;
  }

  async broadcast(
    fromId: AgentId,
    role: AgentRole,
    type: string,
    payload: unknown,
  ): Promise<AgentResponse[]> {
    const agents = this.getAgentsByRole(role);
    const results = await Promise.allSettled(
      agents.map((agent) =>
        this.sendMessage({
          id: generateId(),
          from: fromId,
          to: agent.id,
          type,
          payload,
          priority: 'normal',
          timestamp: Date.now(),
        }),
      ),
    );

    return results.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { messageId: '', status: 'error' as const, error: String(r.reason) },
    );
  }

  // ── Workflow Execution ──────────────────────────────────────────

  async executeWorkflow(
    definition: WorkflowDefinition,
    signal?: AbortSignal,
  ): Promise<WorkflowResult> {
    const startedAt = Date.now();
    const stepResults = new Map<string, StepResult>();

    await this.emitEvent({
      type: 'workflow.started',
      agentId: 'coordinator',
      timestamp: startedAt,
      data: { workflowId: definition.id, strategy: definition.strategy },
    });

    try {
      switch (definition.strategy) {
        case 'sequential':
          await this.executeSequential(definition.steps, stepResults, signal);
          break;
        case 'parallel':
          await this.executeParallel(definition.steps, stepResults, signal);
          break;
        case 'pipeline':
          await this.executePipeline(definition.steps, stepResults, signal);
          break;
        case 'scatter-gather':
          await this.executeScatterGather(definition.steps, stepResults, signal);
          break;
      }

      const hasFailures = Array.from(stepResults.values()).some((r) => r.status === 'failed');

      return {
        workflowId: definition.id,
        status: hasFailures ? 'partial' : 'completed',
        stepResults,
        startedAt,
        completedAt: Date.now(),
      };
    } catch (err) {
      return {
        workflowId: definition.id,
        status: 'failed',
        stepResults,
        startedAt,
        completedAt: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async executeSequential(
    steps: WorkflowStep[],
    results: Map<string, StepResult>,
    signal?: AbortSignal,
  ): Promise<void> {
    let previousOutput: unknown = undefined;

    for (const step of steps) {
      this.throwIfAborted(signal);
      const result = await this.executeStep(step, previousOutput, signal);
      results.set(step.id, result);

      if (result.status === 'failed' && step.onError === 'fail') {
        throw new Error(`Step ${step.id} failed: ${result.error}`);
      }

      previousOutput = result.output;
    }
  }

  private async executeParallel(
    steps: WorkflowStep[],
    results: Map<string, StepResult>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Build dependency graph
    const completed = new Set<string>();
    const pending = new Map(steps.map((s) => [s.id, s]));

    while (pending.size > 0) {
      this.throwIfAborted(signal);

      // Find steps whose dependencies are all completed
      const ready: WorkflowStep[] = [];
      for (const entry of Array.from(pending.entries())) {
        const [id, step] = entry;
        const deps = step.dependsOn ?? [];
        if (deps.every((dep) => completed.has(dep))) {
          ready.push(step);
        }
      }

      if (ready.length === 0 && pending.size > 0) {
        throw new Error('Deadlock detected: no steps can proceed');
      }

      // Execute ready steps in parallel
      const batchResults = await Promise.allSettled(
        ready.map((step) => this.executeStep(step, undefined, signal)),
      );

      for (let i = 0; i < ready.length; i++) {
        const step = ready[i];
        const batchResult = batchResults[i];

        if (batchResult.status === 'fulfilled') {
          results.set(step.id, batchResult.value);
          if (batchResult.value.status === 'failed' && step.onError === 'fail') {
            throw new Error(`Step ${step.id} failed: ${batchResult.value.error}`);
          }
        } else {
          const failResult: StepResult = {
            stepId: step.id,
            agentId: '',
            status: 'failed',
            error: String(batchResult.reason),
            startedAt: Date.now(),
            completedAt: Date.now(),
          };
          results.set(step.id, failResult);
          if (step.onError === 'fail') {
            throw new Error(`Step ${step.id} failed: ${failResult.error}`);
          }
        }

        completed.add(step.id);
        pending.delete(step.id);
      }
    }
  }

  private async executePipeline(
    steps: WorkflowStep[],
    results: Map<string, StepResult>,
    signal?: AbortSignal,
  ): Promise<void> {
    let currentInput: unknown = undefined;

    for (const step of steps) {
      this.throwIfAborted(signal);
      const augmentedStep = { ...step, input: currentInput ?? step.input };
      const result = await this.executeStep(augmentedStep, currentInput, signal);
      results.set(step.id, result);

      if (result.status === 'failed') {
        if (step.onError === 'fail') {
          throw new Error(`Pipeline step ${step.id} failed: ${result.error}`);
        }
        if (step.onError === 'skip') continue;
      }

      currentInput = result.output;
    }
  }

  private async executeScatterGather(
    steps: WorkflowStep[],
    results: Map<string, StepResult>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Execute all steps in parallel regardless of dependencies
    const batchResults = await Promise.allSettled(
      steps.map((step) => this.executeStep(step, undefined, signal)),
    );

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const batchResult = batchResults[i];

      if (batchResult.status === 'fulfilled') {
        results.set(step.id, batchResult.value);
      } else {
        results.set(step.id, {
          stepId: step.id,
          agentId: '',
          status: 'failed',
          error: String(batchResult.reason),
          startedAt: Date.now(),
          completedAt: Date.now(),
        });
      }
    }
  }

  private async executeStep(
    step: WorkflowStep,
    previousOutput: unknown,
    signal?: AbortSignal,
  ): Promise<StepResult> {
    const agents = this.getAgentsByRole(step.agentRole);
    if (agents.length === 0) {
      return {
        stepId: step.id,
        agentId: '',
        status: 'failed',
        error: `No agent available for role: ${step.agentRole}`,
        startedAt: Date.now(),
        completedAt: Date.now(),
      };
    }

    // Pick least-busy agent
    const agent = this.selectAgent(agents);
    const startedAt = Date.now();

    await this.emitEvent({
      type: 'workflow.step_started',
      agentId: agent.id,
      timestamp: startedAt,
      data: { stepId: step.id, role: step.agentRole },
    });

    try {
      const input = previousOutput ?? step.input;
      const stepSignal = step.timeoutMs
        ? this.createTimeoutSignal(step.timeoutMs, signal)
        : signal;

      const output = await agent.execute(input, stepSignal);
      const completedAt = Date.now();

      await this.emitEvent({
        type: 'workflow.step_completed',
        agentId: agent.id,
        timestamp: completedAt,
        data: { stepId: step.id, status: 'completed' },
      });

      return {
        stepId: step.id,
        agentId: agent.id,
        status: 'completed',
        output,
        startedAt,
        completedAt,
      };
    } catch (err) {
      const completedAt = Date.now();
      const error = err instanceof Error ? err.message : String(err);

      await this.emitEvent({
        type: 'workflow.step_completed',
        agentId: agent.id,
        timestamp: completedAt,
        data: { stepId: step.id, status: 'failed', error },
      });

      return {
        stepId: step.id,
        agentId: agent.id,
        status: 'failed',
        error,
        startedAt,
        completedAt,
      };
    }
  }

  private selectAgent(agents: AgentWorker[]): AgentWorker {
    // Pick agent with fewest active tasks
    let best = agents[0];
    let bestCount = best.getHealthInfo().activeTaskCount;

    for (let i = 1; i < agents.length; i++) {
      const count = agents[i].getHealthInfo().activeTaskCount;
      if (count < bestCount) {
        best = agents[i];
        bestCount = count;
      }
    }

    return best;
  }

  // ── Events ──────────────────────────────────────────────────────

  onEvent(handler: AgentEventHandler): () => void {
    this.eventHandlers.push(handler);
    return () => {
      const idx = this.eventHandlers.indexOf(handler);
      if (idx >= 0) this.eventHandlers.splice(idx, 1);
    };
  }

  private async emitEvent(event: AgentEvent): Promise<void> {
    for (const handler of this.eventHandlers) {
      try {
        await handler(event);
      } catch (err) {
        logWarn('Event handler error', { module: 'coordinator', detail: err });
      }
    }
  }

  // ── Health ──────────────────────────────────────────────────────

  getSystemHealth(): {
    agents: AgentHealthInfo[];
    totalAgents: number;
    activeAgents: number;
    uptime: number;
  } {
    const agents = Array.from(this.agents.values()).map((a) => a.getHealthInfo());
    return {
      agents,
      totalAgents: agents.length,
      activeAgents: agents.filter((a) => a.status === 'running').length,
      uptime: Date.now() - this._startedAt,
    };
  }

  // ── Shutdown ────────────────────────────────────────────────────

  async shutdownAll(): Promise<void> {
    const shutdowns = Array.from(this.agents.values()).map((agent) =>
      agent.shutdown().catch((err) => {
        logWarn(`Agent ${agent.id} shutdown failed`, { module: 'coordinator', detail: err });
      }),
    );
    await Promise.allSettled(shutdowns);
    this.agents.clear();
    this.roleIndex.clear();
  }

  // ── Utilities ───────────────────────────────────────────────────

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error('Workflow aborted');
    }
  }

  private createTimeoutSignal(timeoutMs: number, parentSignal?: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Step timed out')), timeoutMs);

    if (parentSignal) {
      if (parentSignal.aborted) {
        clearTimeout(timer);
        controller.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener('abort', () => {
          clearTimeout(timer);
          controller.abort(parentSignal.reason);
        }, { once: true });
      }
    }

    // Clear timer when the signal aborts (prevents leak)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });

    return controller.signal;
  }
}
