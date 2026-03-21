const axios = require("axios");
const config = require("../config");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function toUsage(usage = {}) {
  const promptTokens = usage.prompt_tokens || 0;
  const completionTokens = usage.completion_tokens || 0;
  const totalTokens = usage.total_tokens || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

async function callGroq(prompt, model = config.models.cheap) {
  if (!config.groqApiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const start = Date.now();
  const response = await axios.post(
    GROQ_URL,
    {
      model,
      messages: [{ role: "user", content: prompt }]
    },
    {
      timeout: config.requestTimeoutMs,
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  const output =
    response.data?.choices?.[0]?.message?.content ||
    response.data?.choices?.[0]?.text ||
    "No response";

  return {
    ok: true,
    output,
    model,
    cost: 0,
    latency: Date.now() - start,
    usage: toUsage(response.data?.usage)
  };
}

module.exports = callGroq;
