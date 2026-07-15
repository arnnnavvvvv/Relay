# AGENT.md — Relay

> A multi-provider LLM gateway with semantic caching, circuit-breaking, and streaming.
> This file is the single source of truth for any AI agent (or human) picking up implementation work on Relay. Read it fully before writing code.

---

## 1. What Relay Is

Relay is a **gateway service that sits between client applications and multiple LLM providers** (OpenAI, Anthropic, Groq, etc.). It gives a caller one stable API while it:

1. **Routes** each request to the best available provider/model based on cost, latency, capability, and current health.
2. **Caches** semantically similar requests to avoid redundant provider calls.
3. **Circuit-breaks** providers that are erroring or degraded, failing over automatically.
4. **Streams** responses back to the client over SSE regardless of which provider is serving the request.

Relay is not a chatbot and not a wrapper UI. It is infrastructure — a piece of backend systems engineering meant to demonstrate distributed-systems thinking (routing, caching, fault tolerance, observability) to engineering hiring managers, and to serve as the empirical substrate for academic research (see §7).

### Why it exists (dual purpose — keep both in mind at all times)
- **Portfolio keystone**: It's the single project capable of demonstrating the largest number of backend competencies at once (API design, caching strategy, distributed systems resilience patterns, observability, streaming protocols).
- **Capstone research substrate**: It is the live system underneath the capstone research direction *"Pattern-Mining-Driven Cache Admission and Routing for Multi-Provider LLM Gateways."* Cache admission and routing decisions in Relay should be built so that request logs can later be mined (FP-Growth, sequential pattern mining, co-location pattern mining) to replace naive heuristics with learned patterns. Don't build caching/routing so ad hoc that it can't be instrumented and studied later.
- **Infra backbone for GlintAI**: GlintAI (a separate capture/recall project) will call Relay for its LLM traffic rather than hitting providers directly. Relay's API should be generic enough to serve GlintAI's needs without GlintAI-specific hacks.

---

## 2. Non-Negotiable Constraints

- **No fabrication.** Every feature marked "done" in this doc or in commit messages must be real, tested, and runnable. Do not report a feature as working if it's only scaffolded. Do not invent benchmark numbers — if performance claims are needed (e.g., for a resume or capstone paper), they must come from actual load tests (LoadScope is available for this).
- **No LangChain.** Orchestration is hand-rolled or uses PydanticAI where agentic structure is needed. This is a deliberate stack decision, not a gap.
- **Observability is not optional.** Every provider call must be logged with enough structure (latency, tokens, cache hit/miss, route chosen, error/success) to support both operational debugging and later pattern-mining research. Langfuse is the target observability tool (current stack gap — see §9).
- **Testing is not optional.** Pytest + GitHub Actions is the target CI stack gap to close; if Relay ends up Node/TS instead, the equivalent is Vitest/Jest + GitHub Actions. Either way: CI must run on every push, and cache/routing/circuit-breaker logic needs unit tests before it needs polish.

---

## 3. Confirmed Tech Stack

*(Confirmed from the resume positioning for Relay. This is the stack any implementing agent should scaffold against — no substitutions without checking with Arnav first.)*

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Consistency with NoNet Pay, LoadScope |
| HTTP framework | **Express** | Confirmed stack choice — unified REST API surface |
| Primary datastore | **PostgreSQL** | System of record; also hosts pgvector |
| Vector similarity | **pgvector** (on Postgres) | Powers semantic cache lookups over equivalent queries |
| Cache / fast-path store | **Redis** | Circuit-breaker state, hot-path caching, rate/latency windows |
| Provider SDKs | **OpenAI API** (first provider), extensible to Anthropic/Groq | Avoid a heavy abstraction layer like LangChain |
| Containerization | **Docker** | Consistent with rest of portfolio |
| Streaming | **SSE (Server-Sent Events)** | Low-latency token delivery to clients |
| Testing | Jest or Vitest + GitHub Actions CI | Closes the identified CI/testing stack gap |
| Observability | Langfuse | Closes the identified observability stack gap |

