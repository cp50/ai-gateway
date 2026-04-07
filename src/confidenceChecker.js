const config = require("./config");

const UNCERTAINTY_PHRASES = [
  { text: "i'm not sure", weight: 0.3 },
  { text: "cannot determine", weight: 0.35 },
  { text: "insufficient information", weight: 0.3 },
  { text: "it depends", weight: 0.15 },
  { text: "unclear", weight: 0.2 },
  { text: "as an ai", weight: 0.25 },
  { text: "i do not have enough information", weight: 0.35 },
  { text: "i cannot", weight: 0.2 },
  { text: "not enough context", weight: 0.25 },
  { text: "hard to say", weight: 0.15 },
];

const COMPLEX_INTENTS = ["architecture_review", "code_analysis"];

function computeConfidence(responseText, intent) {
  if (intent === "greeting") return 1.0;

  let score = 1.0;

  if (!responseText || responseText.trim().length === 0) {
    score -= 0.6;
  } else if (responseText.length < 40) {
    if (intent === "simple_question") {
      score -= 0.1;
    } else if (COMPLEX_INTENTS.includes(intent)) {
      score -= 0.5;
    } else {
      score -= 0.3;
    }
  } else if (COMPLEX_INTENTS.includes(intent) && responseText.length < 150) {
    score -= 0.25;
  }

  const lower = (responseText || "").toLowerCase();
  for (const { text, weight } of UNCERTAINTY_PHRASES) {
    if (lower.includes(text)) {
      score -= weight;
    }
  }

  return Math.max(0, Math.round(score * 100) / 100);
}

function isLowConfidence(responseText, intent) {
  const score = computeConfidence(responseText, intent);
  return score < config.confidenceThreshold;
}

module.exports = isLowConfidence;
module.exports.computeConfidence = computeConfidence;
