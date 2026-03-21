const usageTotals = {
  requests: 0,
  totalCost: 0,
  totalLatencyMs: 0,
  byRoute: {
    cheap_model: 0,
    reasoning_model: 0
  }
};

function logUsage(entry) {
  usageTotals.requests += 1;
  usageTotals.totalCost += entry.cost;
  usageTotals.totalLatencyMs += entry.latency;
  usageTotals.byRoute[entry.route] = (usageTotals.byRoute[entry.route] || 0) + 1;

  console.log(
    JSON.stringify({
      type: "usage",
      requestId: entry.requestId,
      intent: entry.intent,
      route: entry.route,
      model: entry.model,
      cost: entry.cost,
      latencyMs: entry.latency,
      usage: entry.usage,
      totals: usageTotals
    })
  );
}

function getUsageTotals() {
  return JSON.parse(JSON.stringify(usageTotals));
}

function resetUsageTotals() {
  usageTotals.requests = 0;
  usageTotals.totalCost = 0;
  usageTotals.totalLatencyMs = 0;
  usageTotals.byRoute = {
    cheap_model: 0,
    reasoning_model: 0
  };
}

module.exports = logUsage;
module.exports.getUsageTotals = getUsageTotals;
module.exports.resetUsageTotals = resetUsageTotals;
