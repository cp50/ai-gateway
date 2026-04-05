![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)
![Open Source](https://img.shields.io/badge/Open%20Source-yes-brightgreen.svg)

# AI Gateway - Intelligent LLM Routing Infrastructure

An AI inference gateway that sits between applications and LLM
providers, intelligently routing each request to the most
appropriate model based on intent, cost, and real-time provider
health.

This is not a chatbot. It is infrastructure: a control plane
for AI model access.

> Like a load balancer for web servers, but instead of balancing
> by server load, it routes by request intent, model cost, and
> live provider health signals.

**Live demo:** https://yummy-albertina-chrisp04-b2a2897d.koyeb.app/ask

---

## The Problem It Solves

When you integrate a single LLM into a product, three things
usually happen:

- Costs rise because simple and complex requests hit the same model
- One provider outage can degrade the whole product
- There is little visibility into latency, usage, cache behavior,
  or tenant consumption

This gateway addresses all three.

---

## How It Works - Request Pipeline

Each request moves through a layered pipeline before a response
is returned:

```text
Client Request
      v
Rate Limiting          (Redis - abuse prevention)
      v
Tenant Authentication  (API key -> tenant object)
      v
Quota Enforcement      (requests / tokens / cost per day)
      v
Cache Lookup           (Redis - skip everything below on hit)
      v
Intent Detection       (embedding similarity -> intent class)
      v
LLM Fallback           (if embedding confidence is low)
      v
Route Decision         (cheap_model or reasoning_model)
      v
Health-Aware Selection (live latency + failure scoring)
      v
Model Execution        (Groq primary -> Gemini fallback)
      v
Confidence Escalation  (upgrade cheap -> reasoning if weak)
      v
Usage + Cost Logging   (per-request + per-tenant accounting)
      v
Cache Write            (store for future identical requests)
      v
Response               (intent | route | model | latency | cost)
```

---

## Routing In Action

The system classifies intent and routes accordingly.

**Simple question -> cheap model**

```text
Prompt:   "What is an API?"
Intent:   simple_question
Route:    cheap_model
Model:    llama-3.3-70b-versatile (Groq)
Latency:  1312 ms
Cost:     0
Cache:    MISS
Failover: none
```

**Complex request -> reasoning model**

```text
Prompt:   "Design a scalable chat system"
Intent:   architecture_review
Route:    reasoning_model
Model:    openai/gpt-oss-120b (Groq)
Latency:  6421 ms
Cost:     0
Cache:    MISS
Failover: none
```

Same gateway. Different routing decisions based on what
was asked.

---

## Key Features

**Intelligent routing**
Embedding-based intent classification using cosine similarity
against prewarmed example vectors. Intent classes include:
`greeting`, `summarization`, `architecture_review`,
`code_analysis`, and `simple_question`. When embedding confidence
is low, the system falls back to an LLM classifier.

**Health-aware model selection**
Each model is tracked by request count, failure count, and
average latency using Welford's online algorithm for a running
mean. Health score is computed from failure count and latency,
and the router switches models only when the score gap crosses a
route-specific threshold. Reasoning routes are intentionally much
less eager to switch than cheap routes.

**Three-layer resilience**
1. Proactive: health scoring deprioritizes degrading models
2. Reactive: automatic provider failover on network, timeout,
   and server-side failures
3. Post-response: confidence escalation upgrades weak cheap-model
   answers to the reasoning path

**Multi-tenant access control**
Per-tenant API keys with cryptographically secure generation.
Daily quotas on requests, tokens, and cost. Daily reset is lazy:
counters reset on the next tenant read after 24 hours, without a
cron job.

**Redis with interface-compatible fallback**
When Redis is unavailable, the app falls back to an in-memory
implementation that preserves the same calling interface for
rate limiting, caching, and metrics. This is useful for local
continuity and degraded-mode demo behavior, but it is not a full
replacement for shared Redis across multiple instances.

**Full observability**
Admin routes expose total requests, cache hit rate, failover
rate, average latency, per-model health scores, and per-tenant
usage. System metrics are persisted in Redis so they survive
restarts when Redis is available.

---

## Architecture

```text
src/
|-- providers/
|   |-- groq.js              # Provider adapter - isolates Groq HTTP details
|-- server.js                # Orchestration - request pipeline and endpoint wiring
|-- router.js                # Route decision + health-aware model selection
|-- embeddingRouter.js       # Intent detection - embeddings + LLM fallback
|-- modelCaller.js           # Model execution - failover logic and reasoning prompt shaping
|-- confidenceChecker.js     # Post-response quality gate
|-- metricsStore.js          # Per-model health tracking - running latency mean
|-- tenantStore.js           # Tenant lifecycle - persistence, quotas, lazy daily reset
|-- cache.js                 # Response caching - normalized keys and TTL
|-- redisClient.js           # Redis wrapper + in-memory fallback
|-- systemMetrics.js         # System telemetry - request/cache/failover counters
|-- costTracker.js           # Per-request usage logging
|-- authMiddleware.js        # Bearer token -> tenant lookup
|-- adminMiddleware.js       # Admin auth
|-- quotaMiddleware.js       # Quota enforcement before AI execution
|-- config.js                # Environment-driven configuration
|-- intentClassifier.js      # Legacy keyword classifier (not on the primary runtime path)
```

---

## Notable Design Decisions

**Lazy daily quota reset**
Instead of a cron job at midnight, tenant counters reset on the
next request after 24 hours elapse. No background worker is
required.

**Fire-and-forget telemetry**
System metric writes are triggered without awaiting Redis in the
main request path. Telemetry stays best-effort, while request
latency remains the priority.

**Welford's online algorithm**
Average model latency is updated with Welford's incremental mean
formula in O(1) space. There is no need to store historical
latency arrays in memory.

**Transparent dependency boundaries**
Provider adapters, tenant storage, routing policy, and metrics
are separated cleanly enough that the main server pipeline stays
readable and testable.

**Dependency injection for testability**
`createApp(overrides)` allows test code to inject mock model
callers, auth middleware, and intent detectors. That keeps tests
fast and independent of real provider APIs.

---

## Known Limitations

This is a well-architected MVP, not a hardened production SaaS.

- `confidenceChecker.js` is heuristic-based
- `costTracker.js` aggregates are in-memory and reset on restart
- Groq pricing may be `0` unless pricing config is populated
- Admin auth is shared-key based, which is not ideal for
  multi-admin teams
- In-memory Redis fallback is process-local and should not be
  treated as equivalent to shared Redis in a horizontally scaled
  deployment

---

## Local Setup

**Prerequisites:** Node.js 18+, Redis optional

```bash
npm install
```

Copy and configure environment:

```bash
cp .env.example .env
```

Set at minimum:
- `GOOGLE_API_KEY`
- `GROQ_API_KEY`
- `ADMIN_API_KEY`

Create a demo tenant:

```bash
node scripts/createTenant.js "demo-user"
```

Start the app:

```bash
npm start
```

Open:
- `http://localhost:3000/ask`
- `http://localhost:3000/health`

---

## Health Endpoint

```
GET /health
```

Returns a JSON response indicating that the server process is running:

```json
{
  "status": "ok",
  "uptime": 1234.56
}
```

**This is a liveness check**, not a readiness check. It confirms that the
Node.js process is alive and can accept HTTP connections. It does **not**
verify the availability of downstream dependencies such as Redis, Groq,
or Gemini.

**Liveness vs readiness:**

| Check      | What it answers                                      | This endpoint |
|------------|------------------------------------------------------|---------------|
| Liveness   | Is the process running and responding to HTTP?       | Yes           |
| Readiness  | Are downstream dependencies (Redis, providers) healthy? | No         |

Readiness checks for Redis connectivity and provider health are not
currently exposed through a dedicated endpoint. Provider health is
tracked internally by the routing layer (`metricsStore.js`) and is
visible through the authenticated `GET /admin/metrics` endpoint.

If you are configuring health checks for a deployment platform
(e.g. Koyeb, Kubernetes), use `/health` as the liveness probe.
Do not rely on it to gate traffic readiness.

---

## Deployment - Koyeb + Upstash

The live demo runs on Koyeb (Frankfurt) with Upstash Redis (Mumbai).
Both have free tiers, no credit card required.

### 1. Set up Redis on Upstash

1. Create a free account at [upstash.com](https://upstash.com)
2. Create a new Redis database (any region works, the demo uses `ap-south-1`)
3. Copy the Redis URL from the database details page — it looks like
   `rediss://default:xxx@region.upstash.io:6379`

### 2. Deploy to Koyeb

1. Create a free account at [koyeb.com](https://koyeb.com)
2. Create a new Web Service and connect your GitHub repo (or fork)
3. Set the build and run commands:
   - **Build:** `npm install`
   - **Run:** `node src/server.js`
4. Set the region to Frankfurt (or whichever you prefer)
5. Add environment variables:

```text
GOOGLE_API_KEY=
GROQ_API_KEY=
REDIS_URL=rediss://default:xxx@region.upstash.io:6379
ADMIN_API_KEY=
DEMO_MODE=true
DEMO_TENANT_API_KEY=
PORT=8000
```

Note: Koyeb exposes port `8000` by default. Set `PORT=8000` or configure
the port in your Koyeb service settings.

6. Set the health check path to `/health`
7. Deploy

### 3. Seed the demo tenant

Once the service is running, open the Koyeb console shell (or run locally
against the same Redis) and run:

```bash
node scripts/createTenant.js "demo"
```

Use the output key as `DEMO_TENANT_API_KEY` in your Koyeb env vars and
redeploy.

### Demo safety

- keep `DEMO_MODE=true`
- use one shared demo tenant key
- keep quotas low on the demo tenant
- keep `/tenant` and `/admin` private
- do not expose the admin key in the browser

---

## Testing

```bash
npm test
npm run test:api
```

The project uses the built-in Node.js test runner.

Current tests cover modules such as:
- cache behavior
- confidence checking
- cost tracking
- embedding routing
- model calling
- routing logic
- server pipeline behavior

---

## Tech Stack

Node.js | Express | Redis | Groq API | Google Gemini API |
Google Embedding API | Node.js test runner

---

## What This Is Not

This is not a wrapper around one LLM API.
This is not a chatbot.
This is not a prompt-engineering demo.

It is infrastructure. The value is in the routing intelligence,
the resilience layers, the tenant controls, and the
observability - not in the generated text alone.
