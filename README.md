# Relay

Relay is a gateway service that sits between client applications and multiple LLM providers (OpenAI, Groq, and more to come). It gives callers a single, stable API while handling provider routing, failover, and — eventually — semantic response caching, so client code never has to know which model actually served a request.

## Why

Teams that call more than one LLM provider end up re-solving the same problems: normalizing request/response shapes across APIs, handling a provider going down mid-traffic, and paying for redundant calls when users ask semantically the same question in different words. Relay centralizes all of that behind one endpoint.

## Features

- **Unified chat API** — `POST /v1/chat` accepts an OpenAI-style message array and streams a response back over SSE, regardless of which provider serves it.
- **Multi-provider support** — adapters for OpenAI and Groq behind a common interface (`ProviderAdapter`), so adding a new provider means writing one adapter, not touching the API surface.
- **Config-based routing** — a `DEFAULT_PROVIDER` preference with automatic ordering of the remaining providers as fallbacks.
- **Circuit breaker with automatic failover** — a Redis-backed `closed → open → half-open` state machine per provider. If a provider errors before it's written any output, Relay transparently retries the next one in the same request. Once a provider crosses its failure threshold, its breaker opens and later requests skip it entirely without wasting time on a doomed call.
- **True token-by-token streaming** — Server-Sent Events, including on the failover path, so the client never sees the plumbing switch providers mid-flight.

## Architecture

```
                 ┌─────────────────────┐
   client ──────▶│   Express API layer │  POST /v1/chat, SSE-capable
                 └─────────┬───────────┘
                           │
              ┌────────────▼─────────────┐
              │   Request Normalizer      │  unify request shape across providers
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │   Router                 │  orders candidate providers by config
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │   Circuit Breaker Layer   │  per-provider health state (Redis)
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │   Provider Adapters       │  OpenAI / Groq / ...
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │  Streaming Response (SSE) │──▶ client
              └───────────────────────────┘
```

Each provider adapter implements the same interface:

```ts
interface ProviderAdapter {
  name: string;
  chat(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
  healthCheck(): Promise<boolean>;
  estimateCost(request: NormalizedRequest): number;
}
```

Routing and cache-admission logic are kept in small, swappable modules on purpose — the intent is that today's simple config-based heuristics can later be replaced with policies learned from request logs, without touching the rest of the pipeline.

## Getting started

```bash
npm install
docker compose up -d redis   # circuit breaker state lives here
cp .env.example .env         # fill in OPENAI_API_KEY and/or GROQ_API_KEY (at least one required)
npm run dev
```

The server listens on `PORT` (default `3000`) and needs Redis reachable at `REDIS_URL` (default `redis://localhost:6379`).

### Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Enables the OpenAI adapter |
| `GROQ_API_KEY` | Enables the Groq adapter |
| `DEFAULT_PROVIDER` | Preferred provider (`openai` or `groq`) when more than one is configured |
| `REDIS_URL` | Redis connection string for circuit breaker state |
| `PORT` | HTTP port (default `3000`) |

At least one provider key must be set. `GET /health` reports which providers are active and each one's live circuit state.

## API

```
POST /v1/chat
Content-Type: application/json
Accept: text/event-stream

{
  "messages": [{ "role": "user", "content": "..." }],
  "model_hint": "fast" | "capable" | "cheap"
}
```

Response is an SSE stream of `data: {"delta": "..."}` chunks terminated by `data: [DONE]`. On failure, a `data: {"error": "..."}` frame is sent before `[DONE]`. If every candidate provider's circuit breaker is open, the request fails fast with `503` before any stream starts.

Example:

```bash
curl -N -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"messages":[{"role":"user","content":"Say hello in five words."}],"model_hint":"fast"}'
```

## How failover works

Each provider has its own circuit breaker with three states:

- **closed** — requests flow normally; failures are counted in a rolling window.
- **open** — tripped after enough failures in that window; requests skip this provider immediately for a cool-down period.
- **half-open** — after the cool-down, exactly one probe request is allowed through. Success closes the circuit and resets the failure count; failure re-opens it.

The router hands the chat route an ordered list of candidates (preferred provider first). If the first candidate fails before writing any output, the route silently tries the next one — the client just sees a slightly slower response, not an error. Once a provider's breaker opens, it's removed from the candidate list up front, so subsequent requests don't pay the cost of trying it at all.

## Testing

```bash
npm test
```

Unit tests cover the request normalizer, router ordering, and every circuit breaker state transition (against an in-memory store fake, so they run in milliseconds without a live Redis). An HTTP-level integration test (via supertest) drives the chat route end-to-end with fake providers to confirm failover actually happens at the routing layer, not just in the breaker's internal state.

CI (`.github/workflows/ci.yml`) runs typecheck, build, and the full test suite on every push.

## Roadmap

- **Semantic caching** — embed incoming requests, look up near-duplicates in pgvector, and serve cached responses for paraphrased (not just identical) queries, with a pluggable cache-admission policy instead of an "always cache" rule.
- **Structured observability** — a stable per-request log schema (latency, tokens, cache hit/miss, route chosen, circuit state) feeding Postgres and Langfuse.
- **Load testing** — real p50/p95/p99 latency numbers and measured cost/call reduction from caching, under a realistic query distribution.

## Tech Stack

TypeScript, Express, Redis, PostgreSQL + pgvector (planned), Docker, Vitest, GitHub Actions.
