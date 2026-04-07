const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp, resetRateLimits, resetCache, ensureDemoTenant } = require("../src/server");
const { redisClient, connectRedis } = require("../src/redisClient");

const TENANT_KEY = "sk_test_auth_quota";
const ADMIN_KEY = "test-admin-secret";

function request(server, method, path, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: "127.0.0.1",
      port: addr.port,
      path,
      method,
      headers: { "content-type": "application/json", ...headers }
    };

    const req = http.request(opts, res => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function listen(app) {
  return new Promise(resolve => {
    const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function seedTenant(apiKey, overrides = {}) {
  const tenant = {
    apiKey,
    tenantId: "tenant_test",
    name: "test",
    createdAt: Date.now(),
    requestsToday: 0,
    totalTokens: 0,
    totalCost: 0,
    lastReset: Date.now(),
    maxRequestsPerDay: 1000,
    maxTokensPerDay: 1_000_000,
    maxCostPerDay: 5,
    ...overrides
  };
  await redisClient.set(`tenant:${apiKey}`, JSON.stringify(tenant));
  return tenant;
}

test("auth, quota and admin paths", async (t) => {
  await connectRedis();
  await resetRateLimits();

  const prevAdminKey = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;

  const stubModel = {
    callCheapModel: async () => ({
      ok: true, output: "test", model: "test", cost: 0, latency: 1, usage: {}
    }),
    callReasoningModel: async () => ({
      ok: true, output: "test", model: "test", cost: 0, latency: 1, usage: {}
    })
  };

  const app = createApp({
    modelCaller: stubModel,
    intentDetector: async () => ({ intent: "greeting", confidence: 1 }),
    embedText: async () => [0, 0, 0]
  });

  const server = await listen(app);

  t.after(async () => {
    server.close();
    process.env.ADMIN_API_KEY = prevAdminKey;
    await resetRateLimits();
    await redisClient.del(`tenant:${TENANT_KEY}`);
    resetCache();
  });

  await t.test("POST /ask without auth header returns 401", async () => {
    const res = await request(server, "POST", "/ask", {
      body: { message: "hello" }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHORIZED");
  });

  await t.test("POST /ask with wrong api key returns 401", async () => {
    const res = await request(server, "POST", "/ask", {
      body: { message: "hello" },
      headers: { authorization: "Bearer sk_bogus_key_does_not_exist" }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHORIZED");
  });

  await t.test("POST /ask with exhausted request quota returns 429", async () => {
    await seedTenant(TENANT_KEY, {
      requestsToday: 1000,
      maxRequestsPerDay: 1000
    });

    const res = await request(server, "POST", "/ask", {
      body: { message: "hello" },
      headers: { authorization: `Bearer ${TENANT_KEY}` }
    });
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "QUOTA_EXCEEDED");
  });

  await t.test("POST /ask with exhausted token quota returns 429", async () => {
    await seedTenant(TENANT_KEY, {
      requestsToday: 0,
      totalTokens: 1_000_000,
      maxTokensPerDay: 1_000_000
    });

    const res = await request(server, "POST", "/ask", {
      body: { message: "hello" },
      headers: { authorization: `Bearer ${TENANT_KEY}` }
    });
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "QUOTA_EXCEEDED");
  });

  await t.test("POST /ask with exhausted cost quota returns 429", async () => {
    await seedTenant(TENANT_KEY, {
      requestsToday: 0,
      totalTokens: 0,
      totalCost: 5,
      maxCostPerDay: 5
    });

    const res = await request(server, "POST", "/ask", {
      body: { message: "hello" },
      headers: { authorization: `Bearer ${TENANT_KEY}` }
    });
    assert.equal(res.status, 429);
    assert.equal(res.body.code, "QUOTA_EXCEEDED");
  });

  await t.test("POST /ask with valid tenant and quota succeeds", async () => {
    await seedTenant(TENANT_KEY, { requestsToday: 0, totalTokens: 0, totalCost: 0 });

    const res = await request(server, "POST", "/ask", {
      body: { message: "hello" },
      headers: { authorization: `Bearer ${TENANT_KEY}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.response, "test");
  });

  await t.test("GET /admin/metrics without auth returns 401", async () => {
    const res = await request(server, "GET", "/admin/metrics");
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHORIZED");
  });

  await t.test("GET /admin/metrics with wrong key returns 401", async () => {
    const res = await request(server, "GET", "/admin/metrics", {
      headers: { authorization: "Bearer wrong-admin-key" }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHORIZED");
  });

  await t.test("GET /admin/metrics with valid key succeeds", async () => {
    const res = await request(server, "GET", "/admin/metrics", {
      headers: { authorization: `Bearer ${ADMIN_KEY}` }
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.requests_total !== undefined);
  });

  await t.test("GET /admin/tenants/:key with wrong admin key returns 401", async () => {
    const res = await request(server, "GET", `/admin/tenants/${TENANT_KEY}`, {
      headers: { authorization: "Bearer nope" }
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "UNAUTHORIZED");
  });
});

test("demo tenant auto-seed", async () => {
  await connectRedis();

  const demoKey = "sk_demo_test_" + Date.now();
  const prevDemo = process.env.DEMO_MODE;
  const prevDemoKey = process.env.DEMO_TENANT_API_KEY;

  process.env.DEMO_MODE = "true";
  process.env.DEMO_TENANT_API_KEY = demoKey;

  // clear any existing tenant with this key
  await redisClient.del(`tenant:${demoKey}`);

  const before = await redisClient.get(`tenant:${demoKey}`);
  assert.equal(before, null);

  await ensureDemoTenant();

  const after = await redisClient.get(`tenant:${demoKey}`);
  assert.ok(after !== null);
  const tenant = JSON.parse(after);
  assert.equal(tenant.tenantId, "tenant_demo");
  assert.equal(tenant.apiKey, demoKey);

  // cleanup
  await redisClient.del(`tenant:${demoKey}`);
  process.env.DEMO_MODE = prevDemo;
  process.env.DEMO_TENANT_API_KEY = prevDemoKey;
});
