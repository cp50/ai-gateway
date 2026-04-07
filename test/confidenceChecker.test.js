const test = require("node:test");
const assert = require("node:assert/strict");
const isLowConfidence = require("../src/confidenceChecker");
const { computeConfidence } = require("../src/confidenceChecker");

test("never escalates greetings", () => {
  assert.equal(isLowConfidence("short", "greeting"), false);
  assert.equal(computeConfidence("hi there", "greeting"), 1.0);
});

test("short response on complex intent scores low", () => {
  const score = computeConfidence("Looks good", "architecture_review");
  assert.ok(score < 0.6, `expected < 0.6, got ${score}`);
  assert.equal(isLowConfidence("Looks good", "architecture_review"), true);
});

test("short response on code_analysis also escalates", () => {
  assert.equal(isLowConfidence("Looks fine", "code_analysis"), true);
});

test("detailed response on complex intent stays confident", () => {
  const long = "The architecture follows a layered approach with clear separation of concerns. " +
    "The service layer handles business logic while the repository pattern abstracts data access. " +
    "This is well-structured and follows SOLID principles throughout the codebase.";
  assert.equal(isLowConfidence(long, "architecture_review"), false);
  assert.ok(computeConfidence(long, "architecture_review") >= 0.6);
});

test("uncertainty phrases reduce score", () => {
  const text = "I'm not sure about this, it depends on your requirements.";
  const score = computeConfidence(text, "general");
  assert.ok(score < 1.0, `expected < 1.0, got ${score}`);
  assert.ok(score < 0.6, `phrases should push below threshold, got ${score}`);
});

test("single mild uncertainty keeps score above threshold", () => {
  const text = "It depends on the specific use case, but generally you should use a message queue for async communication between services. Here is a detailed breakdown of the options available.";
  const score = computeConfidence(text, "general");
  assert.ok(score >= 0.6, `single mild phrase should stay above threshold, got ${score}`);
});

test("simple_question with short response is lenient", () => {
  const score = computeConfidence("42", "simple_question");
  assert.ok(score >= 0.6, `simple_question short answer should be ok, got ${score}`);
});

test("null/empty response on non-simple intent escalates", () => {
  assert.equal(isLowConfidence("", "general"), true);
  assert.equal(isLowConfidence(null, "general"), true);
});

test("stacked uncertainty phrases drop score hard", () => {
  const text = "I'm not sure and I cannot determine this. I do not have enough information.";
  const score = computeConfidence(text, "general");
  assert.ok(score < 0.2, `stacked phrases should tank score, got ${score}`);
});

test("score never goes below zero", () => {
  const text = "I'm not sure, cannot determine, unclear, as an ai I do not have enough information, it depends, I cannot, not enough context, hard to say";
  const score = computeConfidence(text, "code_analysis");
  assert.equal(score >= 0, true);
});
