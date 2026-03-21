const crypto = require("crypto");
const path = require("path");
const express = require("express");
const config = require("./config");
const {
  detectIntentEmbedding,
  classifyIntentWithLLM,
  prewarmIntentEmbeddings
} = require("./embeddingRouter");
const routeIntent = require("./router");
const { callCheapModel, callReasoningModel } = require("./modelCaller");
const logUsage = require("./costTracker");
const isLowConfidence = require("./confidenceChecker");
const { getCacheKey, getCachedValue, setCachedValue, resetCache } = require("./cache");
const { redisClient, connectRedis } = require("./redisClient");
const systemMetrics = require("./systemMetrics");
const { getAllHealth } = require("./metricsStore");
const { authenticateRequest } = require("./authMiddleware");
const { enforceTenantQuota } = require("./quotaMiddleware");
const { authenticateAdmin } = require("./adminMiddleware");
const { getTenantByApiKey, recordTenantUsage } = require("./tenantStore");

function getClientKey(req) {
  return req.ip || req.headers["x-forwarded-for"] || "unknown";
}

function getModelLatency(health, modelName) {
  return health[modelName]?.avgLatency || 0;
}

function buildDemoConfig() {
  return {
    demoMode: String(process.env.DEMO_MODE || "true").toLowerCase() === "true",
    demoTenantApiKey: process.env.DEMO_TENANT_API_KEY || "sk_demo_public",
    samplePrompts: [
      "What is an API?",
      "Summarize the following article into five bullet points.",
      "Design a scalable chat system.",
      "Analyze this code for likely failure points."
    ]
  };
}

function logStartupWarnings() {
  const warnings = [];

  if (!process.env.GOOGLE_API_KEY) {
    warnings.push("GOOGLE_API_KEY is missing. Gemini fallback calls will fail.");
  }

  if (!process.env.GROQ_API_KEY) {
    warnings.push("GROQ_API_KEY is missing. Primary Groq model calls will fail.");
  }

  if (!process.env.ADMIN_API_KEY) {
    warnings.push("ADMIN_API_KEY is missing. Admin endpoints will not be usable.");
  }

  if (String(process.env.DEMO_MODE || "true").toLowerCase() === "true" && !process.env.DEMO_TENANT_API_KEY) {
    warnings.push("DEMO_TENANT_API_KEY is missing. The public demo will fall back to sk_demo_public, which you should replace before deployment.");
  }

  warnings.forEach(message => {
    console.warn(`[startup warning] ${message}`);
  });
}

async function rateLimit(req, res, next) {
  try {
    await connectRedis();

    const now = Date.now();
    const windowSeconds = Math.max(1, Math.floor(config.rateLimit.windowMs / 1000));
    const key = `ratelimit:${getClientKey(req)}`;

    const count = await redisClient.incr(key);
    if (count === 1) {
      await redisClient.expire(key, windowSeconds);
    }

    if (count > config.rateLimit.maxRequests) {
      const ttl = await redisClient.ttl(key);
      return res.status(429).json({
        error: "Too many requests",
        code: "RATE_LIMITED",
        retryAfterMs: Math.max(0, ttl) * 1000,
        now
      });
    }

    return next();
  } catch (error) {
    console.error("Rate limiter error:", error.message);
    return res.status(500).json({
      error: "Rate limiter unavailable",
      code: "RATE_LIMITER_ERROR"
    });
  }
}

async function resetRateLimits() {
  await connectRedis();

  let cursor = "0";
  do {
    const result = await redisClient.scan(cursor, {
      MATCH: "ratelimit:*",
      COUNT: 100
    });
    cursor = result.cursor;
    if (result.keys.length > 0) {
      await redisClient.del(result.keys);
    }
  } while (cursor !== "0");
}

function validateMessage(message) {
  if (typeof message !== "string" || message.trim().length === 0) {
    return "Message must be a non-empty string";
  }

  if (message.length > config.maxMessageChars) {
    return `Message exceeds ${config.maxMessageChars} characters`;
  }

  return null;
}

