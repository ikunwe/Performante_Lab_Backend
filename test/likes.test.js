const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../src/app");
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  I = "33333333-3333-4333-8333-333333333333";
async function setup(t) {
  const make = (owner, is_public = true, is_deleted = false) => ({
    id: randomUUID(),
    user_id: owner,
    is_public,
    is_deleted,
    title: "Build",
    tag: "recorded",
    car_name: "Civic",
    image_url: "https://example.com/car.png",
    parts: [],
    budget: 0,
    category: "Street",
    likes: 0,
    created_at: new Date().toISOString(),
  });
  const builds = [make(B), make(A), make(B, false), make(B, true, true)],
    likes = [];
  const profiles = [
    { id: A, username: "driver-a", role: "User", status: "Active" },
    { id: B, username: "driver-b", role: "User", status: "Active" },
    { id: I, username: "inactive", role: "User", status: "InActive" },
  ];
  let failed = false;
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
    }
    select(columns) {
      this.join = columns.includes("builds!inner");
      return this;
    }
    eq(key, value) {
      this.filters.push(
        (row) =>
          key.split(".").reduce((value, key) => value?.[key], row) === value,
      );
      return this;
    }
    in(key, values) {
      this.filters.push((row) => values.includes(row[key]));
      return this;
    }
    order() {
      return this;
    }
    upsert(value) {
      this.value = value;
      return this;
    }
    delete() {
      this.removing = true;
      return this;
    }
    result(single = false) {
      if (failed) return { data: null, error: { message: "private-details" } };
      if (
        this.value &&
        !likes.some(
          (row) =>
            row.user_id === this.value.user_id &&
            row.build_id === this.value.build_id,
        )
      ) {
        likes.push({ ...this.value, created_at: new Date().toISOString() });
        builds.find((build) => build.id === this.value.build_id).likes++;
      }
      const source =
        this.table === "builds"
          ? builds
          : this.table === "profiles"
            ? profiles
            : likes;
      let result = source
        .map((row) =>
          this.join
            ? { ...row, builds: builds.find((b) => b.id === row.build_id) }
            : row,
        )
        .filter((row) => this.filters.every((filter) => filter(row)));
      if (this.removing) {
        for (const row of result) {
          const index = likes.findIndex(
            (like) =>
              like.user_id === row.user_id && like.build_id === row.build_id,
          );
          if (index !== -1) {
            likes.splice(index, 1);
            const build = builds.find((build) => build.id === row.build_id);
            build.likes = Math.max(0, build.likes - 1);
          }
        }
      }
      if (this.window)
        result = result.slice(this.window[0], this.window[1] + 1);
      return { data: single ? result[0] || null : result, error: null };
    }
    maybeSingle() {
      return Promise.resolve(this.result(true));
    }
    range(start, end) {
      this.window = [start, end];
      return Promise.resolve(this.result());
    }
    then(resolve, reject) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }
  const users = { a: A, b: B, inactive: I };
  const supabase = {
    auth: {
      getUser: async (token) =>
        users[token]
          ? { data: { user: { id: users[token] } }, error: null }
          : { data: null, error: { status: 401 } },
    },
  };
  const admin = { from: (table) => new Query(table) };
  const app = createApp({ supabase, admin });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port + "/api/likes";
  return {
    builds,
    likes,
    fail: () => {
      failed = true;
    },
    call: (path, method = "GET", token = "a") =>
      fetch(base + path, {
        method,
        headers: token ? { Authorization: "Bearer " + token } : {},
      }),
  };
}
test("Like and Unlike are idempotent, account-scoped and preserve public-build ownership", async (t) => {
  const { builds, likes, call } = await setup(t);
  const id = builds[0].id;
  assert.equal((await call("/" + id, "PUT")).status, 200);
  assert.equal((await call("/" + id, "PUT")).status, 200);
  assert.equal(likes.length, 1);
  assert.equal((await call("/" + builds[1].id, "PUT")).status, 200);
  const list = await call("/builds");
  assert.equal(list.headers.get("cache-control"), "no-store");
  const data = await list.json();
  assert.equal(data.builds.length, 2);
  assert.equal(data.builds[0].isOwn, false);
  assert.equal(data.builds[1].isOwn, true);
  assert.ok(!("user_id" in data.builds[0]));
  assert.equal(
    (await (await call("/builds", "GET", "b")).json()).builds.length,
    0,
  );
  assert.equal((await call("/" + id, "DELETE", "b")).status, 200);
  assert.equal(likes.length, 2);
  assert.equal((await call("/" + id, "DELETE")).status, 200);
  assert.equal((await call("/" + id, "DELETE")).status, 200);
  assert.equal(likes.length, 1);
});
test("private/deleted builds cannot be newly liked and disappear from Liked after visibility changes", async (t) => {
  const { builds, call } = await setup(t);
  assert.equal((await call("/" + builds[2].id, "PUT")).status, 404);
  assert.equal((await call("/" + builds[3].id, "PUT")).status, 404);
  const id = builds[0].id;
  await call("/" + id, "PUT");
  builds[0].is_public = false;
  assert.equal((await (await call("/builds")).json()).builds.length, 0);
  assert.equal((await call("/" + id, "DELETE")).status, 200);
});
test("Like routes require Active auth, validate IDs/pages and paginate real liked builds", async (t) => {
  const { builds, likes, call } = await setup(t);
  assert.equal((await call("/builds", "GET", null)).status, 401);
  assert.equal((await call("/" + builds[0].id, "PUT", "inactive")).status, 403);
  assert.equal((await call("/invalid", "PUT")).status, 400);
  assert.equal((await call("/builds?offset=-1")).status, 400);
  for (let i = 0; i < 101; i++) {
    const build = { ...builds[0], id: randomUUID() };
    builds.push(build);
    likes.push({
      user_id: A,
      build_id: build.id,
      created_at: new Date().toISOString(),
    });
  }
  assert.equal((await (await call("/builds")).json()).nextOffset, 100);
  assert.equal(
    (await (await call("/builds?offset=100")).json()).builds.length,
    1,
  );
});
test("Like API outages return errors without a false success", async (t) => {
  const { call, builds, fail } = await setup(t);
  fail();
  const response = await call("/" + builds[0].id, "PUT");
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes("private-details"));
});

test("API returns the database Like total for multiple users and idempotent retries", async (t) => {
  const { call, builds } = await setup(t);
  const id = builds[0].id;
  assert.equal((await (await call("/" + id, "PUT")).json()).likes, 1);
  assert.equal((await (await call("/" + id, "PUT")).json()).likes, 1);
  assert.equal((await (await call("/" + id, "PUT", "b")).json()).likes, 2);
  assert.equal((await (await call("/" + id, "DELETE")).json()).likes, 1);
  assert.equal((await (await call("/" + id, "DELETE")).json()).likes, 1);
  assert.equal(
    (await (await call("/builds", "GET", "b")).json()).builds[0].likes,
    1,
  );
  assert.equal(
    (await (await call("/" + builds[2].id, "DELETE")).json()).likes,
    0,
  );
});
