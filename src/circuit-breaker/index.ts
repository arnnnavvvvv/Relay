// Per-provider circuit breaker: closed -> open -> half-open state machine (Hystrix-style) backed by a CircuitBreakerStore.
import type { CircuitBreakerStore } from "./store.js";

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold: number; // failures within rollingWindowMs that trip closed -> open
  rollingWindowMs: number; // window over which failures accumulate
  openDurationMs: number; // how long to stay open before allowing a half-open probe
  now?: () => number; // injectable clock, for deterministic tests
}

const DEFAULT_OPTIONS: Omit<CircuitBreakerOptions, "now"> = {
  failureThreshold: 3,
  rollingWindowMs: 30_000,
  openDurationMs: 10_000,
};

export class CircuitBreaker {
  private readonly options: Required<Omit<CircuitBreakerOptions, "now">> & { now: () => number };
  private readonly failuresKey: string;
  private readonly stateKey: string;
  private readonly openedAtKey: string;
  private readonly probeKey: string;

  constructor(
    private readonly store: CircuitBreakerStore,
    private readonly name: string,
    options: Partial<CircuitBreakerOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, now: () => Date.now(), ...options };
    this.failuresKey = `cb:${name}:failures`;
    this.stateKey = `cb:${name}:state`;
    this.openedAtKey = `cb:${name}:opened_at`;
    this.probeKey = `cb:${name}:half_open_probe`;
  }

  // Returns the breaker's current state as stored, defaulting to "closed" if untracked.
  async getState(): Promise<CircuitState> {
    const state = await this.store.get(this.stateKey);
    return (state as CircuitState) ?? "closed";
  }

  // Decides whether a request may go to this provider right now, transitioning open -> half-open when the cool-down has elapsed.
  async canRequest(): Promise<boolean> {
    const state = await this.getState();

    if (state === "closed") return true;

    if (state === "open") {
      const openedAt = Number((await this.store.get(this.openedAtKey)) ?? "0");
      if (this.options.now() - openedAt < this.options.openDurationMs) {
        return false;
      }
      await this.store.set(this.stateKey, "half_open");
      return this.acquireHalfOpenProbe();
    }

    // state === "half_open": only one probe request is allowed in flight at a time.
    return this.acquireHalfOpenProbe();
  }

  private async acquireHalfOpenProbe(): Promise<boolean> {
    return this.store.setNX(this.probeKey, "1", this.options.openDurationMs);
  }

  // Records a successful call; closes the circuit if this was the half-open probe, otherwise just leaves the failure window ticking.
  async recordSuccess(): Promise<void> {
    const state = await this.getState();
    if (state === "half_open") {
      await this.store.set(this.stateKey, "closed");
      await this.store.del(this.openedAtKey);
      await this.store.del(this.probeKey);
      await this.store.del(this.failuresKey);
    }
  }

  // Records a failed call; a half-open probe failure re-opens immediately, otherwise increments the rolling failure count and trips to open past the threshold.
  async recordFailure(): Promise<void> {
    const state = await this.getState();

    if (state === "half_open") {
      await this.store.set(this.stateKey, "open");
      await this.store.set(this.openedAtKey, String(this.options.now()));
      await this.store.del(this.probeKey);
      return;
    }

    const count = await this.store.incr(this.failuresKey);
    if (count === 1) {
      await this.store.expire(this.failuresKey, this.options.rollingWindowMs);
    }
    if (count >= this.options.failureThreshold) {
      await this.store.set(this.stateKey, "open");
      await this.store.set(this.openedAtKey, String(this.options.now()));
    }
  }
}
