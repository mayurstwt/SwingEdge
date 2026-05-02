interface CircuitState {
  failures: number;
  threshold: number;
  blocked: boolean;
  lastFailureTime: number;
  resetTimeoutMs: number;
}

export class CircuitBreaker {
  private states: Map<string, CircuitState> = new Map();

  constructor(private defaultThreshold: number = 3) {}

  async execute<T>(
    name: string,
    fn: () => Promise<T>,
    options: { threshold?: number; resetTimeoutMs?: number } = {}
  ): Promise<T> {
    const threshold = options.threshold ?? this.defaultThreshold;
    const resetTimeoutMs = options.resetTimeoutMs ?? 60000; // 1 minute

    let state = this.states.get(name);
    if (!state) {
      state = { failures: 0, threshold, blocked: false, lastFailureTime: 0, resetTimeoutMs };
      this.states.set(name, state);
    }

    // Check if circuit should reset
    if (state.blocked && Date.now() - state.lastFailureTime > state.resetTimeoutMs) {
      state.failures = 0;
      state.blocked = false;
      console.log(`🔄 Circuit breaker for "${name}" reset`);
    }

    if (state.blocked) {
      throw new Error(`Circuit breaker open for "${name}". Service unavailable.`);
    }

    try {
      const result = await fn();
      state.failures = 0; // Reset on success
      return result;
    } catch (error) {
      state.failures++;
      state.lastFailureTime = Date.now();

      if (state.failures >= state.threshold) {
        state.blocked = true;
        console.error(`🔴 Circuit breaker OPEN for "${name}" after ${state.failures} failures`);
      }

      throw error;
    }
  }

  getStatus(name: string) {
    const state = this.states.get(name);
    return {
      name,
      failures: state?.failures ?? 0,
      blocked: state?.blocked ?? false,
    };
  }
}

export const breaker = new CircuitBreaker();
