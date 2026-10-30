const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { requireAuth } = require("../src/middleware/require-auth");
const {
  requireActive,
  requireAdmin,
  requireSuperAdmin,
} = require("../src/middleware/require-role");

function createMockSupabase({
  user = {
    id: "user-uuid-1",
    email: "driver@example.com",
    user_metadata: { full_name: "Driver" },
  },
  role,
  status,
  useRpc = false,
} = {}) {
  const client = {
    auth: {
      getUser: async (token) => {
        if (token === "valid-token") {
          return { data: { user }, error: null };
        }
        return { data: { user: null }, error: { status: 401 } };
      },
    },
  };

  if (useRpc) {
    client.rpc = async (name, args) => {
      if (name === "get_user_role_and_status") {
        if (role === null && status === null) {
          return { data: null, error: null };
        }
        return {
          data: {
            role: role || "User",
            status: status || "Active",
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
  } else {
    client.from = (table) => {
      assert.equal(table, "profiles");
      return {
        select: () => ({
          eq: (field, id) => {
            assert.equal(field, "id");
            assert.equal(id, user.id);
            return {
              maybeSingle: async () => {
                if (role === null && status === null) {
                  return { data: null, error: null };
                }
                return {
                  data: {
                    role: role || "User",
                    status: status || "Active",
                  },
                  error: null,
                };
              },
            };
          },
        }),
      };
    };
  }

  return client;
}

async function serveApp(t, { supabase, admin = supabase } = {}) {
  const app = createApp({
    supabase,
    admin,
    origins: ["http://localhost:4200"],
    routes: (serverApp) => {
      serverApp.get("/api/admin/probe", (_req, res) => res.json({ ok: true }));
      serverApp.get("/api/super-admin/probe", (_req, res) =>
        res.json({ ok: true }),
      );
      serverApp.get(
        "/api/test/active-only",
        requireAuth(supabase),
        requireActive(supabase, { admin }),
        (req, res) => res.json({ ok: true, profile: req.userProfile }),
      );

      serverApp.get(
        "/api/test/admin-only",
        requireAuth(supabase),
        requireActive(supabase, { admin }),
        requireAdmin(supabase, { admin }),
        (req, res) => res.json({ ok: true, profile: req.userProfile }),
      );

      serverApp.get(
        "/api/test/super-admin-only",
        requireAuth(supabase),
        requireActive(supabase, { admin }),
        requireSuperAdmin(supabase, { admin }),
        (req, res) => res.json({ ok: true, profile: req.userProfile }),
      );
    },
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("GET /api/auth/me returns role and status from profile", async (t) => {
  const supabase = createMockSupabase({ role: "Admin", status: "Active" });
  const base = await serveApp(t, { supabase });

  const res = await fetch(`${base}/api/auth/me`, {
    headers: { authorization: "Bearer valid-token" },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const data = await res.json();
  assert.equal(data.user.role, "Admin");
  assert.equal(data.user.status, "Active");
});

test("GET /api/auth/me returns default role 'User' and status 'Active' when profile is missing", async (t) => {
  const supabase = createMockSupabase({ role: null, status: null });
  const base = await serveApp(t, { supabase });

  const res = await fetch(`${base}/api/auth/me`, {
    headers: { authorization: "Bearer valid-token" },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const data = await res.json();
  assert.equal(data.user.role, "User");
  assert.equal(data.user.status, "Active");
});

test("requireActive allows active users and blocks inactive users", async (t) => {
  // 1. Active user
  {
    const supabase = createMockSupabase({ role: "User", status: "Active" });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/active-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.profile.status, "Active");
  }

  // 2. Inactive user
  {
    const supabase = createMockSupabase({ role: "User", status: "InActive" });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/active-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.deepEqual(json, {
      error: "ACCOUNT_INACTIVE",
      message: "บัญชีนี้ถูกระงับการใช้งานชั่วคราว",
    });
  }
});

test("requireAdmin allows Admin and SuperAdmin, rejects User", async (t) => {
  // 1. User with 'Admin' role
  {
    const supabase = createMockSupabase({ role: "Admin", status: "Active" });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/admin-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.profile.role, "Admin");
  }

  // 2. User with 'SuperAdmin' role
  {
    const supabase = createMockSupabase({
      role: "SuperAdmin",
      status: "Active",
    });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/admin-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.profile.role, "SuperAdmin");
  }

  // 3. User with 'User' role
  {
    const supabase = createMockSupabase({ role: "User", status: "Active" });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/admin-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.deepEqual(json, {
      error: "FORBIDDEN",
      message: "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้ (เฉพาะ Admin)",
    });
  }
});

test("requireSuperAdmin allows SuperAdmin, rejects Admin and User", async (t) => {
  // 1. SuperAdmin
  {
    const supabase = createMockSupabase({
      role: "SuperAdmin",
      status: "Active",
    });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/super-admin-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.profile.role, "SuperAdmin");
  }

  // 2. Admin (should be rejected)
  {
    const supabase = createMockSupabase({ role: "Admin", status: "Active" });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/super-admin-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.deepEqual(json, {
      error: "SUPER_ADMIN_REQUIRED",
      message: "ต้องใช้สิทธิ์ SuperAdmin เท่านั้น",
    });
  }

  // 3. User (should be rejected)
  {
    const supabase = createMockSupabase({ role: "User", status: "Active" });
    const base = await serveApp(t, { supabase });

    const res = await fetch(`${base}/api/test/super-admin-only`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const json = await res.json();
    assert.deepEqual(json, {
      error: "SUPER_ADMIN_REQUIRED",
      message: "ต้องใช้สิทธิ์ SuperAdmin เท่านั้น",
    });
  }
});

test("Protected routes always set Cache-Control: no-store", async (t) => {
  const supabase = createMockSupabase({ role: "User", status: "InActive" });
  const base = await serveApp(t, { supabase });

  for (const path of [
    "/api/auth/me",
    "/api/test/active-only",
    "/api/test/admin-only",
    "/api/test/super-admin-only",
  ]) {
    const res = await fetch(`${base}${path}`, {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(
      res.headers.get("cache-control"),
      "no-store",
      `Expected no-store on ${path}`,
    );
  }
});

test("RBAC middlewares and /api/auth/me work with RPC lookup helper", async (t) => {
  const supabase = createMockSupabase({
    role: "Admin",
    status: "Active",
    useRpc: true,
  });
  const base = await serveApp(t, { supabase });

  const res = await fetch(`${base}/api/auth/me`, {
    headers: { authorization: "Bearer valid-token" },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.user.role, "Admin");
  assert.equal(json.user.status, "Active");
});

test("profile lookup failures, malformed states and missing private client fail closed", async (t) => {
  for (const failure of [
    "query-error",
    "throw",
    "invalid-role",
    "invalid-status",
    "missing-admin",
  ]) {
    const supabase = createMockSupabase({
      role: "SuperAdmin",
      status: "Active",
    });
    const admin =
      failure === "missing-admin"
        ? null
        : {
            from: () => ({
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    if (failure === "throw")
                      throw new Error("private-database-detail");
                    if (failure === "query-error")
                      return {
                        data: null,
                        error: { message: "private-database-detail" },
                      };
                    return {
                      data: {
                        role: failure === "invalid-role" ? "root" : "Admin",
                        status:
                          failure === "invalid-status" ? "unknown" : "Active",
                      },
                      error: null,
                    };
                  },
                }),
              }),
            }),
            // A failed authoritative read must not silently fall back to another lookup.
            rpc: async () =>
              assert.fail("must not bypass the failed profile query"),
          };
    const base = await serveApp(t, { supabase, admin });
    for (const path of [
      "/api/auth/me",
      "/api/admin/probe",
      "/api/super-admin/probe",
    ]) {
      const res = await fetch(base + path, {
        headers: { authorization: "Bearer valid-token" },
      });
      assert.equal(res.status, 503, failure + path);
      assert.equal(res.headers.get("cache-control"), "no-store");
      const body = await res.json();
      assert.equal(body.error, "PROFILE_UNAVAILABLE");
      assert.ok(!JSON.stringify(body).includes("private-database-detail"));
    }
  }
});

test("production admin prefixes enforce roles and suspension before extension handlers", async (t) => {
  for (const [role, status, expectedAdmin, expectedSuper] of [
    ["User", "Active", 403, 403],
    ["Admin", "Active", 200, 403],
    ["SuperAdmin", "Active", 200, 200],
    ["Admin", "InActive", 403, 403],
    ["SuperAdmin", "InActive", 403, 403],
  ]) {
    const base = await serveApp(t, {
      supabase: createMockSupabase({ role, status }),
    });
    for (const [path, expected] of [
      ["/api/admin/probe", expectedAdmin],
      ["/api/super-admin/probe", expectedSuper],
    ]) {
      const res = await fetch(base + path, {
        headers: { authorization: "Bearer valid-token" },
      });
      assert.equal(res.status, expected, role + status + path);
      if (status === "InActive")
        assert.equal((await res.json()).error, "ACCOUNT_INACTIVE");
    }
    const me = await fetch(base + "/api/auth/me", {
      headers: { authorization: "Bearer valid-token" },
    });
    assert.equal(me.status, status === "Active" ? 200 : 403);
  }
  const base = await serveApp(t, { supabase: createMockSupabase() });
  assert.equal((await fetch(base + "/api/admin/probe")).status, 401);
});

test("RPC errors do not synthesize an active profile", async (t) => {
  const supabase = createMockSupabase();
  const admin = {
    rpc: async () => ({ data: null, error: { message: "private-rpc-error" } }),
  };
  const base = await serveApp(t, { supabase, admin });
  const res = await fetch(base + "/api/auth/me", {
    headers: { authorization: "Bearer valid-token" },
  });
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "PROFILE_UNAVAILABLE");
});
