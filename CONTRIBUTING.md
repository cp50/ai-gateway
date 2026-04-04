# Contributing to AI Gateway

Thanks for your interest in contributing.

AI Gateway is an AI inference gateway / control plane, not a chatbot app.
That distinction matters when contributing: the most important parts of this
repo are routing correctness, resilience, observability, tenant safety, and
deployment stability.

We welcome contributions, but we prefer changes that are small, well-scoped,
and easy to review. Large or cross-cutting changes should be discussed before
implementation.

---

## What This Project Is

This project sits between applications and LLM providers and decides:
- how a request is classified
- which route to use
- which model/provider to call
- when to fail over
- how to track usage, quotas, cache, and health

Contributions should preserve that architecture-first mindset.

---

## Before You Start

For larger changes, please open or comment on an issue first.

This is especially important for changes that affect:
- routing policy
- provider enablement in the default runtime
- auth or quota logic
- cache or rate limiting architecture
- `/ask` response schema
- deployment defaults for the public demo

Small fixes, docs updates, and scoped tests usually do not need advance discussion.

---

## Ways to Contribute

Useful contribution types include:
- bug fixes
- docs improvements
- tests
- observability improvements
- UI/demo polish
- provider adapter additions
- deployment reliability improvements

Contributions that are especially helpful:
- regression tests for auth, quotas, and admin flows
- provider adapter tests
- readiness/health improvements
- contributor documentation

---

## Local Setup

1. Fork the repository
2. Clone your fork locally
3. Install dependencies:
   - `npm install`
4. Copy env template:
   - `cp .env.example .env`
5. Configure required keys locally
6. Start the app:
   - `npm start`
7. Run tests before opening a PR:
   - `npm test`
   - `npm run test:api`

---

## Good First Issues

These are good starting points for new contributors:
- provider adapter additions that do not change default runtime routing
- docs improvements
- test coverage improvements
- small UI/demo fixes
- safe observability improvements

Good first issues should avoid broad architecture changes.

---

## Changes That Need Discussion First

Please open an issue before implementing changes in these categories:
- changing default model routing behavior
- changing provider selection in the deployed demo
- adding paid providers to the default runtime path
- changing auth, quotas, or tenant behavior
- changing Redis/cache/rate-limit architecture
- changing `/ask` response fields or semantics
- changing deployment assumptions for the public demo

---

## Provider Adapter Guidelines

Provider adapters live in `src/providers/`.
Use `src/providers/groq.js` as the primary structural reference.

### Scope
A provider adapter PR should usually be limited to:
- the adapter file
- small config additions
- tests or docs directly related to that adapter

Do not combine a provider adapter PR with unrelated routing or deployment changes.

### Contract
Adapters should:
- accept `(prompt, model)` or match the established provider pattern used in the repo
- return a consistent result shape for successful execution:
  - `{ ok, output, model, cost, latency, usage }`
- keep dependencies light
- avoid importing application-layer logic into the adapter

### Failure handling
Expected provider/runtime failures should return a structured result:

`{ ok: false, error, model, latency, cost, usage }`

This includes:
- missing or optional API keys
- upstream API errors
- timeouts, rate limits, or network failures

Unexpected internal errors such as parsing bugs or invalid internal state may throw.

This distinction ensures:
- router-level failover remains consistent
- internal bugs are not silently masked

### Feature flags
Optional providers must be configuration-gated or feature-flagged.

Examples:
- `ENABLE_OPENAI_PROVIDER=false`
- `ENABLE_ANTHROPIC_PROVIDER=false`

Adapters can be added to the codebase without being enabled in routing or deployment.
Do not enable new providers by default.

### Deployment rule
Adding an adapter does **not** mean enabling that provider in the public demo or default deployment.
Optional providers must remain config-gated unless explicitly approved.

---

## Testing Expectations

If your change affects behavior, include or update tests.

Examples:
- auth changes -> add auth tests
- quota changes -> add quota tests
- provider changes -> add adapter/model caller tests
- startup/deployment changes -> add startup or integration coverage when practical

At minimum, contributors should run:
- `npm test`
- `npm run test:api`

If a change cannot be fully tested locally, explain that in the PR.

---

## Deployment and Security Rules

This repository has a public demo deployment, so deployment safety matters.

Please follow these rules:
- never commit `.env`
- never commit real API keys or secrets
- do not expose admin credentials in frontend code
- do not change demo defaults casually
- call out any deployment-impacting changes in the PR description
- do not assume new providers should be enabled in production/demo automatically

If your PR affects startup behavior, config, or public demo safety, mention it clearly.

---

## Things to Avoid

- do not change default routing behavior without discussion
- do not enable new providers in the public demo
- do not introduce breaking changes to `/ask` response format
- do not mix unrelated changes in a single PR
- do not add heavy dependencies without clear justification

---

## Pull Request Guidelines

Please keep PRs focused.

A strong PR should include:
- what changed
- why it changed
- which layer it affects
- how it was tested
- whether it affects deployment or public demo behavior
- screenshots, if the UI changed

Preferred style:
- one logical change per PR
- separate docs refactors from runtime changes when possible
- avoid unrelated cleanup in feature PRs

---

## Code Style

Project preferences:
- one responsibility per file
- defensive input handling for external data
- explicit, readable control flow
- avoid heavy abstractions unless they clearly simplify the codebase
- preserve existing architecture boundaries

When in doubt, favor clarity over cleverness.

---

## Communication

If anything is unclear, ask in the issue or PR thread before going deep on implementation.

That is especially helpful for:
- provider contributions
- routing changes
- deployment-related changes
- anything that touches the public demo

We would rather align early than untangle a large PR later.
