// Unit tests forcing CircuitBreaker through closed -> open -> half-open -> closed/open transitions, using an in-memory store and a controllable clock.
import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker/index.js";
import { InMemoryCircuitBreakerStore } from "../src/circuit-breaker/memory-store.js";

function makeBreaker(clock: { now: number }) {
  const store = new InMemoryCircuitBreakerStore(() => clock.now);
  return new CircuitBreaker(store, "test-provider", {
    failureThreshold: 3,
    rollingWindowMs: 10_000,
    openDurationMs: 5_000,
    now: () => clock.now,
  });
}

describe("CircuitBreaker", () => {
  let clock: { now: number };

  beforeEach(() => {
    clock = { now: 1_000_000 };
  });

  it("starts closed and allows requests", async () => {
    const breaker = makeBreaker(clock);
    expect(await breaker.getState()).toBe("closed");
    expect(await breaker.canRequest()).toBe(true);
  });

  it("trips to open after reaching the failure threshold", async () => {
    const breaker = makeBreaker(clock);
    await breaker.recordFailure();
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe("closed");
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe("open");
    expect(await breaker.canRequest()).toBe(false);
  });

  it("stays open until openDurationMs elapses, then allows exactly one half-open probe", async () => {
    const breaker = makeBreaker(clock);
    await breaker.recordFailure();
    await breaker.recordFailure();
    await breaker.recordFailure();
    expect(await breaker.canRequest()).toBe(false);

    clock.now += 4_000; // still within the open cool-down
    expect(await breaker.canRequest()).toBe(false);

    clock.now += 2_000; // now past openDurationMs (5s total)
    expect(await breaker.canRequest()).toBe(true);
    expect(await breaker.getState()).toBe("half_open");

    // A second concurrent probe attempt is blocked while one is in flight.
    expect(await breaker.canRequest()).toBe(false);
  });

  it("closes on a successful half-open probe and resets the failure count", async () => {
    const breaker = makeBreaker(clock);
    await breaker.recordFailure();
    await breaker.recordFailure();
    await breaker.recordFailure();
    clock.now += 5_000;
    expect(await breaker.canRequest()).toBe(true); // enters half-open, consumes the probe slot

    await breaker.recordSuccess();
    expect(await breaker.getState()).toBe("closed");
    expect(await breaker.canRequest()).toBe(true);
  });

  it("re-opens immediately on a failed half-open probe", async () => {
    const breaker = makeBreaker(clock);
    await breaker.recordFailure();
    await breaker.recordFailure();
    await breaker.recordFailure();
    clock.now += 5_000;
    expect(await breaker.canRequest()).toBe(true); // half-open probe

    await breaker.recordFailure();
    expect(await breaker.getState()).toBe("open");
    expect(await breaker.canRequest()).toBe(false);
  });

  it("does not trip if failures don't reach the threshold within the rolling window", async () => {
    const breaker = makeBreaker(clock);
    await breaker.recordFailure();
    clock.now += 11_000; // past rollingWindowMs, failure count should have expired
    await breaker.recordFailure();
    expect(await breaker.getState()).toBe("closed");
  });
});
