// Express bootstrap: loads config, wires up available provider adapters, and mounts the /v1/chat route.
import "dotenv/config";
import express from "express";
import { pathToFileURL } from "node:url";
import { createChatRouter } from "./routes/chat.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { GroqAdapter } from "./providers/groq.js";
import type { ProviderAdapter } from "./types/index.js";

const PORT = Number(process.env.PORT ?? 3000);

// Builds and starts the Express app; separated from top-level code so tests can import it without binding a port.
export function createApp() {
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

  const app = express();
  app.use(express.json());

  app.use(createChatRouter(providers, { defaultProvider: process.env.DEFAULT_PROVIDER }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", providers: providers.map((p) => p.name) });
  });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Relay listening on port ${PORT}`);
  });
}
