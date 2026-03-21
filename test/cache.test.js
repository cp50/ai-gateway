const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeMessage, getCacheKey } = require("../src/cache");

test("normalizeMessage lowercases and collapses whitespace", () => {
  assert.equal(normalizeMessage("  Hello    WORLD  "), "hello world");
});

test("getCacheKey builds stable keys for equivalent text", () => {
  const a = getCacheKey("How   are you?");
  const b = getCacheKey(" how are YOU? ");
  assert.equal(a, b);
});
