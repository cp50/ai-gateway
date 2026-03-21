const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, resetRateLimits, resetCache } = require("../src/server");

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  return {
    status: response.status,
    headers: response.headers,
    body: await response.json()
  };
}

test("server caches repeated /ask requests", async () => {
  await resetRateLimits();
  await resetCache();

  const calls = { cheap: 0, reasoning: 0 };
  const app = createApp({
    authenticateRequest: (req, res, next) => {
      req.tenant = { apiKey: "sk_test_server_cache" };
      next();
    },
    modelCaller: {
      async callCheapModel() {
        calls.cheap += 1;
        return {
          ok: true,
          output: "Cached answer",
          model: "mock-cheap",
          cost: 0.001,
          latency: 5,
          usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
        };
      },
      async callReasoningModel() {
        calls.reasoning += 1;
        return {
          ok: true,
          output: "Reasoning answer",
          model: "mock-reasoning",
          cost: 0.01,
          latency: 10,
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      }
    },
    intentDetector: async () => ({ intent: "simple_question", confidence: 0.99 })
  });

  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/ask`;

  try {
    const first = await postJson(url, { message: "What is caching?" });
    const second = await postJson(url, { message: "  what   is CACHING?   " });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.body.cached, false);
    assert.equal(second.body.cached, true);
    assert.equal(first.headers.get("x-cache"), "MISS");
    assert.equal(second.headers.get("x-cache"), "HIT");
    assert.equal(calls.cheap, 1);
    assert.equal(calls.reasoning, 0);
  } finally {
    await resetCache();
    await new Promise(resolve => server.close(resolve));
  }
});

