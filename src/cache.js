const config = require("./config");
const { redisClient, connectRedis } = require("./redisClient");
const { cosineSimilarity } = require("./embeddingRouter");

const SIM_THRESHOLD = config.cache.semanticThreshold || 0.92;

function normalizeMessage(message) {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function getCacheKey(message) {
  return `ask:${normalizeMessage(message)}`;
}

async function getCachedValue(key) {
  if (!config.cache.enabled) {
    return null;
  }

  await connectRedis();
  const value = await redisClient.get(key);
  if (!value) {
    return null;
  }

  return JSON.parse(value);
}

async function setCachedValue(key, value) {
  if (!config.cache.enabled) {
    return;
  }

  await connectRedis();
  const ttlSeconds = Math.max(1, Math.floor(config.cache.ttlMs / 1000));
  await redisClient.set(key, JSON.stringify(value), { EX: ttlSeconds });
}

async function getSemanticKeys() {
  await connectRedis();
  let cursor = "0";
  const keys = [];
  do {
    const res = await redisClient.scan(cursor, { MATCH: "semcache:*", COUNT: 100 });
    cursor = res.cursor;
    keys.push(...res.keys);
  } while (cursor !== "0");
  return keys;
}

async function semanticLookup(message, precomputedVec) {
  if (!config.cache.enabled) return null;

  const vec = precomputedVec || null;
  if (!vec) return null;

  const keys = await getSemanticKeys();
  if (keys.length === 0) return { vec, hit: null };

  let bestKey = null;
  let bestSim = -1;

  for (const k of keys) {
    const raw = await redisClient.get(k);
    if (!raw) continue;
    const entry = JSON.parse(raw);
    if (!entry.vec) continue;

    const sim = cosineSimilarity(vec, entry.vec);
    if (sim > bestSim) {
      bestSim = sim;
      bestKey = k;
    }
  }

  if (bestSim >= SIM_THRESHOLD && bestKey) {
    const raw = await redisClient.get(bestKey);
    const entry = JSON.parse(raw);
    return { vec, hit: entry.response };
  }

  return { vec, hit: null };
}

async function setSemanticCache(message, vec, response) {
  if (!config.cache.enabled || !vec) return;

  await connectRedis();
  const key = `semcache:${normalizeMessage(message)}`;
  const ttl = Math.max(1, Math.floor(config.cache.ttlMs / 1000));
  await redisClient.set(key, JSON.stringify({ vec, response }), { EX: ttl });
}

async function resetCache() {
  await connectRedis();

  for (const prefix of ["ask:*", "semcache:*"]) {
    let cursor = "0";
    do {
      const result = await redisClient.scan(cursor, { MATCH: prefix, COUNT: 100 });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        await redisClient.del(result.keys);
      }
    } while (cursor !== "0");
  }
}

module.exports = {
  getCacheKey,
  getCachedValue,
  setCachedValue,
  semanticLookup,
  setSemanticCache,
  resetCache,
  normalizeMessage
};
