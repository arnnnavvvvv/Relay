# Relay

A multi-provider LLM gateway with semantic caching, circuit-breaking, and streaming. See [AGENT.md](./agent.md) for the full design doc and build order — this README tracks what's *actually implemented* right now.

## Status (honest, updated per phase)

**Phase 1 — done and live-verified:** Express server, single `POST /v1/chat` endpoint, SSE streaming. Verified end-to-end against Groq's real API — real token-by-token deltas, terminated by `[DONE]`.

**Phase 2 — done:** second provider adapter (OpenAI) written; config-based routing (`DEFAULT_PROVIDER` env var, falls back to the first configured provider) — not yet capability- or health-aware beyond circuit state (see Phase 3).

**Phase 3 — done and live-verified:** Redis-backed circuit breaker (`closed → open → half-open`) per provider. Automatic failover: if a provider errors before writing any output, Relay silently retries the next candidate within the same request; once a provider crosses the failure threshold its breaker opens and later requests skip it entirely without even attempting it. Verified against a real Redis container (`docker compose up -d redis`) — forced real OpenAI auth failures, watched `cb:openai:state` actually flip to `open` in Redis via `redis-cli`, confirmed `/health` reflects it and traffic kept flowing to Groq the whole time.

**Not yet built:** semantic cache, structured logging to Postgres/Langfuse, load testing.

## Running locally

```bash
npm install
docker compose up -d redis
cp .env.example .env   # fill in OPENAI_API_KEY and/or GROQ_API_KEY (at least one required)
npm run dev
```

Server listens on `PORT` (default `3000`) and requires Redis at `REDIS_URL` (default `redis://localhost:6379`) for circuit-breaker state. `GET /health` reports configured providers and each one's live circuit state. Set `DEFAULT_PROVIDER` (`openai` or `groq`) to prefer one when both keys are set.

### Try it

```bash
curl -N -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"messages":[{"role":"user","content":"Say hello in five words."}],"model_hint":"fast"}'
```

You should see a stream of `data: {"delta": "..."}` lines followed by `data: [DONE]`.

## Testing

```bash
npm test
```

CI runs lint (`tsc --noEmit`), build, and tests on every push via `.github/workflows/ci.yml`. Circuit breaker and failover tests run against an in-memory store fake, not a live Redis — they verify the state machine and routing logic deterministically and fast; the Redis wiring itself has been manually verified live (see Phase 3 status above) rather than covered by an automated Redis-backed test.

## Architecture

See AGENT.md §4 for the full request pipeline diagram and component descriptions.
