---
name: Provider adapter proposal
about: Propose adding a new LLM provider adapter
title: "[PROVIDER]"
labels: enhancement, provider
assignees: cp50

---

## Provider name

Which LLM provider should be added? (e.g. OpenAI, Anthropic, Mistral)

## Motivation

Why is this provider valuable for the gateway?

## API details

- API documentation link:
- Authentication method: (e.g. Bearer token, API key header)
- Chat completions endpoint:
- Supports streaming: (yes / no / unknown)

## Proposed adapter contract

Following the existing pattern in `src/providers/groq.js`:

- Input: `(prompt, model)`
- Output: `{ ok, output, model, cost, latency, usage }`

## Configuration

- Environment variable(s) needed: (e.g. `OPENAI_API_KEY`)
- Feature flag: (e.g. `ENABLE_OPENAI_PROVIDER=false`)

## Routing considerations

- Should this provider be enabled by default? (usually no)
- Which route types could it serve? (cheap_model / reasoning_model / both)

## Additional context

Any relevant links, pricing info, or rate limit details.
