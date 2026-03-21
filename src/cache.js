const config = require("./config");
const { redisClient, connectRedis } = require("./redisClient");

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

async function resetCache() {
  await connectRedis();

  let cursor = "0";
  do {
    const result = await redisClient.scan(cursor, {
      MATCH: "ask:*",
      COUNT: 100
    });
    cursor = result.cursor;
    if (result.keys.length > 0) {
      await redisClient.del(result.keys);
    }
  } while (cursor !== "0");
}

module.exports = {
  getCacheKey,
  getCachedValue,
  setCachedValue,
  resetCache,
  normalizeMessage
};
