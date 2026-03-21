function authenticateAdmin(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const providedKey = match ? match[1].trim() : "";
  const expectedKey = String(process.env.ADMIN_API_KEY || "").trim();

  if (!providedKey || !expectedKey || providedKey !== expectedKey) {
    return res.status(401).json({
      error: "Unauthorized",
      code: "UNAUTHORIZED"
    });
  }

  return next();
}

module.exports = {
  authenticateAdmin
};
