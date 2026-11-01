const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");

async function serve(t, supabase, options = {}) {
  const app = createApp({
    supabase,
    origins: ["http://localhost:4200"],
    ...options,
  });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("rejects missing/malformed tokens without contacting Supabase", async (t) => {
  const base = await serve(t, {
    auth: { getUser: () => assert.fail("must not call getUser") },
  });
  for (const authorization of ["", "Basic abc", "Bearer a b"]) {
    const res = await fetch(base + "/api/auth/me", {
      headers: { authorization },
    });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

test("validates token and returns a limited user profile", async (t) => {
  const base = await serve(
    t,
    {
      auth: {
        getUser: async (token) => {
          assert.equal(token, "valid-token");
          return {
            data: {
              user: {
                id: "1",
                email: "driver@example.com",
                user_metadata: { full_name: "Driver" },
                private_value: "never-expose",
              },
            },
            error: null,
          };
        },
      },
    },
    {
      admin: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { role: "User", status: "Active" },
                error: null,
              }),
            }),
          }),
        }),
      },
    },
  );
  const res = await fetch(base + "/api/auth/me", {
    headers: {
      authorization: "Bearer valid-token",
      origin: "http://localhost:4200",
    },
  });
  assert.equal(res.status, 200);
  assert.equal(
    res.headers.get("access-control-allow-origin"),
    "http://localhost:4200",
  );
  assert.deepEqual(await res.json(), {
    user: {
      id: "1",
      email: "driver@example.com",
      name: "Driver",
      avatarUrl: null,
      role: "User",
      status: "Active",
    },
  });
});

test("rejects expired or forged tokens", async (t) => {
  const base = await serve(t, {
    auth: {
      getUser: async () => ({ data: { user: null }, error: { status: 401 } }),
    },
  });
  assert.equal(
    (
      await fetch(base + "/api/auth/me", {
        headers: { authorization: "Bearer forged" },
      })
    ).status,
    401,
  );
});

test("username login rejects a wrong password for an existing account", async (t) => {
  const base = await serve(t, null, {
    admin: {
      rpc: async () => ({ data: "user-1", error: null }),
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "private@example.com" } },
            error: null,
          }),
        },
      },
    },
    createAuthClient: () => ({
      auth: {
        signInWithPassword: async () => ({
          data: { session: null },
          error: { status: 400 },
        }),
      },
    }),
  });
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "driver", password: "wrong-password" }),
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, "INVALID_CREDENTIALS");
});

test("username login reports missing config and does not echo malformed request bodies", async (t) => {
  const base = await serve(t, null);
  const headers = { "content-type": "application/json" };
  const missing = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ username: "driver", password: "password-123" }),
  });
  assert.equal(missing.status, 503);
  const malformed = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers,
    body: '{"password":"private-input"',
  });
  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), { error: "INVALID_REQUEST" });
});

test("username login resolves privately and returns only session credentials", async (t) => {
  const admin = {
    rpc: async (name, args) => {
      if (name === "get_user_role_and_status") {
        assert.equal(args.target_user_id, "user-1");
        return { data: { role: "User", status: "Active" }, error: null };
      }
      assert.equal(name, "find_username_account");
      assert.equal(args.input_username, "สมชาย Jaidee");
      return { data: "user-1", error: null };
    },
    auth: {
      admin: {
        getUserById: async (id) => {
          assert.equal(id, "user-1");
          return {
            data: { user: { email: "driver@example.com" } },
            error: null,
          };
        },
      },
    },
  };
  const base = await serve(t, null, {
    admin,
    createAuthClient: () => ({
      auth: {
        signInWithPassword: async (credentials) => {
          assert.deepEqual(credentials, {
            email: "driver@example.com",
            password: "long-password-123",
          });
          return {
            data: {
              session: {
                access_token: "access-token",
                refresh_token: "refresh-token",
              },
            },
            error: null,
          };
        },
      },
    }),
  });
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: "สมชาย Jaidee",
      password: "long-password-123",
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), {
    access_token: "access-token",
    refresh_token: "refresh-token",
  });
});

test("username login does not expose account existence and rate limits attempts", async (t) => {
  const base = await serve(t, null, {
    admin: {
      rpc: async () => ({ data: null, error: null }),
    },
    createAuthClient: () => assert.fail("no account to authenticate"),
  });
  for (let index = 0; index < 11; index++) {
    const res = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "unknown", password: "password-123" }),
    });
    assert.equal(res.status, index < 10 ? 401 : 429);
    if (index < 10)
      assert.equal((await res.json()).error, "INVALID_CREDENTIALS");
  }
});

test("username login never returns session credentials for suspended users or failed status checks", async (t) => {
  for (const mode of ["inactive", "unavailable", "missing"]) {
    const base = await serve(t, null, {
      admin: {
        rpc: async (name) =>
          name === "find_username_account"
            ? { data: "user-1", error: null }
            : mode === "unavailable"
              ? { data: null, error: { message: "private-profile-error" } }
              : {
                  data:
                    mode === "missing"
                      ? null
                      : { role: "User", status: "InActive" },
                  error: null,
                },
        auth: {
          admin: {
            getUserById: async () => ({
              data: { user: { email: "driver@example.com" } },
              error: null,
            }),
          },
        },
      },
      createAuthClient: () => ({
        auth: {
          signInWithPassword: async () => ({
            data: {
              session: {
                access_token: "private-access-token",
                refresh_token: "private-refresh-token",
              },
            },
            error: null,
          }),
        },
      }),
    });
    const res = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "driver", password: "password-123" }),
    });
    // A successfully confirmed new account can still complete its first login.
    assert.equal(
      res.status,
      mode === "missing" ? 200 : mode === "inactive" ? 403 : 503,
    );
    const body = await res.json();
    if (mode !== "missing") {
      assert.equal(body.access_token, undefined);
      assert.equal(body.refresh_token, undefined);
      assert.ok(!JSON.stringify(body).includes("private-profile-error"));
    }
  }
});

test("reports unconfigured auth and provider outages without leaking details", async (t) => {
  for (const supabase of [
    null,
    {
      auth: {
        getUser: async () => {
          throw new Error("secret internal message");
        },
      },
    },
  ]) {
    const base = await serve(t, supabase);
    const res = await fetch(base + "/api/auth/me", {
      headers: { authorization: "Bearer token" },
    });
    assert.equal(res.status, 503);
    assert.ok(!(await res.text()).includes("secret internal"));
  }
});

test("only grants CORS access to configured origins and permits auth preflight", async (t) => {
  const base = await serve(t, null);
  const denied = await fetch(base + "/api/health", {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  const allowed = await fetch(base + "/api/auth/me", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:4200",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(allowed.status, 204);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "http://localhost:4200",
  );
  assert.ok(
    allowed.headers
      .get("access-control-allow-headers")
      .includes("Authorization"),
  );
  const adminPreflight = await fetch(base + "/api/admin/users", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:4200",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization,cache-control",
    },
  });
  assert.equal(adminPreflight.status, 204);
  assert.equal(adminPreflight.headers.get("access-control-allow-origin"), "http://localhost:4200");
  const permitted = adminPreflight.headers.get("access-control-allow-headers").toLowerCase().split(",").map(value => value.trim());
  assert.ok(permitted.includes("authorization"));
  assert.ok(permitted.includes("cache-control"));
});