**Division of labor between Postgres and Redis** (important — don't conflate them):
- **pgvector/Postgres** = semantic cache *content* (embeddings + cached responses), durable, queryable, and the source dataset for capstone pattern mining.
- **Redis** = ephemeral, fast-moving state — circuit-breaker health per provider, rolling error/latency windows, possibly a hot-key cache in front of Postgres for the most frequent lookups.

A clean split for the capstone: **Relay itself in TypeScript/Express**, with a **separate Python analysis pipeline** that consumes Relay's Postgres logs for the pattern-mining research (FP-Growth, sequential/co-location mining). Keep that boundary crisp — don't pull mining logic into the TS codebase.

---

## 4. Core Architecture

```
                 ┌─────────────────────┐
   client ──────▶│   Relay API Layer   │  (Express, unified REST API, SSE-capable)
                 └─────────┬───────────┘
                           │
              ┌────────────▼─────────────┐
              │   Request Normalizer      │  (unify request shape across providers)
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │  Semantic Cache Lookup    │──▶ cache hit ─▶ stream cached response
              └────────────┬─────────────┘
                           │ cache miss
              ┌────────────▼─────────────┐
              │   Router / Admission      │  (which provider+model, is cache-worthy?)
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │   Circuit Breaker Layer   │  (per-provider health state)
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │   Provider Adapters       │  (OpenAI / Anthropic / Groq / ...)
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │  Streaming Response (SSE) │──▶ client
              └────────────┬─────────────┘
                           │
              ┌────────────▼─────────────┐
              │   Logging / Observability │  (feeds Langfuse + capstone dataset)
              └───────────────────────────┘
```

### 4.1 Request Normalizer
Accepts a Relay-native request shape (OpenAI-compatible chat message format is a reasonable default since most clients already know it) and converts it into whatever shape each downstream provider needs. This is what lets Relay swap providers without the client knowing.

### 4.2 Semantic Cache
- Embed incoming requests (or a normalized key portion of them — system prompt + user turn) using a lightweight embedding model.
- Look up nearest neighbors in the vector store within a similarity threshold.
- On hit: return cached response, log as `cache_hit`, do not call a provider.
- On miss: proceed to routing, and after the provider responds, decide whether to **admit** the response into the cache.
- **Cache admission should not be "always cache everything."** This is precisely the problem the capstone tackles — build the admission decision as a pluggable function (`shouldAdmitToCache(request, response, metadata): boolean`) so a naive heuristic (e.g., admit if response is long/expensive) can later be swapped for a pattern-mined policy without rewriting the pipeline.

### 4.3 Router
Decides which provider/model to send a cache-missed request to. Inputs: requested capability (e.g., "needs function calling," "needs long context"), cost budget, current circuit-breaker health per provider, and optionally historical routing patterns (post-capstone). Keep routing logic in a single, swappable module — same reasoning as cache admission.

### 4.4 Circuit Breaker
Per-provider state machine: `closed` (healthy) → `open` (failing, route away) → `half-open` (probing recovery). Track error rate and latency over a rolling window. This is a well-known pattern (Netflix Hystrix-style) — implement it explicitly and testably, don't bury it inside provider adapter code.

### 4.5 Provider Adapters
One adapter per provider, implementing a common interface:
```ts
interface ProviderAdapter {
  name: string;
  chat(request: NormalizedRequest): AsyncGenerator<StreamChunk>;
  healthCheck(): Promise<boolean>;
  estimateCost(request: NormalizedRequest): number;
}
```

### 4.6 Streaming
All responses — cached or live — go back to the client as SSE, so the client's experience is uniform whether Relay served from cache or from a live provider call.

### 4.7 Logging / Observability
Every request produces a structured log record:
```json
{
  "request_id": "uuid",
  "timestamp": "iso8601",
  "route_chosen": "provider/model",
  "cache_hit": true,
  "latency_ms": 123,
  "tokens_in": 0,
  "tokens_out": 0,
  "cost_estimate": 0.0,
  "circuit_state_snapshot": { "openai": "closed", "anthropic": "half-open" },
  "admitted_to_cache": true
}
```
This log format **is the dataset** the capstone's pattern-mining work will run against. Do not change field names casually once research work has started against them.

---

## 5. What "Done" Looks Like (MVP Scope)

The MVP scope is defined directly by the resume claims Relay needs to substantiate. **Every bullet below must be true of the running system, not aspirational** — per the no-fabrication rule in §2, don't ship a resume line that the code doesn't back up.

### 5.1 Resume claim → required implementation (traceability)

| Resume claim | What must actually exist |
|---|---|
| "Unified REST API that lets applications integrate multiple AI providers through one interface" | ≥2 working provider adapters behind one Express endpoint contract (§8). A client swaps providers by config/param only, never by changing its request shape. |
| "Semantic caching over pgvector that serves cached responses for equivalent queries" | Real embedding step, real pgvector similarity query, a measurable, demonstrable cache-hit path returning a previously-computed response for a *paraphrased*, not identical, query. |
| "...to cut redundant provider calls and cost" | A load test (via LoadScope) comparing provider-call count and estimated cost with caching on vs. off, on a corpus containing semantically-repeated queries. The cost-reduction number must come from this test, not be asserted. |
| "Circuit-breaking failover across providers" | A real `closed → open → half-open` state machine (§4.4) with a test that forces a provider to fail and shows Relay routing subsequent traffic to a healthy provider automatically. |
| "Server-Sent Events streaming for low-latency token delivery" | Actual token-by-token SSE streaming end-to-end, including on cache hits (stream the cached response back incrementally, not as one blob — otherwise "low-latency token delivery" isn't true for the cached path). |

### 5.2 Build order

Ordered by priority — build top to bottom, don't skip ahead for polish:

1. **Express server**, single `/v1/chat` endpoint, SSE streaming, hitting **one** provider (OpenAI) — no caching, no routing yet. Prove the streaming plumbing works end to end, including cached-style incremental delivery, since that pattern gets reused for cache hits in step 4.
2. Add a **second provider adapter** + manual routing (config-based, not smart yet) — this is what makes "unified REST API... multiple providers" true rather than aspirational.
3. Add **circuit breaker** around provider calls (Redis-backed state), with unit tests forcing `closed → open → half-open` transitions and an integration test showing failover in action.
4. Add **semantic cache**: embedding step, pgvector similarity lookup, cache hit/miss path, naive admission policy (§4.2). Confirm hits work for *paraphrased*, not just identical, queries — that's the whole point of "semantic."
5. Add **structured logging** in the format at §4.7, wired to Postgres first, Langfuse second.
6. **Load test with LoadScope** to get real p50/p95/p99 numbers and real cache-hit-driven cost/call reduction numbers under realistic query distributions (include a meaningful fraction of near-duplicate queries — a corpus of all-unique queries will make caching look useless). These are the numbers that go on the resume — do not estimate them.
7. Write the GitHub repo, README, and this AGENT.md into the repo itself. Repo link is part of the resume bullet ("GitHub") — it needs to exist and be public/shareable before this project can be listed.

**Explicit non-goals for MVP:** auth/rate-limiting per API key, billing, a UI/dashboard, support for more than 2–3 providers. These can come later; don't let them block the core pipeline or the resume-claim traceability above.

---

## 6. Directory Structure (proposed)

```
relay/
├── AGENT.md                 # this file
├── README.md
├── docker-compose.yml
├── src/
│   ├── server.ts             # Express bootstrap
│   ├── routes/
│   │   └── chat.ts
│   ├── normalizer/
│   ├── cache/
│   │   ├── embed.ts
│   │   ├── lookup.ts
│   │   └── admission.ts      # pluggable admission policy
│   ├── router/
│   │   └── index.ts          # pluggable routing policy
│   ├── circuit-breaker/
│   ├── providers/
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── groq.ts
│   ├── logging/
│   │   └── record.ts
│   └── types/
├── test/
└── .github/workflows/ci.yml
```

---

## 7. Capstone Research Hooks

The capstone treats Relay's request logs as event sequences to mine for patterns (FP-Growth for frequent itemsets, sequential pattern mining for request-order patterns, co-location mining for provider/route associations). For this to work later, implementation must:

- Log every request with a stable, consistent schema (§4.7) from day one — retroactively reconstructing this from incomplete logs is a research-blocking mistake.
- Keep cache admission and routing as **swappable strategy functions**, not inlined logic, so a pattern-mined policy can be dropped in and A/B compared against the naive baseline.
- Preserve raw (or embedding-reduced) request logs long enough to build a meaningful dataset before the first capstone review (Aug 18–22). Even a few weeks of real or synthetic traffic is more useful than none.

Anyone implementing Relay should treat the logging layer as equally important as the routing/caching logic itself — it's not an afterthought, it's the research deliverable's raw material.

---

## 8. API Contract (draft)

```
POST /v1/chat
Content-Type: application/json
Accept: text/event-stream

{
  "messages": [{ "role": "user", "content": "..." }],
  "model_hint": "fast" | "capable" | "cheap",   // abstract capability request, not a raw model name
  "stream": true
}
```

Response: SSE stream of `data: {"delta": "..."}` chunks, terminated by `data: [DONE]`. Mirrors the OpenAI streaming convention since it's the most widely understood by client tooling.

**Express SSE note:** Express doesn't have built-in SSE helpers like Fastify does — the implementing agent needs to manually set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, disable response buffering/compression on that route, and flush chunks explicitly (`res.write(...)`, no `res.end()` until the stream closes). This is a common source of "streaming that actually buffers and arrives all at once" bugs — test it with a slow/throttled client, not just curl on localhost.

---

## 9. Known Stack Gaps to Close While Building This

These are deliberate, named gaps in Arnav's current stack — Relay is a good vehicle to close them, in this priority order:

1. **Pytest + GitHub Actions** (or Vitest/Jest equivalent if Relay stays TS) — CI must exist from the first commit, not bolted on later.
2. **Langfuse observability** — wire it in once the logging format (§4.7) is stable.
3. **PydanticAI agent orchestration** — only relevant if/when Relay grows an agentic routing layer (e.g., an LLM deciding routing rather than heuristics); don't force it in prematurely.

Do not reach for LangChain to shortcut any of the above.

---

## 10. Conventions for Any Agent Implementing This

- No fabricated metrics, no "TODO: fake this for now" left in place of real integration — if something isn't built, say so plainly rather than stubbing it silently.
- Favor small, swappable modules (cache admission, routing) over clever monoliths — this is a structural requirement for the capstone, not just good practice.
- Every provider integration needs a real health check and real error handling, not a happy-path-only implementation.
- Commit early and often with a real GitHub repo — none currently exists; creating it is one of the first implementation tasks.
- When in doubt about a design decision (embedding model choice, cache TTL, similarity threshold), pick a reasonable default, document the choice and reasoning in code comments or the README, and move forward rather than blocking on it.