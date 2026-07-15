// Express bootstrap: loads config, connects Redis, wires up provider adapters and their circuit breakers, and mounts the /v1/chat route.
import "dotenv/config";
import express from "express";
import { createClient } from "redis";
import { pathToFileURL } from "node:url";
import { createChatRouter } from "./routes/chat.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { GroqAdapter } from "./providers/groq.js";
import { CircuitBreaker } from "./circuit-breaker/index.js";
import { RedisCircuitBreakerStore } from "./circuit-breaker/redis-store.js";
import type { ProviderAdapter } from "./types/index.js";

const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Builds and starts the Express app; separated from top-level code so tests can import it without binding a port or a real Redis connection.
export async function createApp() {
  const providers: ProviderAdapter[] = [];
  if (process.env.OPENAI_API_KEY) {
    providers.push(new OpenAIAdapter(process.env.OPENAI_API_KEY));
  }
  if (process.env.GROQ_API_KEY) {
    providers.push(new GroqAdapter(process.env.GROQ_API_KEY));
  }
  if (providers.length === 0) {
    throw new Error("no provider API keys set (need OPENAI_API_KEY and/or GROQ_API_KEY)");
  }

  const redisClient = createClient({ url: REDIS_URL });
  await redisClient.connect();
  const store = new RedisCircuitBreakerStore(redisClient);
  const breakers = new Map(providers.map((p) => [p.name, new CircuitBreaker(store, p.name)]));

  const app = express();
  app.use(express.json());

  app.use(createChatRouter(providers, breakers, { defaultProvider: process.env.DEFAULT_PROVIDER }));

  app.get("/health", async (_req, res) => {
    const states = await Promise.all(providers.map(async (p) => [p.name, await breakers.get(p.name)!.getState()]));
    res.json({ status: "ok", providers: providers.map((p) => p.name), circuit_state: Object.fromEntries(states) });
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp()
    .then((app) => {
      app.listen(PORT, () => {
        console.log(`Relay listening on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Failed to start Relay:", err);
      process.exit(1);
    });
}
