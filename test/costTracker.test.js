const test = require("node:test");
const assert = require("node:assert/strict");
const logUsage = require("../src/costTracker");

test("logUsage aggregates totals", () => {
  logUsage.resetUsageTotals();

  logUsage({
    requestId: "r1",
    intent: "simple_question",
    route: "cheap_model",
    model: "gemini-2.5-flash",
    cost: 0.001,
    latency: 100,
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 }
  });

  logUsage({
    requestId: "r2",
    intent: "code_analysis",
    route: "reasoning_model",
    model: "groq-gpt-oss-20b",
    cost: 0.01,
    latency: 200,
    usage: { promptTokens: 30, completionTokens: 40, totalTokens: 70 }
  });

  const totals = logUsage.getUsageTotals();
  assert.equal(totals.requests, 2);
  assert.equal(totals.byRoute.cheap_model, 1);
  assert.equal(totals.byRoute.reasoning_model, 1);
  assert.equal(totals.totalLatencyMs, 300);
  assert.equal(totals.totalCost, 0.011);
});
