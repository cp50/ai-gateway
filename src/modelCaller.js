const axios = require("axios");
const config = require("./config");
const callGroq = require("./providers/groq");
const { chooseModelForRoute } = require("./router");
const { recordSuccess, recordFailure } = require("./metricsStore");

function toUsage(usageMetadata = {}) {
  const promptTokens = usageMetadata.promptTokenCount || 0;
  const totalTokens = usageMetadata.totalTokenCount || 0;
  const completionTokens =
    usageMetadata.candidatesTokenCount || Math.max(totalTokens - promptTokens, 0);

  return { promptTokens, completionTokens, totalTokens };
}

function computeCostUSD(usage, pricing) {
  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1M;
  return inputCost + outputCost;
}

function getStatus(error) {
  return error?.response?.status || 0;
}

function isTimeoutError(error) {
  return error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "");
}

function isNetworkError(error) {
  return !error?.response;
}

function shouldFallbackFromGroq(error) {
  const status = getStatus(error);
  return isNetworkError(error) || isTimeoutError(error) || status >= 500;
}

async function generateWithGemini(model, prompt) {
  if (!config.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not configured");
  }

  const start = Date.now();
  const url = `${config.googleBaseUrl}/${model}:generateContent?key=${config.googleApiKey}`;

  const response = await axios.post(
    url,
    {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    },
    {
      timeout: config.requestTimeoutMs
    }
  );

  const output =
    response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
  const usage = toUsage(response.data.usageMetadata);

  return {
    output,
    usage,
    latency: Date.now() - start
  };
}

function buildResult({ ok, output, model, cost, latency, usage, error, failover }) {
  return {
    ok,
    output,
    model,
    cost,
    latency,
    usage,
    error: error || null,
    failover: Boolean(failover)
  };
}

function logFailover(from, to, error) {
  console.log({
    type: "failover",
    from,
    to,
    reason: error?.message || "unknown"
  });
  console.log("Primary provider failed -> fallback triggered");
}

function logFallbackSuccess() {
  console.log("Fallback provider succeeded");
}

async function callCheapModel(prompt) {
  const cheapModel = chooseModelForRoute("cheap_model");
  const fallbackModel = config.models.fallback;

  try {
    const result = await callGroq(prompt, cheapModel);
    recordSuccess(cheapModel, result.latency);

    return buildResult({
      ok: true,
      output: result.output,
      model: result.model,
      cost: 0,
      latency: result.latency,
      usage: result.usage,
      failover: false
    });
  } catch (error) {
    recordFailure(cheapModel);

    if (!shouldFallbackFromGroq(error)) {
      console.error(
        "Cheap model error:",
        error.response?.data || error.code || error.message
      );

      return buildResult({
        ok: false,
        output: "Error from cheap model",
        model: cheapModel,
        cost: 0,
        latency: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: error.message,
        failover: false
      });
    }

    logFailover("groq", "gemini", error);

    try {
      const fallback = await generateWithGemini(fallbackModel, prompt);
      recordSuccess(fallbackModel, fallback.latency);
      const fallbackCost = computeCostUSD(fallback.usage, config.pricing.reasoning);
      logFallbackSuccess();
      return buildResult({
        ok: true,
        output: fallback.output,
        model: fallbackModel,
        cost: fallbackCost,
        latency: fallback.latency,
        usage: fallback.usage,
        failover: true
      });
    } catch (fallbackError) {
      recordFailure(fallbackModel);
      console.error(
        "Cheap fallback error:",
        fallbackError.response?.data || fallbackError.code || fallbackError.message
      );

      return buildResult({
        ok: false,
        output: "Error from cheap model",
        model: cheapModel,
        cost: 0,
        latency: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: fallbackError.message,
        failover: false
      });
    }
  }
}

async function callReasoningModel(prompt) {
  const reasoningModel = chooseModelForRoute("reasoning_model");
  const fallbackModel = config.models.fallback;

  const enhancedPrompt = `
You are an expert system. Provide a deep, structured, step-by-step analysis.

User request:
${prompt}

Include:
- Key concepts
- Step-by-step explanation
- Best practices
- Potential pitfalls
`;

  try {
    const result = await callGroq(enhancedPrompt, reasoningModel);
    recordSuccess(reasoningModel, result.latency);

    return buildResult({
      ok: true,
      output: result.output,
      model: result.model,
      cost: 0,
      latency: result.latency,
      usage: result.usage,
      failover: false
    });
  } catch (error) {
    recordFailure(reasoningModel);

    if (!shouldFallbackFromGroq(error)) {
      console.error(
        "Reasoning model error:",
        error.response?.data || error.code || error.message
      );

      return buildResult({
        ok: false,
        output: "Error from reasoning model",
        model: reasoningModel,
        cost: 0,
        latency: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: error.message,
        failover: false
      });
    }

    logFailover("groq", "gemini", error);

    try {
      const fallback = await generateWithGemini(fallbackModel, enhancedPrompt);
      recordSuccess(fallbackModel, fallback.latency);
      const fallbackCost = computeCostUSD(fallback.usage, config.pricing.reasoning);
      logFallbackSuccess();
      return buildResult({
        ok: true,
        output: fallback.output,
        model: fallbackModel,
        cost: fallbackCost,
        latency: fallback.latency,
        usage: fallback.usage,
        failover: true
      });
    } catch (fallbackError) {
      recordFailure(fallbackModel);
      console.error(
        "Reasoning fallback error:",
        fallbackError.response?.data || fallbackError.code || fallbackError.message
      );

      return buildResult({
        ok: false,
        output: "Error from reasoning model",
        model: reasoningModel,
        cost: 0,
        latency: 0,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        error: fallbackError.message,
        failover: false
      });
    }
  }
}

module.exports = { callCheapModel, callReasoningModel, computeCostUSD, toUsage };
