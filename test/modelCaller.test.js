const test = require("node:test");
const assert = require("node:assert/strict");
const { computeCostUSD, toUsage } = require("../src/modelCaller");

test("toUsage maps usageMetadata to stable token counts", () => {
  const usage = toUsage({
    promptTokenCount: 1000,
    candidatesTokenCount: 2000,
    totalTokenCount: 3000
  });

  assert.deepEqual(usage, {
    promptTokens: 1000,
    completionTokens: 2000,
    totalTokens: 3000
  });
});

test("computeCostUSD uses per-1M token pricing", () => {
  const cost = computeCostUSD(
    { promptTokens: 500_000, completionTokens: 250_000, totalTokens: 750_000 },
    { inputPer1M: 2, outputPer1M: 8 }
  );

  assert.equal(cost, 3);
});
