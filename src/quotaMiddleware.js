function toLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function enforceTenantQuota(req, res, next) {
  const tenant = req.tenant || {};

  if (Number(tenant.requestsToday || 0) >= toLimit(tenant.maxRequestsPerDay)) {
    return res.status(429).json({
      error: "Request quota exceeded",
      code: "QUOTA_EXCEEDED"
    });
  }

  if (Number(tenant.totalTokens || 0) >= toLimit(tenant.maxTokensPerDay)) {
    return res.status(429).json({
      error: "Token quota exceeded",
      code: "QUOTA_EXCEEDED"
    });
  }

  if (Number(tenant.totalCost || 0) >= toLimit(tenant.maxCostPerDay)) {
    return res.status(429).json({
      error: "Cost quota exceeded",
      code: "QUOTA_EXCEEDED"
    });
  }

  return next();
}

module.exports = {
  enforceTenantQuota
};
