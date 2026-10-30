const { Router } = require("express");
const { requireAuth } = require("../middleware/require-auth");
const {
  requireActive,
  requireAdmin,
  requireSuperAdmin,
} = require("../middleware/require-role");

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getTargetUser(client, id) {
  if (!client) return null;
  if (typeof client.from === "function") {
    const { data, error } = await client
      .from("profiles")
      .select("id, role, status")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      role: data.role || "User",
      status: data.status || "Active",
    };
  }
  return null;
}

function adminRoutes(arg1, arg2) {
  const router = Router();
  let admin, supabase;
  if (arg1 && (arg1.admin !== undefined || arg1.supabase !== undefined)) {
    admin = arg1.admin;
    supabase = arg1.supabase;
  } else {
    supabase = arg1;
    admin = arg2?.admin;
  }

  // 1. GET /api/admin/users
  router.get(
    "/users",
    requireAuth(supabase),
    requireActive(supabase, { admin }),
    requireAdmin(supabase, { admin }),
    async (_req, res) => {
      res.set("Cache-Control", "no-store");
      const client = admin || supabase;
      if (!client) {
        return res.status(503).json({
          error: "DATABASE_UNAVAILABLE",
          message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน",
        });
      }

      try {
        let users = [];
        if (typeof client.rpc === "function") {
          const { data, error } = await client.rpc("admin_list_users");
          if (error) throw error;
          users = data || [];
        } else if (typeof client.from === "function") {
          const { data, error } = await client
            .from("profiles")
            .select("id, username, role, status, updated_at");
          if (error) throw error;
          users = data || [];
        }

        const mapped = users.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email || null,
          role: u.role || "User",
          status: u.status || "Active",
          joinedAt:
            u.joined_at || u.joinedAt || u.created_at || u.updated_at || null,
        }));

        return res.json({ users: mapped });
      } catch {
        return res.status(500).json({
          error: "INTERNAL_ERROR",
          message: "ไม่สามารถดึงข้อมูลผู้ใช้ได้",
        });
      }
    },
  );

  // 2. PATCH /api/admin/users/:id/status
  router.patch(
    "/users/:id/status",
    requireAuth(supabase),
    requireActive(supabase, { admin }),
    requireAdmin(supabase, { admin }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      const { id } = req.params;
      const { status } = req.body || {};

      if (!UUID_REGEX.test(id) || !["Active", "InActive"].includes(status)) {
        return res.status(400).json({
          error: "INVALID_REQUEST",
          message: "ข้อมูลไม่ถูกต้อง",
        });
      }

      const client = admin || supabase;
      if (!client) {
        return res.status(503).json({
          error: "DATABASE_UNAVAILABLE",
          message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน",
        });
      }

      try {
        const target = await getTargetUser(client, id);
        if (!target) {
          return res.status(404).json({
            error: "NOT_FOUND",
            message: "ไม่พบผู้ใช้ที่ระบุ",
          });
        }

        const actorRole = req.userProfile?.role || "User";

        if (actorRole === "Admin") {
          if (target.role === "Admin" || target.role === "SuperAdmin") {
            return res.status(403).json({
              error: "FORBIDDEN",
              message: "Admin สามารถจัดการได้เฉพาะผู้ใช้ทั่วไป (User) เท่านั้น",
            });
          }
        } else if (actorRole === "SuperAdmin") {
          if (target.role === "SuperAdmin") {
            return res.status(400).json({
              error: "INVALID_OPERATION",
              message: "ไม่สามารถระงับบัญชี SuperAdmin ได้",
            });
          }
        }

        if (typeof client.from === "function") {
          const updateQuery = client.from("profiles").update({
            status,
            updated_at: new Date().toISOString(),
          });
          const { error } =
            typeof updateQuery.eq === "function"
              ? await updateQuery.eq("id", id)
              : await updateQuery;
          if (error) throw error;
        }

        return res.json({
          success: true,
          user: {
            id,
            status,
          },
        });
      } catch {
        return res.status(500).json({
          error: "INTERNAL_ERROR",
          message: "ไม่สามารถอัปเดตสถานะผู้ใช้ได้",
        });
      }
    },
  );

  // 3. PATCH /api/admin/users/:id/role
  router.patch(
    "/users/:id/role",
    requireAuth(supabase),
    requireActive(supabase, { admin }),
    requireSuperAdmin(supabase, { admin }),
    async (req, res) => {
      res.set("Cache-Control", "no-store");
      const { id } = req.params;
      const { role } = req.body || {};

      if (
        !UUID_REGEX.test(id) ||
        !["User", "Admin", "SuperAdmin"].includes(role)
      ) {
        return res.status(400).json({
          error: "INVALID_REQUEST",
          message: "ข้อมูลไม่ถูกต้อง",
        });
      }

      const client = admin || supabase;
      if (!client) {
        return res.status(503).json({
          error: "DATABASE_UNAVAILABLE",
          message: "ระบบฐานข้อมูลไม่พร้อมใช้งาน",
        });
      }

      try {
        const target = await getTargetUser(client, id);
        if (!target) {
          return res.status(404).json({
            error: "NOT_FOUND",
            message: "ไม่พบผู้ใช้ที่ระบุ",
          });
        }

        if (typeof client.from === "function") {
          const updateQuery = client.from("profiles").update({
            role,
            updated_at: new Date().toISOString(),
          });
          const { error } =
            typeof updateQuery.eq === "function"
              ? await updateQuery.eq("id", id)
              : await updateQuery;
          if (error) throw error;
        }

        return res.json({
          success: true,
          user: {
            id,
            role,
          },
        });
      } catch {
        return res.status(500).json({
          error: "INTERNAL_ERROR",
          message: "ไม่สามารถอัปเดตบทบาทผู้ใช้ได้",
        });
      }
    },
  );

  return router;
}

module.exports = { adminRoutes };
