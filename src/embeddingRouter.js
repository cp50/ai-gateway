const axios = require("axios");
const config = require("./config");
const callGroq = require("./providers/groq");

const DEFAULT_MODEL_CANDIDATES = ["text-embedding-004", "gemini-embedding-001"];
const configuredModels =
  process.env.EMBEDDING_MODEL_CANDIDATES ||
  process.env.EMBEDDING_MODEL ||
  DEFAULT_MODEL_CANDIDATES.join(",");
const EMBEDDING_MODELS = configuredModels
  .split(",")
  .map(m => m.trim())
  .filter(Boolean);
const EMBEDDING_BASE_URL =
  process.env.EMBEDDING_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/models";
const CONFIDENCE_THRESHOLD = 0.60;

const intentExamples = {
  greeting: [
    "hello",
    "hi",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
    "hey there",
    "hi assistant",
    "hello bot",
    "how are you",
    "what's up",
    "nice to meet you",
    "yo",
    "hiya",
    "greetings",
    "hello there",
    "morning",
    "hey assistant"
  ],
  summarization: [
    "summarize this article",
    "give me a summary",
    "summarize this document",
    "short summary of this text",
    "what is the summary of this paper",
    "summarize the following content",
    "compress this into key points",
    "tl dr this for me",
    "make this shorter",
    "briefly summarize this",
    "extract the main points",
    "can you provide a concise summary",
    "summarize this research paper",
    "give me an executive summary",
    "turn this into bullet summary",
    "summarize the transcript",
    "summarize this report",
    "one paragraph summary please"
  ],
  architecture_review: [
    "review this architecture",
    "evaluate this system design",
    "analyze microservices architecture",
    "check distributed system reliability",
    "is this architecture scalable",
    "give feedback on system architecture",
    "analyze this distributed architecture",
    "architecture design review",
    "review my backend architecture",
    "assess this solution architecture",
    "validate this cloud architecture",
    "suggest improvements for system design",
    "is this design resilient",
    "review event driven architecture",
    "analyze service boundaries",
    "check architecture bottlenecks",
    "review scalability and fault tolerance",
    "evaluate high level design"
  ],
  code_analysis: [
    "debug this code",
    "why does this code fail",
    "fix this programming error",
    "analyze this code",
    "review this code for issues",
    "find bug in this code",
    "why is this function not working",
    "trace this exception",
    "help me fix this stack trace",
    "optimize this code",
    "refactor this function",
    "find logical errors in this snippet",
    "identify bug in algorithm",
    "review this pull request code",
    "explain why this test fails",
    "help troubleshoot this code",
    "analyze runtime error",
    "check this script for bugs"
  ],
  simple_question: [
    "what is http caching",
    "explain javascript closures",
    "what does api mean",
    "how does http work",
    "explain recursion",
    "what is distributed computing",
    "what is an event loop",
    "difference between stack and queue",
    "what is a database index",
    "how dns works",
    "what is oauth",
    "explain rest api",
    "what is latency",
    "how does load balancing work",
    "what is a microservice",
    "what is async await",
    "explain object oriented programming",
    "what is ci cd"
  ]
};

const ALLOWED_INTENTS = Object.keys(intentExamples);

let activeEmbeddingModel = null;
let exampleEmbeddingIndex = null;
let initPromise = null;

function dotProduct(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i] * b[i];
  }
  return total;
}

function magnitude(v) {
  return Math.sqrt(dotProduct(v, v));
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return -1;
  }

  const denom = magnitude(a) * magnitude(b);
  if (!Number.isFinite(denom) || denom === 0) {
    return -1;
  }

  return dotProduct(a, b) / denom;
}

function getEmbeddingValues(payload) {
  return payload?.embedding?.values || payload?.embeddings?.[0]?.values || null;
}

async function embedTextWithModel(model, text) {
  if (!config.googleApiKey) {
    throw new Error("GOOGLE_API_KEY is not configured");
  }

  const response = await axios.post(
    `${EMBEDDING_BASE_URL}/${model}:embedContent?key=${config.googleApiKey}`,
    {
      content: {
        parts: [{ text }]
      }
    },
    {
      timeout: config.requestTimeoutMs
    }
  );

  const values = getEmbeddingValues(response.data);
  if (!values) {
    throw new Error(`Embedding API returned no vector for model ${model}`);
  }

  return values;
}

async function selectActiveModel() {
  if (activeEmbeddingModel) {
    return activeEmbeddingModel;
  }

  const errors = [];
  for (const model of EMBEDDING_MODELS) {
    try {
      await embedTextWithModel(model, "embedding router warmup");
      activeEmbeddingModel = model;
      console.log(`Embedding router using model: ${model}`);
      return model;
    } catch (error) {
      const detail = error.response?.data?.error?.message || error.message;
      errors.push(`${model}: ${detail}`);
    }
  }

  throw new Error(`No embedding model available. Attempts: ${errors.join(" | ")}`);
}

async function buildExampleEmbeddingIndex() {
  const model = await selectActiveModel();
  const index = {};

  for (const intent of ALLOWED_INTENTS) {
    index[intent] = [];
    for (const example of intentExamples[intent]) {
      const vector = await embedTextWithModel(model, example);
      index[intent].push({ example, vector });
    }
  }

  return index;
}

async function prewarmIntentEmbeddings() {
  if (exampleEmbeddingIndex) {
    return;
  }

  if (!initPromise) {
    initPromise = buildExampleEmbeddingIndex()
      .then(index => {
        exampleEmbeddingIndex = index;
      })
      .finally(() => {
        initPromise = null;
      });
  }

  await initPromise;
}

function normalizeIntentLabel(text) {
  const lower = String(text || "").trim().toLowerCase();
  if (ALLOWED_INTENTS.includes(lower)) {
    return lower;
  }

  for (const label of ALLOWED_INTENTS) {
    if (lower.includes(label)) {
      return label;
    }
  }

  return "simple_question";
}

async function classifyIntentWithLLM(message) {
  const prompt = `Classify the user request into one of these categories:\n\n` +
    `greeting\n` +
    `summarization\n` +
    `architecture_review\n` +
    `code_analysis\n` +
    `simple_question\n\n` +
    `Return ONLY the label.\n\n` +
    `User request:\n${message}`;

  const result = await callGroq(prompt, config.models.classifier);
  if (!result.ok) {
    return { intent: "simple_question" };
  }

  return {
    intent: normalizeIntentLabel(result.output)
  };
}

async function detectIntentEmbedding(message) {
  await prewarmIntentEmbeddings();

  const queryVector = await embedTextWithModel(activeEmbeddingModel, message);
  let bestIntent = "simple_question";
  let bestScore = -1;

  for (const intent of ALLOWED_INTENTS) {
    const vectors = exampleEmbeddingIndex[intent] || [];
    if (vectors.length === 0) {
      continue;
    }

    let sum = 0;
    for (const item of vectors) {
      sum += cosineSimilarity(queryVector, item.vector);
    }

    const averageScore = sum / vectors.length;
    if (averageScore > bestScore) {
      bestScore = averageScore;
      bestIntent = intent;
    }
  }

  const confidence = Number(bestScore.toFixed(4));
  if (bestScore < CONFIDENCE_THRESHOLD) {
    return {
      intent: bestIntent,
      confidence,
      uncertain: true
    };
  }

  return {
    intent: bestIntent,
    confidence,
    uncertain: false
  };
}

module.exports = {
  detectIntentEmbedding,
  classifyIntentWithLLM,
  prewarmIntentEmbeddings,
  cosineSimilarity,
  intentExamples
};

