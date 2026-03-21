const assert = require("node:assert/strict");
const config = require("../src/config");
const { createApp, resetRateLimits } = require("../src/server");

const mockModelCaller = {
  async callCheapModel(message) {
    if (message.includes("force-fail")) {
      return {
        ok: false,
        output: "cheap failed",
        model: "mock-cheap",
        cost: 0,
        latency: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: "forced-failure"
      };
    }

    if (message.includes("uncertain")) {
      return {
        ok: true,
        output: "insufficient information to answer fully",
        model: "mock-cheap",
        cost: 0.001,
        latency: 5,
        usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 }
      };
    }

    return {
      ok: true,
      output: "Cheap model answer",
      model: "mock-cheap",
      cost: 0.001,
      latency: 5,
      usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 }
    };
  },
  async callReasoningModel(message) {
    if (message.includes("force-fail")) {
      return {
        ok: false,
        output: "reasoning failed",
        model: "mock-reasoning",
        cost: 0,
        latency: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: "forced-failure"
      };
    }

    return {
      ok: true,
      output: "Reasoning model answer",
      model: "mock-reasoning",
      cost: 0.01,
      latency: 12,
      usage: { promptTokens: 20, completionTokens: 30, totalTokens: 50 }
    };
  }
};

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  let body;
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  return { status: response.status, body };
}

async function run() {
  const originalRateLimit = { ...config.rateLimit };
  config.rateLimit.windowMs = 60_000;
  config.rateLimit.maxRequests = 100;
  await resetRateLimits();

  const app = createApp({
    authenticateRequest: (req, res, next) => {
      req.tenant = { apiKey: "sk_test_api_checks" };
      next();
    },
    modelCaller: mockModelCaller,
    intentDetector: async message => ({
      intent: message.includes("architecture") ? "architecture_review" : "simple_question",
      confidence: 0.99
    })
  });
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const invalid = await postJson(`${baseUrl}/ask`, { message: "" });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "INVALID_INPUT");

    const happy = await postJson(`${baseUrl}/ask`, { message: "Explain caching simply" });
    assert.equal(happy.status, 200);
    assert.equal(happy.body.route, "cheap_model");
    assert.equal(happy.body.model, "mock-cheap");

    const escalated = await postJson(`${baseUrl}/ask`, { message: "uncertain answer please" });
    assert.equal(escalated.status, 200);
    assert.equal(escalated.body.route, "reasoning_model");
    assert.equal(escalated.body.model, "mock-reasoning");

    const reasoningRoute = await postJson(`${baseUrl}/ask`, {
      message: "architecture review this system"
    });
    assert.equal(reasoningRoute.status, 200);
    assert.equal(reasoningRoute.body.route, "reasoning_model");

    const upstreamFail = await postJson(`${baseUrl}/ask`, { message: "force-fail now" });
    assert.equal(upstreamFail.status, 502);
    assert.equal(upstreamFail.body.code, "MODEL_UNAVAILABLE");

    config.rateLimit.maxRequests = 2;
    await resetRateLimits();
    const rateA = await postJson(`${baseUrl}/ask`, { message: "one" });
    const rateB = await postJson(`${baseUrl}/ask`, { message: "two" });
    const rateC = await postJson(`${baseUrl}/ask`, { message: "three" });
    assert.equal(rateA.status, 200);
    assert.equal(rateB.status, 200);
    assert.equal(rateC.status, 429);
    assert.equal(rateC.body.code, "RATE_LIMITED");

    console.log("API checks passed.");
  } finally {
    config.rateLimit.windowMs = originalRateLimit.windowMs;
    config.rateLimit.maxRequests = originalRateLimit.maxRequests;
    await resetRateLimits();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error("API checks failed:", error.message);
  process.exitCode = 1;
});

