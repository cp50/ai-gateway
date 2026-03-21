const test = require("node:test");
const assert = require("node:assert/strict");
const { validateMessage } = require("../src/server");

test("validateMessage rejects invalid input", () => {
  assert.equal(validateMessage(""), "Message must be a non-empty string");
  assert.equal(validateMessage("   "), "Message must be a non-empty string");
  assert.equal(validateMessage(null), "Message must be a non-empty string");
});

test("validateMessage accepts normal prompt", () => {
  assert.equal(validateMessage("Explain event loops"), null);
});
