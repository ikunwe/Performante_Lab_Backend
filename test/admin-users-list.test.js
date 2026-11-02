const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listAdminUsers } = require("../src/services/admin-users");

test("joins all pages by ID and takes roles from profiles rather than editable Auth metadata", async () => {
  const profiles = Array.from({ length: 1001 }, (_, i) => ({
    id: String(i).padStart(4, "0"),
    username: "driver" + i,
    role: "User",
    status: i === 1000 ? "InActive" : "Active",
    updated_at: "2026-01-01T00:00:00Z",
  }));
  const authUsers = [...profiles]
    .reverse()
    .map((p) => ({
      id: p.id,
      email: p.id + "@example.test",
      created_at: "2026-02-01T00:00:00Z",
      user_metadata: {
        role: "SuperAdmin",
        status: "Active",
        avatar_url: "https://example.test/avatar.png",
      },
      identities: [{ identity_data: { private: "hidden" } }],
    }));
  let profilePages = 0,
    authPages = 0;
  const admin = {
    from: () => ({
      select: () => ({
        order: () => ({
          range: async (start, end) => {
            profilePages++;
            return { data: profiles.slice(start, end + 1), error: null };
          },
        }),
      }),
    }),
    auth: {
      admin: {
        listUsers: async ({ page, perPage }) => {
          authPages++;
          return {
            data: {
              users: authUsers.slice((page - 1) * perPage, page * perPage),
            },
            error: null,
          };
        },
      },
    },
  };
  const users = await listAdminUsers(admin);
  assert.equal(users.length, 1001);
  assert.equal(profilePages, 2);
  assert.equal(authPages, 2);
  assert.equal(users.find((u) => u.id === "1000").email, "1000@example.test");
  assert.equal(users.find((u) => u.id === "1000").status, "InActive");
  assert.ok(users.every((u) => u.role === "User"));
  assert.ok(!JSON.stringify(users).includes("identities"));
});
