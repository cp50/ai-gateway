const config = require("./config");

const metrics = new Map();

function defaultHealth() {
  return {
    requests: 0,
    failures: 0,
    avgLatency: 0
  };
}

function ensureModel(model) {
  if (!metrics.has(model)) {
    metrics.set(model, defaultHealth());
  }
  return metrics.get(model);
}

function seedKnownModels() {
  [config.models.cheap, config.models.reasoning, config.models.fallback]
    .filter(Boolean)
    .forEach(ensureModel);
}

seedKnownModels();

function recordSuccess(model, latency) {
  const item = ensureModel(model);
  const safeLatency = Number.isFinite(latency) ? Math.max(0, latency) : 0;
  const successesBefore = Math.max(item.requests - item.failures, 0);
  const successesAfter = successesBefore + 1;

  item.avgLatency = successesBefore === 0
    ? safeLatency
    : item.avgLatency + (safeLatency - item.avgLatency) / successesAfter;
  item.requests += 1;
}

function recordFailure(model) {
  const item = ensureModel(model);
  item.requests += 1;
  item.failures += 1;
}

function getHealth(model) {
  const item = ensureModel(model);
  return { ...item };
}

function getAllHealth() {
  const output = {};
  for (const [model, item] of metrics.entries()) {
    output[model] = { ...item };
  }
  return output;
}

function getHealthScore(model) {
  const item = ensureModel(model);
  if (item.requests === 0) {
    return Number.POSITIVE_INFINITY;
  }
  return item.failures * 1000 + item.avgLatency;
}

module.exports = {
  recordSuccess,
  recordFailure,
  getHealth,
  getAllHealth,
  getHealthScore
};
