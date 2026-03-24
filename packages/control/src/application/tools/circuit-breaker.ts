import { logInfo, logWarn } from '../../shared/utils/logger';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  openedAt: number | null;
}

interface CircuitBreakerConfig {
  // Number of failures before opening circuit
  failureThreshold: number;
  // Time in ms before trying half-open state
  resetTimeout: number;
  // Number of successes needed in half-open to close circuit
  successThreshold: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeout: 30_000, // 30 seconds
  successThreshold: 2,
};

export class CircuitBreaker {
  private circuits: Map<string, CircuitStats> = new Map();
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private getCircuit(toolName: string): CircuitStats {
    let circuit = this.circuits.get(toolName);
    if (!circuit) {
      circuit = {
        state: 'CLOSED',
        failures: 0,
        successes: 0,
        lastFailure: null,
        lastSuccess: null,
        openedAt: null,
      };
      this.circuits.set(toolName, circuit);
    }
    return circuit;
  }

  canExecute(toolName: string): { allowed: boolean; reason?: string } {
    const circuit = this.getCircuit(toolName);
    const now = Date.now();

    switch (circuit.state) {
      case 'CLOSED':
        return { allowed: true };

      case 'OPEN':
        // Check if reset timeout has passed
        if (circuit.openedAt && now - circuit.openedAt >= this.config.resetTimeout) {
          // Transition to half-open
          circuit.state = 'HALF_OPEN';
          circuit.successes = 0;
          logInfo(`Tool "${toolName}" transitioning to HALF_OPEN state`, { module: 'circuitbreaker' });
          return { allowed: true };
        }
        return {
          allowed: false,
          reason: `Circuit breaker OPEN for tool "${toolName}" - ${this.config.failureThreshold} consecutive failures. ` +
                  `Will retry in ${Math.ceil((this.config.resetTimeout - (now - (circuit.openedAt || 0))) / 1000)}s.`,
        };

      case 'HALF_OPEN':
        return { allowed: true };

      default:
        return { allowed: true };
    }
  }

  recordSuccess(toolName: string): void {
    const circuit = this.getCircuit(toolName);
    circuit.lastSuccess = Date.now();

    switch (circuit.state) {
      case 'HALF_OPEN':
        circuit.successes++;
        if (circuit.successes >= this.config.successThreshold) {
          // Close the circuit
          circuit.state = 'CLOSED';
          circuit.failures = 0;
          circuit.openedAt = null;
          logInfo(`Tool "${toolName}" circuit CLOSED after successful recovery`, { module: 'circuitbreaker' });
        }
        break;

      case 'CLOSED':
        // Reset failure count on success
        circuit.failures = 0;
        break;
    }
  }

  recordFailure(toolName: string, error?: string): void {
    const circuit = this.getCircuit(toolName);
    circuit.failures++;
    circuit.lastFailure = Date.now();

    switch (circuit.state) {
      case 'HALF_OPEN':
        // Any failure in half-open reopens the circuit
        circuit.state = 'OPEN';
        circuit.openedAt = Date.now();
        logWarn(`Tool "${toolName}" circuit REOPENED after failure in HALF_OPEN: ${error}`, { module: 'circuitbreaker' });
        break;

      case 'CLOSED':
        if (circuit.failures >= this.config.failureThreshold) {
          circuit.state = 'OPEN';
          circuit.openedAt = Date.now();
          logWarn(`Tool "${toolName}" circuit OPENED after ${this.config.failureThreshold} failures. ` +
            `Last error: ${error}`, { module: 'circuitbreaker' });
        }
        break;
    }
  }

  getState(toolName: string): CircuitStats {
    return { ...this.getCircuit(toolName) };
  }

  getAllStates(): Map<string, CircuitStats> {
    const result = new Map<string, CircuitStats>();
    for (const [name, stats] of this.circuits) {
      result.set(name, { ...stats });
    }
    return result;
  }

  reset(toolName: string): void {
    this.circuits.delete(toolName);
  }

  resetAll(): void {
    this.circuits.clear();
  }
}
