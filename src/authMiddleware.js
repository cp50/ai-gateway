const { getTenantByApiKey } = require("./tenantStore");

async function authenticateRequest(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return res.status(401).json({
      error: "Unauthorized",
      code: "UNAUTHORIZED"
    });
  }

  const apiKey = match[1].trim();
  const tenant = await getTenantByApiKey(apiKey);

  if (!tenant) {
    return res.status(401).json({
      error: "Unauthorized",
      code: "UNAUTHORIZED"
    });
  }

  req.tenant = tenant;
  return next();
}

module.exports = {
  authenticateRequest
};
