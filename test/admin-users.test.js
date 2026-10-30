const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");

function createMockBackend({
  actor = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "actor@example.com",
    role: "Admin",
    status: "Active",
  },
  dbUsers = [],
} = {}) {
  const profilesMap = new Map();

  profilesMap.set(actor.id, {
    id: actor.id,
    username: "actor_user",
    role: actor.role,
    status: actor.status,
    email: actor.email,
    joined_at: "2026-10-30T10:00:00.000Z",
  });

  for (const u of dbUsers) {
    profilesMap.set(u.id, {
      id: u.id,
      username: u.username || "test_user",
      role: u.role || "User",
      status: u.status || "Active",
      email: u.email || `${u.username || "test"}@example.com`,
      joined_at: u.joined_at || "2026-10-30T12:00:00.000Z",
    });
  }

  const queryHandler = {
    select: () => ({
      eq: (_field, id) => ({
        maybeSingle: async () => {
          const p = profilesMap.get(id);
          return { data: p ? { ...p } : null, error: null };
        },
      }),
    }),
    update: (updates) => ({
      eq: async (_field, id) => {
        const p = profilesMap.get(id);
        if (p) {
          Object.assign(p, updates);
        }
        return { data: p ? { ...p } : null, error: null };
      },
    }),
  };

  const supabase = {
    auth: {
      getUser: async (token) => {
        if (token === "valid-token") {
          return {
            data: {
              user: {
                id: actor.id,
                email: actor.email,
                user_metadata: { full_name: "Actor Name" },
              },
            },
            error: null,
          };
        }
        return { data: { user: null }, error: { status: 401 } };
      },
    },
    from: (table) => {
      assert.equal(table, "profiles");
      return queryHandler;
    },
    rpc: async (name) => {
      if (name === "admin_list_users") {
        return {
          data: Array.from(profilesMap.values()).map((p) => ({
            id: p.id,
            username: p.username,
            email: p.email,
            role: p.role,
            status: p.status,
            joined_at: p.joined_at,
          })),
          error: null,
        };
      }
      return { data: null, error: null };
    },
  };

  const admin = {
    ...supabase,
    from: (table) => {
      assert.equal(table, "profiles");
      return queryHandler;
    },
  };

  return { supabase, admin, profilesMap };
}

async function serveApp(t, { supabase, admin }) {
  const app = createApp({
    supabase,
    admin,
    origins: ["http://localhost:4200"],
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("GET /api/admin/users rejects normal User (403 FORBIDDEN)", async (t) => {
  const { supabase, admin } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "user@example.com",
      role: "User",
      status: "Active",
    },
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users`, {
    headers: { authorization: "Bearer valid-token" },
  });

  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const json = await res.json();
  assert.equal(json.error, "FORBIDDEN");
});

test("GET /api/admin/users permits Admin/SuperAdmin and returns users with actual email (200 OK)", async (t) => {
  const targetUser = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "driver1",
    email: "driver1@gmail.com",
    role: "User",
    status: "Active",
  };
  const { supabase, admin } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "admin@example.com",
      role: "Admin",
      status: "Active",
    },
    dbUsers: [targetUser],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users`, {
    headers: { authorization: "Bearer valid-token" },
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const json = await res.json();
  assert.ok(Array.isArray(json.users));
  assert.equal(json.users.length, 2);

  const foundTarget = json.users.find((u) => u.id === targetUser.id);
  assert.ok(foundTarget);
  assert.equal(foundTarget.username, "driver1");
  assert.equal(foundTarget.email, "driver1@gmail.com");
  assert.equal(foundTarget.role, "User");
  assert.equal(foundTarget.status, "Active");
  assert.ok(foundTarget.joinedAt);
});

test("PATCH /api/admin/users/:id/status allows Admin to suspend User (200 OK)", async (t) => {
  const targetUser = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "target_user",
    role: "User",
    status: "Active",
  };
  const { supabase, admin, profilesMap } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "Admin",
      status: "Active",
    },
    dbUsers: [targetUser],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users/${targetUser.id}/status`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "InActive" }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const json = await res.json();
  assert.deepEqual(json, {
    success: true,
    user: {
      id: targetUser.id,
      status: "InActive",
    },
  });
  assert.equal(profilesMap.get(targetUser.id).status, "InActive");
});

test("PATCH /api/admin/users/:id/status rejects Admin trying to suspend another Admin (403 FORBIDDEN)", async (t) => {
  const otherAdmin = {
    id: "33333333-3333-4333-8333-333333333333",
    username: "other_admin",
    role: "Admin",
    status: "Active",
  };
  const { supabase, admin } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "Admin",
      status: "Active",
    },
    dbUsers: [otherAdmin],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users/${otherAdmin.id}/status`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "InActive" }),
  });

  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, "FORBIDDEN");
  assert.equal(
    json.message,
    "Admin สามารถจัดการได้เฉพาะผู้ใช้ทั่วไป (User) เท่านั้น",
  );
});

