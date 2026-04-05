const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeMessage, getCacheKey } = require("../src/cache");
const { cosineSimilarity } = require("../src/embeddingRouter");

test("normalizeMessage lowercases and collapses whitespace", () => {
  assert.equal(normalizeMessage("  Hello    WORLD  "), "hello world");
});

test("getCacheKey builds stable keys for equivalent text", () => {
  const a = getCacheKey("How   are you?");
  const b = getCacheKey(" how are YOU? ");
  assert.equal(a, b);
});

test("cosineSimilarity returns 1 for identical vectors", () => {
  const v = [1, 2, 3, 4];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 0.0001);
});

test("cosineSimilarity returns -1 for invalid input", () => {
  assert.equal(cosineSimilarity([], []), -1);
  assert.equal(cosineSimilarity([1], [1, 2]), -1);
  assert.equal(cosineSimilarity(null, [1]), -1);
});

test("cosineSimilarity handles orthogonal vectors", () => {
  const a = [1, 0];
  const b = [0, 1];
  assert.ok(Math.abs(cosineSimilarity(a, b)) < 0.0001);
});
