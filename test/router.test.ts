// Unit tests for selectProvider: config-based provider selection and fallback behavior.
import { describe, it, expect } from "vitest";
import { selectProvider } from "../src/router/index.js";
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

describe("selectProvider", () => {
  it("returns the first provider when no default is configured", () => {
    const providers = [fakeProvider("openai"), fakeProvider("groq")];
    expect(selectProvider(providers, request).name).toBe("openai");
  });

  it("returns the provider matching defaultProvider when configured", () => {
    const providers = [fakeProvider("openai"), fakeProvider("groq")];
    expect(selectProvider(providers, request, { defaultProvider: "groq" }).name).toBe("groq");
  });

  it("falls back to the first provider when defaultProvider doesn't match any adapter", () => {
    const providers = [fakeProvider("openai"), fakeProvider("groq")];
    expect(selectProvider(providers, request, { defaultProvider: "anthropic" }).name).toBe("openai");
  });

  it("throws when no providers are configured", () => {
    expect(() => selectProvider([], request)).toThrow();
  });
});
