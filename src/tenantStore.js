const crypto = require("crypto");
const { redisClient, connectRedis } = require("./redisClient");

const DEFAULT_LIMITS = {
  maxRequestsPerDay: 1000,
  maxTokensPerDay: 1_000_000,
  maxCostPerDay: 5
};

const RESET_WINDOW_MS = 86_400_000;

function tenantKey(apiKey) {
  return `tenant:${apiKey}`;
}

function generateApiKey() {
  return `sk_${crypto.randomBytes(16).toString("hex")}`;
}

function generateTenantId() {
  return `tenant_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function hydrateTenant(tenant) {
  return {
    ...tenant,
    maxRequestsPerDay: Number.isFinite(Number(tenant?.maxRequestsPerDay))
      ? Number(tenant.maxRequestsPerDay)
      : DEFAULT_LIMITS.maxRequestsPerDay,
    maxTokensPerDay: Number.isFinite(Number(tenant?.maxTokensPerDay))
      ? Number(tenant.maxTokensPerDay)
      : DEFAULT_LIMITS.maxTokensPerDay,
    maxCostPerDay: Number.isFinite(Number(tenant?.maxCostPerDay))
      ? Number(tenant.maxCostPerDay)
      : DEFAULT_LIMITS.maxCostPerDay,
    lastReset: Number.isFinite(Number(tenant?.lastReset))
      ? Number(tenant.lastReset)
      : Date.now()
  };
}

async function createTenant(name) {
  await connectRedis();

  const apiKey = generateApiKey();
  const tenant = hydrateTenant({
    apiKey,
    tenantId: generateTenantId(),
    name: String(name || "tenant"),
    createdAt: Date.now(),
    requestsToday: 0,
    totalTokens: 0,
    totalCost: 0,
    lastReset: Date.now()
  });

  await redisClient.set(tenantKey(apiKey), JSON.stringify(tenant));
  return tenant;
}

async function getTenantByApiKey(apiKey) {
  if (!apiKey) {
    return null;
  }

  await connectRedis();
  const raw = await redisClient.get(tenantKey(apiKey));
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  const tenant = hydrateTenant(parsed);
  let shouldPersist = !parsed.lastReset;

  if (Date.now() - tenant.lastReset > RESET_WINDOW_MS) {
    tenant.requestsToday = 0;
    tenant.totalTokens = 0;
    tenant.totalCost = 0;
    tenant.lastReset = Date.now();
    shouldPersist = true;
  }

  if (shouldPersist) {
    await redisClient.set(tenantKey(apiKey), JSON.stringify(tenant));
  }

  return tenant;
}

async function recordTenantUsage(apiKey, usage = {}) {
  const tenant = await getTenantByApiKey(apiKey);
  if (!tenant) {
    return null;
  }

  const tokenCount = Number(usage.totalTokens || usage.total_tokens || 0);
  const safeTokens = Number.isFinite(tokenCount) ? Math.max(0, tokenCount) : 0;
  const costValue = Number(usage.cost || 0);
  const safeCost = Number.isFinite(costValue) ? Math.max(0, costValue) : 0;

  tenant.requestsToday += 1;
  tenant.totalTokens += safeTokens;
  tenant.totalCost += safeCost;

  await redisClient.set(tenantKey(apiKey), JSON.stringify(tenant));
  return tenant;
}

module.exports = {
  createTenant,
  getTenantByApiKey,
  recordTenantUsage
};
