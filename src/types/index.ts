// Shared type definitions for the request pipeline: normalized requests, stream chunks, and the provider adapter contract.

export type ModelHint = "fast" | "capable" | "cheap";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RelayChatRequest {
  messages: ChatMessage[];
  model_hint?: ModelHint;
  stream?: boolean;
}

export interface NormalizedRequest {
  messages: ChatMessage[];
  modelHint: ModelHint;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export interface ProviderAdapter {
  name: string;
  chat(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
  healthCheck(): Promise<boolean>;
  estimateCost(request: NormalizedRequest): number;
}
