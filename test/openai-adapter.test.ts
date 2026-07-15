// Unit tests for OpenAIAdapter's pure logic (cost estimation) that doesn't require a live API call.
import { describe, it, expect } from "vitest";
import { OpenAIAdapter } from "../src/providers/openai.js";

describe("OpenAIAdapter.estimateCost", () => {
  const adapter = new OpenAIAdapter("test-key");

  it("returns a positive estimate proportional to message length", () => {
    const short = adapter.estimateCost({
      messages: [{ role: "user", content: "hi" }],
      modelHint: "fast",
    });
    const long = adapter.estimateCost({
      messages: [{ role: "user", content: "hi ".repeat(100) }],
      modelHint: "fast",
    });
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("estimates a higher cost for 'capable' than 'fast' on identical input", () => {
    const messages = [{ role: "user" as const, content: "same input" }];
    const fast = adapter.estimateCost({ messages, modelHint: "fast" });
    const capable = adapter.estimateCost({ messages, modelHint: "capable" });
    expect(capable).toBeGreaterThan(fast);
  });
});
