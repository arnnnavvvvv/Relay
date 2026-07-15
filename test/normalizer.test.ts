// Unit tests for normalizeRequest: shape conversion and validation.
import { describe, it, expect } from "vitest";
import { normalizeRequest } from "../src/normalizer/index.js";

describe("normalizeRequest", () => {
  it("defaults model_hint to 'capable' when omitted", () => {
    const result = normalizeRequest({ messages: [{ role: "user", content: "hi" }] });
    expect(result.modelHint).toBe("capable");
    expect(result.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("preserves an explicit model_hint", () => {
    const result = normalizeRequest({
      messages: [{ role: "user", content: "hi" }],
      model_hint: "fast",
    });
    expect(result.modelHint).toBe("fast");
  });

  it("throws when messages is empty", () => {
    expect(() => normalizeRequest({ messages: [] })).toThrow();
  });

  it("throws when messages is missing", () => {
    expect(() => normalizeRequest({} as never)).toThrow();
  });
});
