const test = require("node:test");
const assert = require("node:assert/strict");
const { authenticateRequest } = require("../src/authMiddleware");

function mockRes() {
  let statusCode;
  let body;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      body = data;
    },
    get statusCode() { return statusCode; },
    get body() { return body; }
  };
}

test("rejects request with no authorization header", async () => {
  const req = { get: () => "" };
  const res = mockRes();
  let nextCalled = false;

  await authenticateRequest(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "UNAUTHORIZED");
  assert.equal(nextCalled, false);
});

test("rejects request with malformed authorization header", async () => {
  const req = { get: () => "Basic abc123" };
  const res = mockRes();
  let nextCalled = false;

  await authenticateRequest(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "UNAUTHORIZED");
  assert.equal(nextCalled, false);
});

test("rejects request with invalid API key", async () => {
  const req = { get: () => "Bearer invalid-key-that-does-not-exist" };
  const res = mockRes();
  let nextCalled = false;

  await authenticateRequest(req, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "UNAUTHORIZED");
  assert.equal(nextCalled, false);
});
