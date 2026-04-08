const test = require("node:test");
const assert = require("node:assert/strict");

// test the internals via the module's own exports isn't possible since callOpenAI
// makes real HTTP calls, so we test the provider using mocked axios

const { mock } = require("node:test");

test("callOpenAI returns structured response on success", async (t) => {
  const axios = require("axios");
  t.mock.method(axios, "post", async () => ({
    data: {
      choices: [{ message: { content: "Hello from OpenAI" } }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
    }
  }));

  process.env.OPENAI_API_KEY = "test-key";
  // clear require cache to pick up env var
  delete require.cache[require.resolve("../src/config")];
  delete require.cache[require.resolve("../src/providers/openai")];
  const callOpenAI = require("../src/providers/openai");

  const result = await callOpenAI("say hello", "gpt-4o-mini");

  assert.equal(result.ok, true);
  assert.equal(result.output, "Hello from OpenAI");
  assert.equal(result.model, "gpt-4o-mini");
  assert.equal(result.usage.promptTokens, 10);
  assert.equal(result.usage.completionTokens, 20);
  assert.equal(result.usage.totalTokens, 30);
  assert.ok(result.cost >= 0);
  assert.ok(result.latency >= 0);
});

test("callOpenAI returns ok:false when API errors", async (t) => {
  const axios = require("axios");
  t.mock.method(axios, "post", async () => {
    throw new Error("rate limit exceeded");
  });

  process.env.OPENAI_API_KEY = "test-key";
  delete require.cache[require.resolve("../src/config")];
  delete require.cache[require.resolve("../src/providers/openai")];
  const callOpenAI = require("../src/providers/openai");

  const result = await callOpenAI("fail please", "gpt-4o-mini");

  assert.equal(result.ok, false);
  assert.equal(result.error, "rate limit exceeded");
  assert.equal(result.cost, 0);
});

test("callOpenAI throws when OPENAI_API_KEY is not set", async () => {
  delete process.env.OPENAI_API_KEY;
  delete require.cache[require.resolve("../src/config")];
  delete require.cache[require.resolve("../src/providers/openai")];
  const callOpenAI = require("../src/providers/openai");

  await assert.rejects(
    () => callOpenAI("test prompt"),
    /OPENAI_API_KEY is not configured/
  );
});

test("callOpenAI computes cost correctly for gpt-4o-mini", async (t) => {
  const axios = require("axios");
  t.mock.method(axios, "post", async () => ({
    data: {
      choices: [{ message: { content: "reply" } }],
      // 1M prompt tokens + 1M completion tokens
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 }
    }
  }));

  process.env.OPENAI_API_KEY = "test-key";
  delete require.cache[require.resolve("../src/config")];
  delete require.cache[require.resolve("../src/providers/openai")];
  const callOpenAI = require("../src/providers/openai");

  const result = await callOpenAI("cost test", "gpt-4o-mini");

  // gpt-4o-mini: $0.15/1M input + $0.60/1M output = $0.75
  assert.ok(result.ok);
  assert.ok(Math.abs(result.cost - 0.75) < 0.001);
});
