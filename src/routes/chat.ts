// Express router for POST /v1/chat: normalizes the request, routes it through circuit-breaker-aware failover, and streams the reply back as SSE.
import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { normalizeRequest } from "../normalizer/index.js";
import { orderProviders, type RouterConfig } from "../router/index.js";
import type { CircuitBreaker } from "../circuit-breaker/index.js";
import type { ProviderAdapter, RelayChatRequest } from "../types/index.js";

export function createChatRouter(
  providers: ProviderAdapter[],
  breakers: Map<string, CircuitBreaker>,
  routerConfig: RouterConfig = {}
): Router {
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

    const ordered = orderProviders(providers, normalized, routerConfig);
    const candidates: ProviderAdapter[] = [];
    for (const provider of ordered) {
      const breaker = breakers.get(provider.name);
      if (!breaker || (await breaker.canRequest())) {
        candidates.push(provider);
      }
    }

    if (candidates.length === 0) {
      res.status(503).json({ error: "all providers are currently circuit-broken (open)" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const startedAt = Date.now();
    let servedBy: string | null = null;

    for (const provider of candidates) {
      const breaker = breakers.get(provider.name);
      let firstChunkWritten = false;
      try {
        for await (const chunk of provider.chat(normalized)) {
          if (chunk.done) {
            res.write("data: [DONE]\n\n");
            break;
          }
          firstChunkWritten = true;
          res.write(`data: ${JSON.stringify({ delta: chunk.delta })}\n\n`);
        }
        await breaker?.recordSuccess();
        servedBy = provider.name;
        break;
      } catch (err) {
        await breaker?.recordFailure();
        if (firstChunkWritten) {
          // Already streamed partial output to the client — can't silently retry another provider mid-response.
          res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
          res.write("data: [DONE]\n\n");
          servedBy = provider.name;
          break;
        }
        // Nothing streamed yet: fail over silently to the next candidate.
      }
    }

    if (servedBy === null) {
      res.write(`data: ${JSON.stringify({ error: "all candidate providers failed" })}\n\n`);
      res.write("data: [DONE]\n\n");
    }

    console.log(
      JSON.stringify({
        request_id: requestId,
        timestamp: new Date().toISOString(),
        route_chosen: servedBy,
        latency_ms: Date.now() - startedAt,
      })
    );
    res.end();
  });

  return router;
}
