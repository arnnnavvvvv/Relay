// Converts a raw client-facing RelayChatRequest into the internal NormalizedRequest shape used by providers.
import type { RelayChatRequest, NormalizedRequest } from "../types/index.js";

export function normalizeRequest(body: RelayChatRequest): NormalizedRequest {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("messages must be a non-empty array");
  }
  return {
    messages: body.messages,
    modelHint: body.model_hint ?? "capable",
  };
}
