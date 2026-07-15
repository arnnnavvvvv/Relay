// Integration test: forces provider A to fail repeatedly, verifies its circuit breaker opens, and that Relay automatically routes subsequent requests to healthy provider B.
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createChatRouter } from "../src/routes/chat.js";
import { CircuitBreaker } from "../src/circuit-breaker/index.js";
import { InMemoryCircuitBreakerStore } from "../src/circuit-breaker/memory-store.js";
import type { ProviderAdapter, NormalizedRequest, StreamChunk } from "../src/types/index.js";

function failingProvider(name: string): ProviderAdapter {
  return {
    name,
    async *chat(): AsyncGenerator<StreamChunk> {
      throw new Error(`${name} is down`);
    },
    async healthCheck() {
      return false;
    },
    estimateCost() {
      return 0;
    },
  };
}

function healthyProvider(name: string): ProviderAdapter {
  return {
    name,
    async *chat(_request: NormalizedRequest): AsyncGenerator<StreamChunk> {
      yield { delta: `hello from ${name}`, done: false };
      yield { delta: "", done: true };
    },
    async healthCheck() {
      return true;
    },
    estimateCost() {
      return 0;
    },
  };
}

function buildApp(providers: ProviderAdapter[], breakers: Map<string, CircuitBreaker>) {
  const app = express();
  app.use(express.json());
  app.use(createChatRouter(providers, breakers, { defaultProvider: "flaky" }));
  return app;
}

describe("automatic failover across providers", () => {
  let providers: ProviderAdapter[];
  let breakers: Map<string, CircuitBreaker>;
  let app: express.Express;

  beforeEach(() => {
    const store = new InMemoryCircuitBreakerStore();
    providers = [failingProvider("flaky"), healthyProvider("stable")];
    breakers = new Map(
      providers.map((p) => [p.name, new CircuitBreaker(store, p.name, { failureThreshold: 3, rollingWindowMs: 60_000, openDurationMs: 60_000 })])
    );
    app = buildApp(providers, breakers);
  });

  it("fails over to the healthy provider within a single request once the flaky one errors", async () => {
    const res = await request(app)
      .post("/v1/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.text).toContain("hello from stable");
    expect(await breakers.get("flaky")!.getState()).toBe("closed"); // one failure isn't enough to trip yet
  });

  it("opens the flaky provider's breaker after repeated failures and routes subsequent traffic straight to the healthy provider", async () => {
    // Each of these requests fails over to "stable" within-request, but still records a failure against "flaky".
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/v1/chat")
        .send({ messages: [{ role: "user", content: "hi" }] });
    }

    expect(await breakers.get("flaky")!.getState()).toBe("open");

    const res = await request(app)
      .post("/v1/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.text).toContain("hello from stable");
  });

  it("returns 503 when every candidate provider's breaker is open", async () => {
    const store = new InMemoryCircuitBreakerStore();
    const onlyFlaky = [failingProvider("flaky")];
    const onlyBreakers = new Map([
      ["flaky", new CircuitBreaker(store, "flaky", { failureThreshold: 1, rollingWindowMs: 60_000, openDurationMs: 60_000 })],
    ]);
    const soloApp = buildApp(onlyFlaky, onlyBreakers);

    await request(soloApp)
      .post("/v1/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(await onlyBreakers.get("flaky")!.getState()).toBe("open");

    const res = await request(soloApp)
      .post("/v1/chat")
      .send({ messages: [{ role: "user", content: "hi" }] });

    expect(res.status).toBe(503);
  });
});
