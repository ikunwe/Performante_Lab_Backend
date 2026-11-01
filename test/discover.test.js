const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  I = "33333333-3333-4333-8333-333333333333";
const row = (id, user_id, is_public, is_deleted = false) => ({
  id,
  user_id,
  is_public,
  is_deleted,
  title: id,
  tag: "recorded-car",
  car_name: "Honda Civic",
  image_url: "https://example.com/car.png",
  parts: ["Recorded part"],
  budget: 0,
  category: "Street",
  likes: 0,
  created_at: "2026-11-01T00:00:00Z",
});
async function setup(t, custom) {
  const rows = custom || [
    row("public", B, true),
    row("mine", A, false),
    row("other-private", B, false),
    row("deleted", A, true, true),
  ];
  let failed = false;
  const profiles = [
    { id: A, username: "driver-a", role: "User", status: "Active" },
    { id: B, username: "driver-b", role: "User", status: "Active" },
    { id: I, username: "inactive", role: "User", status: "InActive" },
  ];
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
    }
    select() {
      return this;
    }
    eq(key, value) {
      this.filters.push((r) => r[key] === value);
      return this;
    }
    in(key, values) {
      this.filters.push((r) => values.includes(r[key]));
      return this;
    }
    or(value) {
      const match = /^is_public.eq.true,user_id.eq.([a-f0-9-]+)$/.exec(value);
      assert.ok(match);
      this.filters.push((r) => r.is_public === true || r.user_id === match[1]);
      return this;
    }
    order() {
      return this;
    }
    result() {
      if (failed) return { data: null, error: { message: "private-details" } };
      return {
        data: (this.table === "builds" ? rows : profiles).filter((r) =>
          this.filters.every((f) => f(r)),
        ),
        error: null,
      };
    }
    range(start, end) {
      const r = this.result();
      return Promise.resolve({ ...r, data: r.data?.slice(start, end + 1) });
    }
    maybeSingle() {
      const r = this.result();
      return Promise.resolve({ ...r, data: r.data?.[0] || null });
    }
    then(resolve, reject) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }
  const admin = { from: (table) => new Query(table) };
  const supabase = {
    auth: {
      getUser: async (token) => ({
        data: ["a", "b", "inactive"].includes(token)
          ? { user: { id: { a: A, b: B, inactive: I }[token] } }
          : null,
        error: ["a", "b", "inactive"].includes(token) ? null : { status: 401 },
      }),
    },
  };
  const app = createApp({ supabase, admin });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base =
    "http://127.0.0.1:" + server.address().port + "/api/discover/builds";
  return {
    rows,
    fail: () => {
      failed = true;
    },
    get: (token, query = "") =>
      fetch(base + query, {
        headers: token ? { Authorization: "Bearer " + token } : {},
      }),
  };
}
test("anonymous Discover returns only published, non-deleted builds and no private owner/contact fields", async (t) => {
  const { get } = await setup(t);
  const response = await get(null, "?user_id=" + A);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  assert.deepEqual(
    data.builds.map((b) => b.id),
    ["public"],
  );
  assert.equal(data.builds[0].author, "driver-b");
  assert.equal(data.builds[0].isOwn, false);
  assert.ok(!("user_id" in data.builds[0]));
  assert.ok(!("email" in data.builds[0]));
});
test("signed-in Discover includes own public builds and excludes every private build", async (t) => {
  const { get, rows } = await setup(t);
  rows.push(row('own-public', A, true));
  const a = await (await get('a')).json();
  assert.deepEqual(a.builds.map(b=>b.id),['public','own-public']);
  assert.equal(a.builds[1].isOwn,true);
  assert.ok(a.builds.every(b=>b.isPublic));
  const b = await (await get('b')).json();
  assert.deepEqual(b.builds.map(b=>b.id),['public','own-public']);
  assert.equal(b.builds[0].isOwn,true);
  assert.ok(b.builds.every(b=>b.isPublic));
});

test("invalid and suspended tokens cannot fall back to authenticated data", async (t) => {
  const { get } = await setup(t);
  assert.equal((await get("invalid")).status, 401);
  assert.equal((await get("inactive")).status, 403);
});
test("paginates real records and rejects invalid offsets", async (t) => {
  const { get } = await setup(
    t,
    Array.from({ length: 101 }, (_, i) => row(String(i), B, true)),
  );
  const first = await (await get()).json();
  assert.equal(first.builds.length, 100);
  assert.equal(first.nextOffset, 100);
  const last = await (await get(null, "?offset=100")).json();
  assert.equal(last.builds.length, 1);
  assert.equal(last.nextOffset, null);
  assert.equal((await get(null, "?offset=-1")).status, 400);
});
test("database outages return an explicit error without exposing internals or sample builds", async (t) => {
  const { get, fail } = await setup(t);
  fail();
  const response = await get();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error, "DISCOVER_UNAVAILABLE");
  assert.ok(!JSON.stringify(body).includes("private-details"));
  assert.ok(!body.builds);
});

test("public Admin builds with missing optional legacy fields remain visible", async (t) => {
  const sample = {
    ...row("legacy-public", B, true),
    tag: null,
    parts: null,
    car_name: null,
    image_url: null,
    category: null,
  };
  const { get } = await setup(t, [sample]);
  const response = await get("a");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.builds.length, 1);
  assert.equal(data.builds[0].isOwn, false);
  assert.equal(data.builds[0].category, "Street");
  assert.deepEqual(data.builds[0].parts, []);
});
