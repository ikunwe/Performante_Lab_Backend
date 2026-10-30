const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../src/app");
const dataset = require("../data/models/car-models.json");
const assets = require("../data/build-assets.json");
const model = dataset.brands
  .find((brand) => brand.brandId === "honda")
  .models.find((model) => model.name === "Civic");
const carId = "ref:" + model.id;
const front = assets.parts.find(
  (part) =>
    part.brandId === "honda" &&
    part.model === "civic" &&
    part.category === "front",
);

async function fixture(t) {
  const rows = [];
  let failed = false;
  class Query {
    constructor() {
      this.filters = [];
      this.operation = "read";
    }
    select() {
      return this;
    }
    eq(field, value) {
      this.filters.push((row) => row[field] === value);
      return this;
    }
    order() {
      return this;
    }
    insert(value) {
      this.operation = "insert";
      this.value = value;
      return this;
    }
    update(value) {
      this.operation = "update";
      this.value = value;
      return this;
    }
    async execute(single = false) {
      if (failed)
        return { data: null, error: { message: "private-database-detail" } };
      if (this.operation === "insert") {
        if (rows.some((row) => row.id === this.value.id))
          return { data: null, error: { code: "23505" } };
        rows.push({
          ...this.value,
          created_at: "2026-10-31T00:00:00Z",
          updated_at: "2026-10-31T00:00:00Z",
        });
        return { data: rows.at(-1), error: null };
      }
      const found = rows.filter((row) =>
        this.filters.every((filter) => filter(row)),
      );
      if (this.operation === "update")
        found.forEach((row) => Object.assign(row, this.value));
      const values = this.window
        ? found.slice(this.window[0], this.window[1] + 1)
        : found;
      return { data: single ? (values[0] ?? null) : values, error: null };
    }
    range(start, end) {
      this.window = [start, end];
      return this.execute();
    }
    single() {
      return this.execute(true);
    }
    maybeSingle() {
      return this.execute(true);
    }
  }
  const admin = {
    from: (table) =>
      table === "profiles"
        ? {
            select: () => ({
              eq: (_key, id) => ({
                maybeSingle: async () => ({
                  data: {
                    role: "User",
                    status: id === "inactive" ? "InActive" : "Active",
                  },
                  error: null,
                }),
              }),
            }),
          }
        : (assert.equal(table, "builds"), new Query()),
  };
  const supabase = {
    auth: {
      getUser: async (token) =>
        ["a", "b", "inactive"].includes(token)
          ? { data: { user: { id: token } }, error: null }
          : { data: null, error: { status: 401 } },
    },
  };
  const app = createApp({
    supabase,
    admin,
    origins: ["http://localhost:4200"],
  });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  const request = (method, suffix = "", body, token = "a") =>
    fetch(base + "/api/builds" + suffix, {
      method,
      headers: {
        authorization: "Bearer " + token,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return {
    rows,
    request,
    fail: () => {
      failed = true;
    },
  };
}
const input = () => ({
  id: randomUUID(),
  name: "My Civic",
  carId,
  partIds: [front.id],
});

test("build API persists canonical cars and parts privately, retries creates, updates and soft deletes", async (t) => {
  const { rows, request } = await fixture(t);
  const draft = input();
  const create = await request("POST", "", {
    ...draft,
    user_id: "b",
    carSnapshot: { name: "Forged" },
    is_public: true,
  });
  assert.equal(create.status, 201);
  const saved = (await create.json()).build;
  assert.equal(saved.carSnapshot.name, "Honda Civic");
  assert.deepEqual(saved.partIds, [front.id]);
  assert.equal(rows[0].user_id, "a");
  assert.equal(rows[0].is_public, false);
  assert.equal((await request("POST", "", draft)).status, 200);
  assert.equal(rows.length, 1);
  assert.deepEqual((await (await request("GET")).json()).builds, [saved]);
  const edited = await request("PUT", "/" + saved.id, {
    ...draft,
    name: "Updated",
    partIds: [],
  });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).build.createdAt, saved.createdAt);
  assert.equal((await request("DELETE", "/" + saved.id)).status, 204);
  assert.equal((await request("DELETE", "/" + saved.id)).status, 204);
  assert.equal(rows[0].is_deleted, true);
  assert.equal((await (await request("GET")).json()).builds.length, 0);
  assert.equal((await request("PUT", "/" + saved.id, draft)).status, 404);
});

test("another account cannot read, update, delete or claim a build ID", async (t) => {
  const { request, rows } = await fixture(t);
  const draft = input();
  await request("POST", "", draft);
  assert.equal(
    (await (await request("GET", "", undefined, "b")).json()).builds.length,
    0,
  );
  assert.equal((await request("PUT", "/" + draft.id, draft, "b")).status, 404);
  assert.equal(
    (await request("DELETE", "/" + draft.id, undefined, "b")).status,
    404,
  );
  assert.equal((await request("POST", "", draft, "b")).status, 409);
  assert.equal(rows[0].user_id, "a");
  assert.equal(rows[0].title, draft.name);
});

test("build API rejects unauthenticated/inactive users, bad cars, incompatible or conflicting parts", async (t) => {
  const { request, rows } = await fixture(t);
  assert.equal((await request("GET", "", undefined, "invalid")).status, 401);
  assert.equal((await request("POST", "", input(), "inactive")).status, 403);
  for (const changes of [
    { name: " " },
    { carId: "ref:invented" },
    { partIds: ["local-part:invented"] },
    { partIds: [front.id, front.id] },
    { carId: "f8-tributo", partIds: [front.id] },
    { carId: "f8-tributo", partIds: ["f8-tributo-0", "f8-tributo-3"] },
  ])
    assert.equal(
      (await request("POST", "", { ...input(), ...changes })).status,
      400,
    );
  assert.equal(rows.length, 0);
  assert.equal((await request("GET", "?offset=-1")).status, 400);
});

test("build failures do not report success or expose database messages", async (t) => {
  const { request, fail } = await fixture(t);
  fail();
  for (const [method, suffix, body] of [
    ["GET", "", undefined],
    ["POST", "", input()],
    ["PUT", "/" + randomUUID(), input()],
    ["DELETE", "/" + randomUUID(), undefined],
  ]) {
    const res = await request(method, suffix, body);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.ok(!(await res.text()).includes("private-database-detail"));
  }
});
