const { redisClient, connectRedis } = require("./redisClient");

const KEYS = {
  requestsTotal: "metrics:requests_total",
  cacheHits: "metrics:cache_hits",
  cacheMisses: "metrics:cache_misses",
  failovers: "metrics:failovers",
  latencySum: "metrics:latency_sum",
  latencyCount: "metrics:latency_count"
};

function toSafeInt(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function runCounterOp(operation) {
  connectRedis()
    .then(operation)
    .catch(() => {
      // Keep telemetry best-effort; do not impact request pipeline.
    });
}

function recordRequest() {
  runCounterOp(() => redisClient.incr(KEYS.requestsTotal));
}

function recordCacheHit() {
  runCounterOp(() => redisClient.incr(KEYS.cacheHits));
}

function recordCacheMiss() {
  runCounterOp(() => redisClient.incr(KEYS.cacheMisses));
}

function recordFailover() {
  runCounterOp(() => redisClient.incr(KEYS.failovers));
}

function recordLatency(ms) {
  const value = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;

  runCounterOp(async () => {
    await redisClient.incrBy(KEYS.latencySum, value);
    await redisClient.incr(KEYS.latencyCount);
  });
}

async function readCounter(key) {
  await connectRedis();
  const value = await redisClient.get(key);
  return toSafeInt(value);
}

async function getMetrics() {
  const requestsTotal = await readCounter(KEYS.requestsTotal);
  const cacheHits = await readCounter(KEYS.cacheHits);
  const cacheMisses = await readCounter(KEYS.cacheMisses);
  const failovers = await readCounter(KEYS.failovers);
  const totalLatency = await readCounter(KEYS.latencySum);
  const requestCount = await readCounter(KEYS.latencyCount);

  const cacheDenominator = cacheHits + cacheMisses;
  const cacheHitRate = cacheDenominator > 0 ? cacheHits / cacheDenominator : 0;
  const avgLatencyMs = requestCount > 0 ? totalLatency / requestCount : 0;

  return {
    requestsTotal,
    cacheHits,
    cacheMisses,
    failovers,
    totalLatency,
    requestCount,
    cache_hit_rate: cacheHitRate,
    avg_latency_ms: avgLatencyMs,
    failover_rate: requestsTotal > 0 ? failovers / requestsTotal : 0
  };
}

module.exports = {
  recordRequest,
  recordCacheHit,
  recordCacheMiss,
  recordFailover,
  recordLatency,
  getMetrics
};
