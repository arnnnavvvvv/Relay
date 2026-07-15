// Unit tests for orderProviders: config-based provider ordering and fallback behavior.
import { describe, it, expect } from "vitest";
import { orderProviders } from "../src/router/index.js";
import type { ProviderAdapter, NormalizedRequest } from "../src/types/index.js";

function fakeProvider(name: string): ProviderAdapter {
  return {
    name,
    async *chat() {
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

const request: NormalizedRequest = { messages: [{ role: "user", content: "hi" }], modelHint: "capable" };

describe("orderProviders", () => {
  it("keeps original order when no default is configured", () => {
    const providers = [fakeProvider("openai"), fakeProvider("groq")];
    expect(orderProviders(providers, request).map((p) => p.name)).toEqual(["openai", "groq"]);
  });

  it("moves the default provider to the front when configured", () => {
    const providers = [fakeProvider("openai"), fakeProvider("groq")];
    expect(orderProviders(providers, request, { defaultProvider: "groq" }).map((p) => p.name)).toEqual([
      "groq",
      "openai",
    ]);
  });

  it("keeps original order when defaultProvider doesn't match any adapter", () => {
    const providers = [fakeProvider("openai"), fakeProvider("groq")];
    expect(orderProviders(providers, request, { defaultProvider: "anthropic" }).map((p) => p.name)).toEqual([
      "openai",
      "groq",
    ]);
  });

  it("throws when no providers are configured", () => {
    expect(() => orderProviders([], request)).toThrow();
  });
});
