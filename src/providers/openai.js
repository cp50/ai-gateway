const axios = require("axios");
const config = require("../config");

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

// gpt-4o-mini: $0.15/$0.60 per 1M, gpt-4o: $2.50/$10.00 per 1M
const PRICING = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.00 },
  "gpt-4o-2024-11-20": { inputPer1M: 2.50, outputPer1M: 10.00 },
  "gpt-4-turbo": { inputPer1M: 10.00, outputPer1M: 30.00 }
};

function toUsage(usage = {}) {
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function computeCost(model, usage) {
  const p = PRICING[model];
  if (!p) return 0;
  return (usage.promptTokens / 1_000_000) * p.inputPer1M +
         (usage.completionTokens / 1_000_000) * p.outputPer1M;
}

async function callOpenAI(prompt, model = config.models.openai || "gpt-4o-mini") {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const start = Date.now();

  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model,
        messages: [{ role: "user", content: prompt }]
      },
      {
        timeout: config.requestTimeoutMs,
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    const output =
      response.data?.choices?.[0]?.message?.content ||
      "No response";
    const usage = toUsage(response.data?.usage);

    return {
      ok: true,
      output,
      model,
      cost: computeCost(model, usage),
      latency: Date.now() - start,
      usage
    };
  } catch (error) {
    return {
      ok: false,
      output: "Error from OpenAI",
      model,
      cost: 0,
      latency: Date.now() - start,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      error: error.message
    };
  }
}

module.exports = callOpenAI;
