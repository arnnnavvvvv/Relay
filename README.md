# Relay

A multi-provider LLM gateway with semantic caching, circuit-breaking, and streaming. See [AGENT.md](./agent.md) for the full design doc and build order — this README tracks what's *actually implemented* right now.

## Status (honest, updated per phase)

**Phase 1 — done and live-verified:** Express server, single `POST /v1/chat` endpoint, SSE streaming. Verified end-to-end against Groq's real API — real token-by-token deltas, terminated by `[DONE]`.

**Phase 2 — in progress:** second provider adapter (OpenAI) is written but not yet exercised against a live key in this environment (only Groq has been); routing is config-based only (`DEFAULT_PROVIDER` env var, falls back to the first configured provider) — not yet capability- or health-aware.

**Not yet built:** circuit breaker, semantic cache, structured logging to Postgres/Langfuse, load testing.

## Running locally

```bash
npm install
cp .env.example .env   # fill in OPENAI_API_KEY and/or GROQ_API_KEY (at least one required)
npm run dev
```

Server listens on `PORT` (default `3000`). `GET /health` reports which providers are configured. Set `DEFAULT_PROVIDER` (`openai` or `groq`) to prefer one when both keys are set.

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

CI runs lint (`tsc --noEmit`), build, and tests on every push via `.github/workflows/ci.yml`.

## Architecture

See AGENT.md §4 for the full request pipeline diagram and component descriptions.
