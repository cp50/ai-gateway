const config = require("./config");
const { getHealth, getHealthScore } = require("./metricsStore");

const CHEAP_ROUTE_SWITCH_THRESHOLD = 300;
const REASONING_ROUTE_SWITCH_THRESHOLD = 2500;

function isComplexPrompt(message) {
  if (!message) return false;

  const wordCount = message.split(/\s+/).length;

  if (wordCount > 30) return true;

  const complexKeywords = [
    "analyze",
    "compare",
    "architecture",
    "design",
    "equation",
    "algorithm",
    "theory",
    "detailed",
    "step by step",
    "implementation",
    "system design"
  ];

  const lower = message.toLowerCase();

  for (const keyword of complexKeywords) {
    if (lower.includes(keyword)) {
      return true;
    }
  }

  return false;
}

function routeIntent(intent, message) {
  if (intent === "architecture_review" || intent === "code_analysis") {
    return "reasoning_model";
  }

  if (isComplexPrompt(message)) {
    return "reasoning_model";
  }

  return "cheap_model";
}

function getPreferencePair(route) {
  if (route === "reasoning_model") {
    return { preferred: config.models.reasoning, alternative: config.models.cheap };
  }
  return { preferred: config.models.cheap, alternative: config.models.reasoning };
}

function healthReason(preferredHealth, alternativeHealth) {
  if (alternativeHealth.failures < preferredHealth.failures) {
    return "lower_failure_rate";
  }
  return "lower_latency";
}

function shouldUseAlternative(route, preferredHealth, alternativeHealth, preferredScore, alternativeScore) {
  if (route === "reasoning_model") {
    if (preferredHealth.failures === 0 && preferredHealth.avgLatency > 0) {
      return false;
    }

    return alternativeScore + REASONING_ROUTE_SWITCH_THRESHOLD < preferredScore;
  }

  return alternativeScore + CHEAP_ROUTE_SWITCH_THRESHOLD < preferredScore;
}

function chooseModelForRoute(route) {
  const { preferred, alternative } = getPreferencePair(route);
  const preferredHealth = getHealth(preferred);
  const alternativeHealth = getHealth(alternative);

  // Cold start safety: preserve existing route mapping until metrics are available.
  if (preferredHealth.requests === 0 || alternativeHealth.requests === 0) {
    return preferred;
  }

  const preferredScore = getHealthScore(preferred);
  const alternativeScore = getHealthScore(alternative);

  if (shouldUseAlternative(route, preferredHealth, alternativeHealth, preferredScore, alternativeScore)) {
    console.log({
      type: "health_routing",
      chosenModel: alternative,
      reason: healthReason(preferredHealth, alternativeHealth),
      route,
      preferredScore,
      alternativeScore
    });
    return alternative;
  }

  return preferred;
}

module.exports = routeIntent;
module.exports.isComplexPrompt = isComplexPrompt;
module.exports.chooseModelForRoute = chooseModelForRoute;
