async function resolveUserProfile(req, client) {
  if (req.userProfile) {
    return req.userProfile;
  }
  const userId = req.authUser?.id;
  if (!userId || !client) {
    const fallback = { role: "User", status: "Active" };
    req.userProfile = fallback;
    return fallback;
  }

  try {
    if (typeof client.from === "function") {
      const query = client.from("profiles");
      if (typeof query.select === "function") {
        const selected = query.select("role, status");
        const filtered =
          typeof selected.eq === "function" ? selected.eq("id", userId) : selected;
        const res =
          typeof filtered.maybeSingle === "function"
            ? await filtered.maybeSingle()
            : typeof filtered.single === "function"
              ? await filtered.single()
              : await filtered;
        if (!res?.error && res?.data) {
          req.userProfile = {
            role: res.data.role || "User",
            status: res.data.status || "Active",
          };
          return req.userProfile;
        }
      }
    }

    if (typeof client.rpc === "function") {
      const { data, error } = await client.rpc("get_user_role_and_status", {
        target_user_id: userId,
      });
      if (!error && data) {
        req.userProfile = {
          role: data.role || "User",
          status: data.status || "Active",
        };
        return req.userProfile;
      }
    }
  } catch {
    // Fallback safely to defaults on connection or query errors
  }

  const fallback = { role: "User", status: "Active" };
  req.userProfile = fallback;
  return fallback;
}

function requireActive(supabase, { admin } = {}) {
  const client = admin || supabase;
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.authUser) {
      return res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "กรุณาเข้าสู่ระบบ",
      });
    }
    const profile = await resolveUserProfile(req, client);
    if (profile.status === "InActive") {
      return res.status(403).json({
        error: "ACCOUNT_INACTIVE",
        message: "บัญชีนี้ถูกระงับการใช้งานชั่วคราว",
      });
    }
    return next();
  };
}

function requireAdmin(supabase, { admin } = {}) {
  const client = admin || supabase;
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.authUser) {
      return res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "กรุณาเข้าสู่ระบบ",
      });
    }
    const profile = await resolveUserProfile(req, client);
    if (profile.role !== "Admin" && profile.role !== "SuperAdmin") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Admin)",
      });
    }
    return next();
  };
}

function requireSuperAdmin(supabase, { admin } = {}) {
  const client = admin || supabase;
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.authUser) {
      return res.status(401).json({
        error: "AUTH_REQUIRED",
        message: "กรุณาเข้าสู่ระบบ",
      });
    }
    const profile = await resolveUserProfile(req, client);
    if (profile.role !== "SuperAdmin") {
      return res.status(403).json({
        error: "SUPER_ADMIN_REQUIRED",
        message: "ต้องใช้สิทธิ์ SuperAdmin เท่านั้น",
      });
    }
    return next();
  };
}

module.exports = {
  resolveUserProfile,
  requireActive,
  requireAdmin,
  requireSuperAdmin,
};