test("PATCH /api/admin/users/:id/status rejects Admin trying to suspend SuperAdmin (403 FORBIDDEN)", async (t) => {
  const superAdmin = {
    id: "44444444-4444-4444-8444-444444444444",
    username: "super_admin",
    role: "SuperAdmin",
    status: "Active",
  };
  const { supabase, admin } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "Admin",
      status: "Active",
    },
    dbUsers: [superAdmin],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users/${superAdmin.id}/status`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "InActive" }),
  });

  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, "FORBIDDEN");
  assert.equal(
    json.message,
    "Admin สามารถจัดการได้เฉพาะผู้ใช้ทั่วไป (User) เท่านั้น",
  );
});

test("PATCH /api/admin/users/:id/status allows SuperAdmin to suspend Admin (200 OK)", async (t) => {
  const targetAdmin = {
    id: "33333333-3333-4333-8333-333333333333",
    username: "target_admin",
    role: "Admin",
    status: "Active",
  };
  const { supabase, admin, profilesMap } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "SuperAdmin",
      status: "Active",
    },
    dbUsers: [targetAdmin],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users/${targetAdmin.id}/status`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "InActive" }),
  });

  assert.equal(res.status, 200);
  const json = await res.json();
  assert.deepEqual(json, {
    success: true,
    user: {
      id: targetAdmin.id,
      status: "InActive",
    },
  });
  assert.equal(profilesMap.get(targetAdmin.id).status, "InActive");
});

test("PATCH /api/admin/users/:id/status rejects SuperAdmin trying to suspend SuperAdmin (400 INVALID_OPERATION)", async (t) => {
  const otherSuperAdmin = {
    id: "55555555-5555-4555-8555-555555555555",
    username: "other_super_admin",
    role: "SuperAdmin",
    status: "Active",
  };
  const { supabase, admin } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "SuperAdmin",
      status: "Active",
    },
    dbUsers: [otherSuperAdmin],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(
    `${base}/api/admin/users/${otherSuperAdmin.id}/status`,
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "InActive" }),
    },
  );

  assert.equal(res.status, 400);
  const json = await res.json();
  assert.equal(json.error, "INVALID_OPERATION");
  assert.equal(json.message, "ไม่สามารถระงับบัญชี SuperAdmin ได้");
});

test("PATCH /api/admin/users/:id/role rejects Admin from changing Role (403 SUPER_ADMIN_REQUIRED)", async (t) => {
  const targetUser = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "target_user",
    role: "User",
    status: "Active",
  };
  const { supabase, admin } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "Admin",
      status: "Active",
    },
    dbUsers: [targetUser],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users/${targetUser.id}/role`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "Admin" }),
  });

  assert.equal(res.status, 403);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const json = await res.json();
  assert.equal(json.error, "SUPER_ADMIN_REQUIRED");
});

test("PATCH /api/admin/users/:id/role permits SuperAdmin to change User's role to Admin (200 OK)", async (t) => {
  const targetUser = {
    id: "22222222-2222-4222-8222-222222222222",
    username: "target_user",
    role: "User",
    status: "Active",
  };
  const { supabase, admin, profilesMap } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "SuperAdmin",
      status: "Active",
    },
    dbUsers: [targetUser],
  });
  const base = await serveApp(t, { supabase, admin });

  const res = await fetch(`${base}/api/admin/users/${targetUser.id}/role`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "Admin" }),
  });

  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const json = await res.json();
  assert.deepEqual(json, {
    success: true,
    user: {
      id: targetUser.id,
      role: "Admin",
    },
  });
  assert.equal(profilesMap.get(targetUser.id).role, "Admin");
});

test("Admin endpoints reject invalid UUIDs or payloads (400 INVALID_REQUEST)", async (t) => {
  const { supabase, admin } = createMockBackend({
    actor: {
      id: "11111111-1111-4111-8111-111111111111",
      role: "SuperAdmin",
      status: "Active",
    },
  });
  const base = await serveApp(t, { supabase, admin });

  // Invalid UUID
  const resBadId = await fetch(`${base}/api/admin/users/invalid-uuid/status`, {
    method: "PATCH",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ status: "Active" }),
  });
  assert.equal(resBadId.status, 400);

  // Invalid Status value
  const resBadStatus = await fetch(
    `${base}/api/admin/users/22222222-2222-4222-8222-222222222222/status`,
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "Unknown" }),
    },
  );
  assert.equal(resBadStatus.status, 400);

  // Invalid Role value
  const resBadRole = await fetch(
    `${base}/api/admin/users/22222222-2222-4222-8222-222222222222/role`,
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer valid-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ role: "Hacker" }),
    },
  );
  assert.equal(resBadRole.status, 400);
});
