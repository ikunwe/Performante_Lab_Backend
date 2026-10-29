function requireAuth(supabase) {
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const match = /^Bearer ([^\s]+)$/i.exec(req.get("authorization") || "");
    if (!match)
      return res
        .status(401)
        .json({ error: "AUTH_REQUIRED", message: "กรุณาเข้าสู่ระบบ" });
    if (!supabase)
      return res
        .status(503)
        .json({
          error: "AUTH_NOT_CONFIGURED",
          message: "ยังไม่ได้ตั้งค่า Supabase ใน Backend",
        });
    try {
      // Validate against Supabase Auth, never trust a decoded JWT or a client-supplied user ID.
      const { data, error } = await supabase.auth.getUser(match[1]);
      if (error) {
        const unavailable = !error.status || error.status >= 500;
        return res
          .status(unavailable ? 503 : 401)
          .json({
            error: unavailable ? "AUTH_UNAVAILABLE" : "INVALID_TOKEN",
            message: unavailable
              ? "ระบบยืนยันตัวตนไม่พร้อมใช้งาน"
              : "เซสชันหมดอายุหรือไม่ถูกต้อง",
          });
      }
      if (!data?.user)
        return res
          .status(401)
          .json({
            error: "INVALID_TOKEN",
            message: "เซสชันหมดอายุหรือไม่ถูกต้อง",
          });
      req.authUser = data.user;
      return next();
    } catch {
      return res
        .status(503)
        .json({
          error: "AUTH_UNAVAILABLE",
          message: "ระบบยืนยันตัวตนไม่พร้อมใช้งาน",
        });
    }
  };
}

module.exports = { requireAuth };
