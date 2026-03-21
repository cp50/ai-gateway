const test = require("node:test");
const assert = require("node:assert/strict");
const { cosineSimilarity } = require("../src/embeddingRouter");

test("cosineSimilarity returns 1 for identical vectors", () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test("cosineSimilarity returns -1 for invalid vectors", () => {
  assert.equal(cosineSimilarity([1, 2], [1]), -1);
});
