// OpenAI provider adapter: implements ProviderAdapter by wrapping the official OpenAI SDK's streaming chat API.
import OpenAI from "openai";
import type { NormalizedRequest, ProviderAdapter, StreamChunk, ModelHint } from "../types/index.js";

const MODEL_BY_HINT: Record<ModelHint, string> = {
  fast: "gpt-4o-mini",
  capable: "gpt-4o",
  cheap: "gpt-4o-mini",
};

// Rough per-1K-token USD prices, used only for coarse cost estimation (not billing).
const PRICE_PER_1K_TOKENS: Record<ModelHint, number> = {
  fast: 0.00015,
  capable: 0.0025,
  cheap: 0.00015,
};

export class OpenAIAdapter implements ProviderAdapter {
  name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  // Streams a chat completion from OpenAI, yielding one StreamChunk per delta received.
  async *chat(request: NormalizedRequest): AsyncGenerator<StreamChunk> {
    const model = MODEL_BY_HINT[request.modelHint];
    const stream = await this.client.chat.completions.create({
      model,
      messages: request.messages,
      stream: true,
    });

    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content ?? "";
      if (delta) {
        yield { delta, done: false };
      }
    }
    yield { delta: "", done: true };
  }

  // Confirms the OpenAI API is reachable and the configured key is valid by listing models.
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  // Estimates request cost from a rough character-to-token ratio; not a substitute for provider-reported usage.
  estimateCost(request: NormalizedRequest): number {
    const totalChars = request.messages.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = totalChars / 4;
    return (estimatedTokens / 1000) * PRICE_PER_1K_TOKENS[request.modelHint];
  }
}
