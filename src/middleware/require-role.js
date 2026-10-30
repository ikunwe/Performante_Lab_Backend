function profileUnavailable() {
  return new Error("PROFILE_UNAVAILABLE");
}

function validateProfile(data) {
  // A confirmed missing row is normal for a new account, unlike a failed query.
  if (data === null) return { role: "User", status: "Active" };
  if (
    !data ||
    !["User", "Admin", "SuperAdmin"].includes(data.role) ||
    !["Active", "InActive"].includes(data.status)
  )
    throw profileUnavailable();
  return { role: data.role, status: data.status };
}

async function resolveUserProfile(req, client) {
  if (req.userProfile) return req.userProfile;
  const userId = req.authUser?.id;
  if (!userId || !client) throw profileUnavailable();
  let result;
  try {
    if (typeof client.from === "function") {
      result = await client
        .from("profiles")
        .select("role, status")
        .eq("id", userId)
        .maybeSingle();
    } else if (typeof client.rpc === "function") {
      result = await client.rpc("get_user_role_and_status", {
        target_user_id: userId,
      });
    } else throw profileUnavailable();
  } catch {
    throw profileUnavailable();
  }
  if (!result || result.error || !Object.hasOwn(result, "data"))
    throw profileUnavailable();
  req.userProfile = validateProfile(result.data);
  return req.userProfile;
}

function roleGuard(allowedRoles, denied, { admin } = {}) {
  return async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.authUser)
      return res
        .status(401)
        .json({ error: "AUTH_REQUIRED", message: "กรุณาเข้าสู่ระบบ" });
    let profile;
    try {
      // The shared public-key auth client has no user's session for database RLS.
      // Only the private backend client may resolve authorization decisions.
      profile = await resolveUserProfile(req, admin);
    } catch {
      return res
        .status(503)
        .json({
          error: "PROFILE_UNAVAILABLE",
          message: "ตรวจสอบสถานะบัญชีไม่ได้ กรุณาลองใหม่",
        });
    }
    if (profile.status !== "Active")
      return res.status(403).json({
        error: "ACCOUNT_INACTIVE",
        message: "บัญชีนี้ถูกระงับการใช้งานชั่วคราว",
      });
    if (allowedRoles && !allowedRoles.includes(profile.role))
      return res.status(403).json(denied);
    return next();
  };
}

function requireActive(_supabase, options = {}) {
  return roleGuard(null, null, options);
}
function requireAdmin(_supabase, options = {}) {
  return roleGuard(
    ["Admin", "SuperAdmin"],
    {
      error: "FORBIDDEN",
      message: "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Admin)",
    },
    options,
  );
}
function requireSuperAdmin(_supabase, options = {}) {
  return roleGuard(
    ["SuperAdmin"],
    {
      error: "SUPER_ADMIN_REQUIRED",
      message: "ต้องใช้สิทธิ์ SuperAdmin เท่านั้น",
    },
    options,
  );
}
module.exports = {
  resolveUserProfile,
  requireActive,
  requireAdmin,
  requireSuperAdmin,
};
