// Express router for POST /v1/chat: normalizes the request, routes it to a provider, and streams the reply back as SSE.
import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { normalizeRequest } from "../normalizer/index.js";
import { selectProvider, type RouterConfig } from "../router/index.js";
import type { ProviderAdapter, RelayChatRequest } from "../types/index.js";

export function createChatRouter(providers: ProviderAdapter[], routerConfig: RouterConfig = {}): Router {
  const router = Router();

  router.post("/v1/chat", async (req: Request, res: Response) => {
    const requestId = uuidv4();
    let normalized;
    try {
      normalized = normalizeRequest(req.body as RelayChatRequest);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const provider = selectProvider(providers, normalized, routerConfig);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const startedAt = Date.now();
    try {
      for await (const chunk of provider.chat(normalized)) {
        if (chunk.done) {
          res.write("data: [DONE]\n\n");
          break;
        }
        res.write(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`);
      }
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
      res.write("data: [DONE]\n\n");
    } finally {
      console.log(
        JSON.stringify({
          request_id: requestId,
          timestamp: new Date().toISOString(),
          route_chosen: provider.name,
          latency_ms: Date.now() - startedAt,
        })
      );
      res.end();
    }
  });

  return router;
}
