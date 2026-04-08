const crypto = require("crypto");
const path = require("path");
const express = require("express");
const config = require("./config");
const {
  detectIntentEmbedding,
  classifyIntentWithLLM,
  prewarmIntentEmbeddings,
  embedText
} = require("./embeddingRouter");
const routeIntent = require("./router");
const { callCheapModel, callReasoningModel, streamCheapModel, streamReasoningModel } = require("./modelCaller");
const logUsage = require("./costTracker");
const isLowConfidence = require("./confidenceChecker");
const { getCacheKey, getCachedValue, setCachedValue, semanticLookup, setSemanticCache, resetCache } = require("./cache");
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

async function ensureDemoTenant() {
  const demoMode = String(process.env.DEMO_MODE || "true").toLowerCase() === "true";
  const demoKey = String(process.env.DEMO_TENANT_API_KEY || "").trim();

  if (!demoMode || !demoKey) {
    return;
  }

  const existingTenant = await getTenantByApiKey(demoKey);
  if (existingTenant) {
    console.log(`Demo tenant verified in Redis: ${existingTenant.tenantId}`);
    return;
  }

  const tenant = {
    apiKey: demoKey,
    tenantId: "tenant_demo",
    name: "demo",
    createdAt: Date.now(),
    requestsToday: 0,
    totalTokens: 0,
    totalCost: 0,
    lastReset: Date.now(),
    maxRequestsPerDay: 1000,
    maxTokensPerDay: 1_000_000,
    maxCostPerDay: 5
  };

  await redisClient.set(`tenant:${demoKey}`, JSON.stringify(tenant));
  console.log(`Demo tenant auto-seeded from DEMO_TENANT_API_KEY: ${tenant.tenantId}`);
}

function startEmbeddingPrewarm() {
  prewarmIntentEmbeddings()
    .then(() => {
      console.log("Embedding prewarm completed successfully.");
    })
    .catch(error => {
      console.error("Embedding prewarm failed in background:", error.message);
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
  const streamCheap = modelCaller.streamCheapModel || streamCheapModel;
  const streamReasoning = modelCaller.streamReasoningModel || streamReasoningModel;
  const detectIntent = overrides.intentDetector || detectIntentEmbedding;
  const classifyIntent = overrides.intentLlmClassifier || classifyIntentWithLLM;
  const authMiddleware = overrides.authenticateRequest || authenticateRequest;
  const quotaMiddleware = overrides.enforceTenantQuota || enforceTenantQuota;
  const adminAuthMiddleware = overrides.authenticateAdmin || authenticateAdmin;
  const embed = overrides.embedText || embedText;
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

  // Liveness check only — confirms the process is running.
  // Does not verify downstream dependencies (Redis, providers).
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

    let queryVec = null;
    try {
      queryVec = await embed(message);
    } catch {
      // embedding unavailable, skip semantic cache and use LLM intent
    }

    const semResult = await semanticLookup(message, queryVec);
    if (semResult && semResult.hit) {
      systemMetrics.recordCacheHit();
      res.setHeader("x-cache", "HIT-SEMANTIC");
      return res.json({
        ...semResult.hit,
        requestId,
        cached: true
      });
    }

    systemMetrics.recordCacheMiss();

    const intentResult = await detectIntent(message, queryVec);

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

    const wantsStream = (req.headers.accept || "").includes("text/event-stream");

    if (wantsStream) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "x-request-id": requestId,
        "x-route": preferredRoute,
        "x-intent": intent,
        "x-cache": "MISS"
      });

      const sendEvent = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent("route", {
        requestId,
        intent,
        intentConfidence,
        intentSource,
        route: preferredRoute
      });

      try {
        const streamFn = preferredRoute === "reasoning_model" ? streamReasoning : streamCheap;
        const { stream, model, startTime } = await streamFn(message);

        sendEvent("model", { model });

        let buf = "";
        let streamUsage = null;
        stream.on("data", (chunk) => {
          const lines = chunk.toString().split("\n").filter(l => l.trim());
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6);
            if (raw === "[DONE]") return;
            try {
              const parsed = JSON.parse(raw);
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                buf += token;
                sendEvent("token", { token });
              }
              if (parsed.usage) {
                streamUsage = {
                  promptTokens: parsed.usage.prompt_tokens || 0,
                  completionTokens: parsed.usage.completion_tokens || 0,
                  totalTokens: parsed.usage.total_tokens || 0
                };
              }
            } catch {}
          }
        });

        await new Promise((resolve, reject) => {
          stream.on("end", resolve);
          stream.on("error", reject);
        });

        const modelLatency = Date.now() - startTime;
        const usage = streamUsage || {
          promptTokens: 0,
          completionTokens: Math.ceil(buf.length / 4),
          totalTokens: Math.ceil(buf.length / 4)
        };

        let finalBuf = buf;
        let finalModel = model;
        let finalRoute = preferredRoute;
        let finalUsage = usage;
        let escalated = false;

        // mirror non-streaming escalation: if cheap model returns low-confidence
        // output, transparently upgrade to reasoning model
        if (preferredRoute === "cheap_model" && isLowConfidence(buf, intent)) {
          try {
            const escalationResult = await callReasoning(message);
            if (escalationResult.ok) {
              escalated = true;
              finalBuf = escalationResult.output;
              finalModel = escalationResult.model;
              finalRoute = "reasoning_model";
              finalUsage = escalationResult.usage || usage;
              if (escalationResult.failover) systemMetrics.recordFailover();
              sendEvent("escalating", { reason: "low_confidence", from: model, to: escalationResult.model });
            }
          } catch (escalationError) {
            console.error("SSE escalation failed:", escalationError.message);
          }
        }

        const endToEndLatency = Date.now() - startedAt;
        systemMetrics.recordLatency(endToEndLatency);

        logUsage({
          requestId,
          intent,
          route: finalRoute,
          model: finalModel,
          cost: 0,
          latency: endToEndLatency,
          usage: finalUsage
        });

        try {
          await recordTenantUsage(req.tenant.apiKey, { ...finalUsage, cost: 0 });
        } catch (tenantError) {
          console.error("Tenant usage update failed:", tenantError.message);
        }

        const responsePayload = {
          intent,
          intentConfidence,
          intentSource,
          route: finalRoute,
          model: finalModel,
          response: finalBuf,
          latency: endToEndLatency,
          cost: 0,
          usage: finalUsage,
          failover: false
        };

        await setCachedValue(cacheKey, responsePayload);
        setSemanticCache(message, queryVec, responsePayload).catch(() => {});

        sendEvent("done", {
          response: finalBuf,
          model: finalModel,
          route: finalRoute,
          latency: modelLatency,
          escalated
        });

        res.end();
        return;
      } catch (err) {
        sendEvent("error", { error: err.message });
        res.end();
        return;
      }
    }

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
      setSemanticCache(message, queryVec, responsePayload).catch(() => {});
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

  connectRedis()
    .then(() => ensureDemoTenant())
    .then(() => {
      const app = createApp();
      app.listen(config.port, () => {
        console.log(`AI Router running on http://localhost:${config.port}`);
        startEmbeddingPrewarm();
      });
    })
    .catch(error => {
      console.error("Startup failure:", error.message);
      process.exit(1);
    });
}

module.exports = { createApp, validateMessage, rateLimit, resetRateLimits, resetCache, ensureDemoTenant };
