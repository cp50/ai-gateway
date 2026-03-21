const test = require("node:test");
const assert = require("node:assert/strict");
const routeIntent = require("../src/router");

test("routeIntent sends simple intents to cheap model", () => {
  assert.equal(routeIntent("greeting"), "cheap_model");
  assert.equal(routeIntent("simple_question"), "cheap_model");
  assert.equal(routeIntent("summarization"), "cheap_model");
});

test("routeIntent sends complex intents to reasoning model", () => {
  assert.equal(routeIntent("architecture_review"), "reasoning_model");
  assert.equal(routeIntent("code_analysis"), "reasoning_model");
});
