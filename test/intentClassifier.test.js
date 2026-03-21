const test = require("node:test");
const assert = require("node:assert/strict");
const detectIntent = require("../src/intentClassifier");

test("detectIntent identifies greeting and summary", () => {
  assert.equal(detectIntent("Hey there"), "greeting");
  assert.equal(detectIntent("Please summarize this"), "summarization");
});

test("detectIntent falls back to simple_question", () => {
  assert.equal(detectIntent("What is caching?"), "simple_question");
});
