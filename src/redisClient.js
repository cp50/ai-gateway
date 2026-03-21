const { createClient } = require("redis");
const config = require("./config");

const nativeClient = createClient({
  url: config.redisUrl,
  socket: {
    connectTimeout: 2000,
    reconnectStrategy: false
  }
});

nativeClient.on("error", err => {
  console.error("Redis error:", err.message);
});

let useMemoryFallback = false;
const memoryStore = new Map();

function nowMs() {
  return Date.now();
}

function purgeExpired() {
  const now = nowMs();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      memoryStore.delete(key);
    }
  }
}

function setMemoryKey(key, value, expiresAt = null) {
  memoryStore.set(key, { value, expiresAt });
}

function wildcardToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

const redisClient = {
  get isOpen() {
    return !useMemoryFallback && nativeClient.isOpen;
  },
  async get(key) {
    purgeExpired();
    if (useMemoryFallback) {
      return memoryStore.get(key)?.value ?? null;
    }
    return nativeClient.get(key);
  },
  async set(key, value, options = {}) {
    purgeExpired();
    if (useMemoryFallback) {
      const seconds = Number(options.EX || 0);
      const expiresAt = seconds > 0 ? nowMs() + seconds * 1000 : null;
      setMemoryKey(key, value, expiresAt);
      return "OK";
    }
    return nativeClient.set(key, value, options);
  },
  async del(keys) {
    purgeExpired();
    const keyList = Array.isArray(keys) ? keys : [keys];
    if (useMemoryFallback) {
      let removed = 0;
      for (const key of keyList) {
        if (memoryStore.delete(key)) {
          removed += 1;
        }
      }
      return removed;
    }
    return nativeClient.del(keyList);
  },
  async scan(cursor, options = {}) {
    purgeExpired();
    if (useMemoryFallback) {
      const pattern = options.MATCH || "*";
      const regex = wildcardToRegex(pattern);
      const keys = [...memoryStore.keys()].filter(key => regex.test(key));
      return { cursor: "0", keys };
    }
    return nativeClient.scan(cursor, options);
  },
  async incr(key) {
    purgeExpired();
    if (useMemoryFallback) {
      const current = Number(memoryStore.get(key)?.value || "0");
      const next = current + 1;
      const existingExpiry = memoryStore.get(key)?.expiresAt ?? null;
      setMemoryKey(key, String(next), existingExpiry);
      return next;
    }
    return nativeClient.incr(key);
  },
  async incrBy(key, increment) {
    purgeExpired();
    const step = Number(increment || 0);
    if (useMemoryFallback) {
      const current = Number(memoryStore.get(key)?.value || "0");
      const next = current + step;
      const existingExpiry = memoryStore.get(key)?.expiresAt ?? null;
      setMemoryKey(key, String(next), existingExpiry);
      return next;
    }
    return nativeClient.incrBy(key, step);
  },
  async expire(key, seconds) {
    purgeExpired();
    if (useMemoryFallback) {
      const entry = memoryStore.get(key);
      if (!entry) {
        return 0;
      }
      setMemoryKey(key, entry.value, nowMs() + Number(seconds) * 1000);
      return 1;
    }
    return nativeClient.expire(key, seconds);
  },
  async ttl(key) {
    purgeExpired();
    if (useMemoryFallback) {
      const entry = memoryStore.get(key);
      if (!entry) {
        return -2;
      }
      if (entry.expiresAt === null) {
        return -1;
      }
      return Math.max(0, Math.floor((entry.expiresAt - nowMs()) / 1000));
    }
    return nativeClient.ttl(key);
  }
};

async function connectRedis() {
  if (useMemoryFallback || nativeClient.isOpen) {
    return;
  }

  try {
    await nativeClient.connect();
    console.log("Redis connected");
  } catch (err) {
    console.error("Redis connection failed, using in-memory fallback:", err.message);
    useMemoryFallback = true;
  }
}

module.exports = {
  redisClient,
  connectRedis
};
