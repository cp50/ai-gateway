const intents = {
  greeting: ["hi", "hello", "hey"],
  summarization: ["summarize", "summary"],
  architecture_review: ["architecture", "design", "microservices"],
  code_analysis: ["debug", "fix code", "error"]
};

function containsWord(text, word) {
  const regex = new RegExp(`\\b${word}\\b`, "i");
  return regex.test(text);
}

function detectIntent(text) {
  text = text.toLowerCase();

  if (intents.greeting.some(word => containsWord(text, word))) return "greeting";
  if (intents.summarization.some(word => text.includes(word))) return "summarization";
  if (intents.architecture_review.some(word => text.includes(word))) return "architecture_review";
  if (intents.code_analysis.some(word => text.includes(word))) return "code_analysis";

  return "simple_question";
}

module.exports = detectIntent;