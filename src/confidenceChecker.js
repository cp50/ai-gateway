/**
 * Determines if the cheap model response is low confidence
 * and whether we should escalate to the reasoning model.
 */
function isLowConfidence(responseText, intent) {
  // ✅ Never escalate greetings
  if (intent === "greeting") return false;

  // ✅ Force escalation for complex intents
  const forceEscalationIntents = ["architecture_review", "code_analysis"];
  if (forceEscalationIntents.includes(intent)) return true;

  const lowConfidenceIndicators = [
    "i'm not sure",
    "cannot determine",
    "insufficient information",
    "it depends",
    "unclear",
    "as an ai",
    "i do not have enough information"
  ];

  // ❗ Very short responses are often low quality (except simple questions)
  if (!responseText || responseText.length < 40) {
    return intent !== "simple_question";
  }

  const text = responseText.toLowerCase();

  return lowConfidenceIndicators.some(phrase => text.includes(phrase));
}

module.exports = isLowConfidence;