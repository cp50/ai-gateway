require("dotenv").config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  port: toNumber(process.env.PORT, 3000),
  googleApiKey: process.env.GOOGLE_API_KEY || "",
  groqApiKey: process.env.GROQ_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  googleBaseUrl:
    process.env.GOOGLE_BASE_URL ||
    "https://generativelanguage.googleapis.com/v1/models",
  requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 30000),
  models: {
    cheap: process.env.CHEAP_MODEL || "llama-3.3-70b-versatile",
    reasoning: process.env.REASONING_MODEL || "openai/gpt-oss-120b",
    fallback: process.env.FALLBACK_MODEL || "gemini-2.5-flash",
    classifier: process.env.CLASSIFIER_MODEL || "llama-3.3-70b-versatile"
  },
  pricing: {
    cheap: {
      inputPer1M: toNumber(process.env.CHEAP_INPUT_USD_PER_1M_TOKENS, 0),
      outputPer1M: toNumber(process.env.CHEAP_OUTPUT_USD_PER_1M_TOKENS, 0)
    },
    reasoning: {
      inputPer1M: toNumber(
        process.env.REASONING_INPUT_USD_PER_1M_TOKENS,
        toNumber(process.env.CHEAP_INPUT_USD_PER_1M_TOKENS, 0)
      ),
      outputPer1M: toNumber(
        process.env.REASONING_OUTPUT_USD_PER_1M_TOKENS,
        toNumber(process.env.CHEAP_OUTPUT_USD_PER_1M_TOKENS, 0)
      )
    }
  },
  rateLimit: {
    windowMs: toNumber(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
    maxRequests: toNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 60)
  },
  maxMessageChars: toNumber(process.env.MAX_MESSAGE_CHARS, 8000),
  confidenceThreshold: toNumber(process.env.CONFIDENCE_THRESHOLD, 0.6),
  cache: {
    enabled: String(process.env.CACHE_ENABLED || "true").toLowerCase() === "true",
    ttlMs: toNumber(process.env.CACHE_TTL_MS, 300_000),
    maxEntries: toNumber(process.env.CACHE_MAX_ENTRIES, 1000),
    semanticThreshold: toNumber(process.env.CACHE_SEMANTIC_THRESHOLD, 0.92)
  }
};

module.exports = config;
