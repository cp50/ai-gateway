const test = require("node:test");
const assert = require("node:assert/strict");
const isLowConfidence = require("../src/confidenceChecker");

test("never escalates greetings", () => {
  assert.equal(isLowConfidence("short", "greeting"), false);
});

test("forces escalation for complex intents", () => {
  assert.equal(isLowConfidence("Looks good", "architecture_review"), true);
  assert.equal(isLowConfidence("Looks good", "code_analysis"), true);
});

test("flags uncertainty language", () => {
  assert.equal(
    isLowConfidence("I do not have enough information to answer.", "simple_question"),
    true
  );
});
