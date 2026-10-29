const { Router } = require("express");
const { requireAuth } = require("../middleware/require-auth");
const { rateLimit } = require("express-rate-limit");

function authRoutes(supabase, { admin, createAuthClient } = {}) {
  const router = Router();
  router.post(
    "/login",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: "TOO_MANY_ATTEMPTS",
        message: "ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที",
      },
    }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      const username =
        typeof req.body?.username === "string" ? req.body.username.trim() : "";
      const password = req.body?.password;
      const invalid = () =>
        res.status(401).json({
          error: "INVALID_CREDENTIALS",
          message: "Username หรือรหัสผ่านไม่ถูกต้อง",
        });
      if (
        !username ||
        [...username].length > 64 ||
        /[\u0000-\u001f\u007f-\u009f@]/.test(username) ||
        typeof password !== "string" ||
        !password ||
        password.length > 128
      )
        return invalid();
      if (!admin || !createAuthClient)
        return res.status(503).json({
          error: "USERNAME_LOGIN_NOT_CONFIGURED",
          message:
            "ยังไม่ได้เปิดใช้ Username Login ที่ Backend กรุณาใช้ Google หรืออีเมลเข้าสู่ระบบ",
        });
      try {
        const profile = await admin.rpc("find_username_account", {
          input_username: username,
        });
        if (profile.error) throw profile.error;
        if (!profile.data) return invalid();
        const { data: account, error: lookupError } =
          await admin.auth.admin.getUserById(profile.data);
        if (lookupError || !account.user?.email) return invalid();
        // A fresh public-key client per request prevents sharing sessions between users.
        const client = createAuthClient();
        if (!client) throw new Error("config");
        const { data, error } = await client.auth.signInWithPassword({
          email: account.user.email,
          password,
        });
        if (error || !data.session) return invalid();
        return res.json({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
      } catch {
        return res.status(503).json({
          error: "AUTH_UNAVAILABLE",
          message: "ระบบเข้าสู่ระบบไม่พร้อมใช้งาน กรุณาลองใหม่",
        });
      }
    },
  );
  router.get("/me", requireAuth(supabase), (req, res) => {
    const user = req.authUser;
    res.json({
      user: {
        id: user.id,
        email: user.email || null,
        name: user.user_metadata?.full_name || user.email || "Account",
        avatarUrl: user.user_metadata?.avatar_url || null,
      },
    });
  });
  return router;
}

module.exports = { authRoutes };