function createApp(overrides = {}) {
  const modelCaller = overrides.modelCaller || {};
  const callCheap = modelCaller.callCheapModel || callCheapModel;
  const callReasoning = modelCaller.callReasoningModel || callReasoningModel;
  const detectIntent = overrides.intentDetector || detectIntentEmbedding;
  const classifyIntent = overrides.intentLlmClassifier || classifyIntentWithLLM;
  const authMiddleware = overrides.authenticateRequest || authenticateRequest;
  const quotaMiddleware = overrides.enforceTenantQuota || enforceTenantQuota;
  const adminAuthMiddleware = overrides.authenticateAdmin || authenticateAdmin;
  const app = express();
  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.json({ limit: "1mb" }));
  app.use("/assets", express.static(path.join(publicDir, "assets")));
  app.use(rateLimit);

  app.get("/", (req, res) => {
    return res.redirect("/ask");
  });

  app.get("/ask", (req, res) => {
    return res.sendFile(path.join(publicDir, "ask.html"));
  });

  app.get("/tenant", (req, res) => {
    return res.sendFile(path.join(publicDir, "tenant.html"));
  });

  app.get("/admin", (req, res) => {
    return res.sendFile(path.join(publicDir, "admin.html"));
  });

  app.get("/health", (req, res) => {
    return res.json({
      status: "ok",
      uptime: process.uptime()
    });
  });

  app.get("/demo/config", (req, res) => {
    return res.json(buildDemoConfig());
  });

  app.get("/admin/metrics", adminAuthMiddleware, async (req, res) => {
    const metrics = await systemMetrics.getMetrics();
    const health = getAllHealth();

    return res.json({
      requests_total: metrics.requestsTotal,
      cache_hit_rate: metrics.cache_hit_rate,
      failover_rate: metrics.failover_rate,
      avg_latency_ms: metrics.avg_latency_ms,
      provider_latency: {
        llama: getModelLatency(health, "llama-3.3-70b-versatile"),
        gpt_oss: getModelLatency(health, "openai/gpt-oss-120b"),
        gemini: getModelLatency(health, "gemini-2.5-flash")
      },
      model_health: health
    });
  });

  app.get("/admin/tenants/:apiKey", adminAuthMiddleware, async (req, res) => {
    const tenant = await getTenantByApiKey(req.params.apiKey);
    if (!tenant) {
      return res.status(404).json({ error: "Tenant not found", code: "TENANT_NOT_FOUND" });
    }

    return res.json({
      tenantId: tenant.tenantId,
      name: tenant.name,
      requestsToday: tenant.requestsToday,
      totalTokens: tenant.totalTokens,
      totalCost: tenant.totalCost,
      maxRequestsPerDay: tenant.maxRequestsPerDay,
      maxTokensPerDay: tenant.maxTokensPerDay,
      maxCostPerDay: tenant.maxCostPerDay,
      lastReset: tenant.lastReset
    });
  });

  app.post("/ask", authMiddleware, quotaMiddleware, async (req, res) => {
    const requestId = crypto.randomUUID();
    res.setHeader("x-request-id", requestId);
    systemMetrics.recordRequest();

    const { message } = req.body || {};
    const validationError = validateMessage(message);

    if (validationError) {
      return res.status(400).json({ error: validationError, code: "INVALID_INPUT", requestId });
    }

    const cacheKey = getCacheKey(message);
    const cachedResponse = await getCachedValue(cacheKey);
    if (cachedResponse) {
      systemMetrics.recordCacheHit();
      res.setHeader("x-cache", "HIT");
      return res.json({
        ...cachedResponse,
        requestId,
        cached: true
      });
    }

    systemMetrics.recordCacheMiss();

    const intentResult = await detectIntent(message);

    let intent;
    let intentConfidence;
    let intentSource;

    if (intentResult.uncertain) {
      console.log({
        type: "intent_fallback",
        reason: "low_embedding_confidence",
        message
      });
      const llmIntent = await classifyIntent(message);
      intent = llmIntent.intent;
      intentConfidence = 0.5;
      intentSource = "llm";
    } else {
      intent = intentResult.intent;
      intentConfidence = intentResult.confidence;
      intentSource = "embedding";
    }

    const preferredRoute = routeIntent(intent, message);
    const startedAt = Date.now();
    let finalRoute = preferredRoute;
    let result;

    try {
      if (preferredRoute === "reasoning_model") {
        result = await callReasoning(message);
        if (!result.ok) {
          finalRoute = "cheap_model";
          result = await callCheap(message);
        }
      } else {
        result = await callCheap(message);
      }

      if (result.failover) {
        systemMetrics.recordFailover();
      }

      if (!result.ok) {
        systemMetrics.recordLatency(Date.now() - startedAt);
        return res.status(502).json({
          error: "Upstream model failure",
          code: "MODEL_UNAVAILABLE",
          requestId
        });
      }

      if (finalRoute === "cheap_model" && isLowConfidence(result.output, intent)) {
        const reasoningResult = await callReasoning(message);
        if (reasoningResult.ok) {
          result = reasoningResult;
          finalRoute = "reasoning_model";
          if (result.failover) {
            systemMetrics.recordFailover();
          }
        }
      }

      const endToEndLatency = Date.now() - startedAt;
      systemMetrics.recordLatency(endToEndLatency);

      logUsage({
        requestId,
        intent,
        route: finalRoute,
        model: result.model,
        cost: result.cost,
        latency: endToEndLatency,
        usage: result.usage
      });

      try {
        await recordTenantUsage(req.tenant.apiKey, {
          ...result.usage,
          cost: result.cost
        });
      } catch (tenantError) {
        console.error("Tenant usage update failed:", tenantError.message);
      }

      const responsePayload = {
        intent,
        intentConfidence,
        intentSource,
        route: finalRoute,
        model: result.model,
        response: result.output,
        latency: result.latency,
        cost: result.cost,
        usage: result.usage,
        failover: !!result.failover
      };

      await setCachedValue(cacheKey, responsePayload);
      res.setHeader("x-cache", "MISS");

      return res.json({
        requestId,
        ...responsePayload,
        cached: false
      });
    } catch (error) {
      console.error("Server error:", requestId, error.message);
      return res.status(500).json({
        error: "Internal server error",
        code: "INTERNAL_ERROR",
        requestId
      });
    }
  });

  return app;
}

if (require.main === module) {
  logStartupWarnings();

  Promise.all([prewarmIntentEmbeddings(), connectRedis()])
    .then(() => {
      const app = createApp();
      app.listen(config.port, () => {
        console.log(`AI Router running on http://localhost:${config.port}`);
      });
    })
    .catch(error => {
      console.error("Startup failure:", error.message);
      process.exit(1);
    });
}

module.exports = { createApp, validateMessage, rateLimit, resetRateLimits, resetCache };
