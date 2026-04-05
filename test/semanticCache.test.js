const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, resetRateLimits, resetCache } = require("../src/server");

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  return {
    status: res.status,
    headers: res.headers,
    body: await res.json()
  };
}

function fakeAuth(req, res, next) {
  req.tenant = { apiKey: "sk_test_semantic" };
  next();
}

const cheapModel = {
  async callCheapModel() {
    return {
      ok: true,
      output: "test response",
      model: "mock-cheap",
      cost: 0.001,
      latency: 5,
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 }
    };
  },
  async callReasoningModel() {
    return { ok: false };
  }
};

// fixed 4-dim vectors for predictable cosine similarity
const baseVec = [0.5, 0.5, 0.5, 0.5];
const similarVec = [0.51, 0.49, 0.51, 0.49]; // cos ~0.9998, well above 0.92 threshold
const differentVec = [0.0, 0.0, 1.0, 0.0];

test("semantic cache hit returns cached response", async () => {
  await resetRateLimits();
  await resetCache();

  let modelCalls = 0;
  const embeddings = new Map();
  embeddings.set("what is an API gateway", baseVec);
  embeddings.set("explain what an API gateway does", similarVec);

  const app = createApp({
    authenticateRequest: fakeAuth,
    embedText: async (text) => embeddings.get(text) || differentVec,
    modelCaller: {
      async callCheapModel() {
        modelCalls++;
        return cheapModel.callCheapModel();
      },
      async callReasoningModel() { return { ok: false }; }
    },
    intentDetector: async () => ({ intent: "simple_question", confidence: 0.99 })
  });

  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/ask`;

  try {
    // seed the cache
    const first = await postJson(url, { message: "what is an API gateway" });
    assert.equal(first.status, 200);
    assert.equal(first.body.cached, false);

    // different text but semantically similar embedding -> HIT-SEMANTIC
    const second = await postJson(url, { message: "explain what an API gateway does" });
    assert.equal(second.status, 200);
    assert.equal(second.body.cached, true);
    assert.equal(second.headers.get("x-cache"), "HIT-SEMANTIC");
    assert.equal(modelCalls, 1);
  } finally {
    await resetCache();
    await new Promise(resolve => server.close(resolve));
  }
});

test("embedding failure falls back gracefully", async () => {
  await resetRateLimits();
  await resetCache();

  let modelCalls = 0;

  const app = createApp({
    authenticateRequest: fakeAuth,
    embedText: async () => { throw new Error("embedding down"); },
    modelCaller: {
      async callCheapModel() {
        modelCalls++;
        return cheapModel.callCheapModel();
      },
      async callReasoningModel() { return { ok: false }; }
    },
    intentDetector: async () => ({ intent: "simple_question", confidence: 0.95 })
  });

  const server = app.listen(0);
  const port = server.address().port;

  try {
    const res = await postJson(`http://127.0.0.1:${port}/ask`, {
      message: "explain REST APIs"
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.cached, false);
    assert.equal(res.headers.get("x-cache"), "MISS");
    assert.equal(modelCalls, 1);
  } finally {
    await resetCache();
    await new Promise(resolve => server.close(resolve));
  }
});

test("below-threshold similarity falls through to model", async () => {
  await resetRateLimits();
  await resetCache();

  let modelCalls = 0;
  const embeddings = new Map();
  embeddings.set("how does http caching work", baseVec);
  embeddings.set("write a python fibonacci function", differentVec);

  const app = createApp({
    authenticateRequest: fakeAuth,
    embedText: async (text) => {
      const key = text.trim().replace(/\s+/g, " ").toLowerCase();
      return embeddings.get(key) || differentVec;
    },
    modelCaller: {
      async callCheapModel() {
        modelCalls++;
        return cheapModel.callCheapModel();
      },
      async callReasoningModel() { return { ok: false }; }
    },
    intentDetector: async () => ({ intent: "simple_question", confidence: 0.9 })
  });

  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/ask`;

  try {
    await postJson(url, { message: "how does HTTP caching work" });
    const res = await postJson(url, { message: "write a Python fibonacci function" });
    assert.equal(res.status, 200);
    assert.equal(res.body.cached, false);
    assert.equal(res.headers.get("x-cache"), "MISS");
    assert.equal(modelCalls, 2);
  } finally {
    await resetCache();
    await new Promise(resolve => server.close(resolve));
  }
});
