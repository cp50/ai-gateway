const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, resetRateLimits, resetCache } = require("../src/server");

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return { status: res.status, body: await res.json() };
}

function makeApp(cheapOutput, reasoningOutput) {
  const calls = { cheap: 0, reasoning: 0 };

  const app = createApp({
    authenticateRequest: (req, _res, next) => {
      req.tenant = { apiKey: "sk_test_escalation" };
      next();
    },
    modelCaller: {
      async callCheapModel() {
        calls.cheap += 1;
        return {
          ok: true,
          output: cheapOutput,
          model: "mock-cheap",
          cost: 0,
          latency: 5,
          usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 }
        };
      },
      async callReasoningModel() {
        calls.reasoning += 1;
        return {
          ok: true,
          output: reasoningOutput,
          model: "mock-reasoning",
          cost: 0.01,
          latency: 50,
          usage: { promptTokens: 20, completionTokens: 40, totalTokens: 60 }
        };
      }
    },
    intentDetector: async () => ({ intent: "simple_question", confidence: 0.95 }),
    embedText: async () => [0, 0, 0]
  });

  return { app, calls };
}

test("cheap model low-confidence response triggers escalation to reasoning", async () => {
  await resetRateLimits();
  await resetCache();

  // "I'm not sure" + short = low score, triggers escalation
  const { app, calls } = makeApp(
    "I'm not sure, it depends on your setup.",
    "Here is a detailed answer covering the main scenarios and trade-offs involved."
  );

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await postJson(`http://127.0.0.1:${port}/ask`, {
      message: "How should I structure my database?"
    });

    assert.equal(res.status, 200);
    assert.equal(calls.cheap, 1, "cheap model should be called first");
    assert.equal(calls.reasoning, 1, "reasoning model should be called after low confidence");
    assert.equal(res.body.route, "reasoning_model");
    assert.equal(res.body.model, "mock-reasoning");
  } finally {
    await resetCache();
    await new Promise(resolve => server.close(resolve));
  }
});

test("cheap model confident response skips escalation", async () => {
  await resetRateLimits();
  await resetCache();

  const { app, calls } = makeApp(
    "A relational database like PostgreSQL works well for structured data with relationships between tables. Use normalized schemas for transactional workloads.",
    "This should not be reached."
  );

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await postJson(`http://127.0.0.1:${port}/ask`, {
      message: "What database should I use?"
    });

    assert.equal(res.status, 200);
    assert.equal(calls.cheap, 1);
    assert.equal(calls.reasoning, 0, "reasoning should not be called for confident response");
    assert.equal(res.body.route, "cheap_model");
    assert.equal(res.body.model, "mock-cheap");
  } finally {
    await resetCache();
    await new Promise(resolve => server.close(resolve));
  }
});
