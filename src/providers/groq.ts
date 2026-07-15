// Groq provider adapter: implements ProviderAdapter via Groq's OpenAI-compatible chat completions API.
import OpenAI from "openai";
import type { NormalizedRequest, ProviderAdapter, StreamChunk, ModelHint } from "../types/index.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const MODEL_BY_HINT: Record<ModelHint, string> = {
  fast: "llama-3.1-8b-instant",
  capable: "llama-3.3-70b-versatile",
  cheap: "llama-3.1-8b-instant",
};

// Rough per-1K-token USD prices, used only for coarse cost estimation (not billing).
const PRICE_PER_1K_TOKENS: Record<ModelHint, number> = {
  fast: 0.00005,
  capable: 0.00059,
  cheap: 0.00005,
};

export class GroqAdapter implements ProviderAdapter {
  name = "groq";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey, baseURL: GROQ_BASE_URL });
  }

  // Streams a chat completion from Groq, yielding one StreamChunk per delta received.
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

  // Confirms the Groq API is reachable and the configured key is valid by listing models.
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
