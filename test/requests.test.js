const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createApp } = require("../src/app");
const { BUCKET } = require("../src/services/requests");
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333",
  D = "44444444-4444-4444-8444-444444444444";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVd8AAAAASUVORK5CYII=",
  "base64",
);
function submission(overrides = {}) {
  return {
    id: randomUUID(),
    kind: "brand",
    title: "New brand",
    brandName: "",
    modelName: "",
    ...overrides,
  };
}
function form(
  data,
  files = [new File([png], "logo.png", { type: "image/png" })],
) {
  const f = new FormData();
  f.append("data", JSON.stringify(data));
  for (const file of files) f.append("images", file);
  return f;
}
async function setup(t) {
  const rows = [],
    uploads = new Map();
  let failDb = false,
    failStorage = false;
  const users = { a: A, b: B, admin: C, inactive: D };
  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
    }
    select() {
      return this;
    }
    eq(key, value) {
      this.filters.push((row) => row[key] === value);
      return this;
    }
    order() {
      return this;
    }
    insert(value) {
      this.inserted = value;
      return this;
    }
    update(value) {
      this.updated = value;
      return this;
    }
    result(single = false) {
      if (this.table === "profiles") {
        const profiles = Object.values(users).map((id) => ({
          id,
          role: id === C ? "Admin" : "User",
          status: id === D ? "InActive" : "Active",
          username: "user-" + id[0],
        }));
        const result = profiles.filter((row) =>
          this.filters.every((filter) => filter(row)),
        );
        return { data: single ? result[0] || null : result, error: null };
      }
      assert.equal(this.table, "part_requests");
      if (failDb)
        return { data: null, error: { message: "private-database-details" } };
      if (this.inserted) {
        if (rows.some((row) => row.id === this.inserted.id))
          return { data: null, error: { code: "23505" } };
        rows.push({
          ...this.inserted,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      let result = this.inserted
        ? [rows.at(-1)]
        : rows.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.updated)
        result.forEach((row) => Object.assign(row, this.updated));
      if (this.window)
        result = result.slice(this.window[0], this.window[1] + 1);
      result = result.map((row) => ({
        ...row,
        profiles: { username: "user-" + row.user_id[0] },
      }));
      return { data: single ? result[0] || null : result, error: null };
    }
    range(start, end) {
      this.window = [start, end];
      return Promise.resolve(this.result());
    }
    maybeSingle() {
      return Promise.resolve(this.result(true));
    }
    single() {
      return Promise.resolve(this.result(true));
    }
  }
  const admin = {
    from: (table) => new Query(table),
    storage: {
      from(bucket) {
        assert.equal(bucket, BUCKET);
        return {
          async upload(path, bytes, options) {
            if (failStorage)
              return { error: { message: "private-storage-details" } };
            assert.equal(options.contentType, "image/png");
            uploads.set(path, bytes);
            return { error: null };
          },
          async createSignedUrls(paths) {
            return {
              data: paths.map((path) => ({
                path,
                signedUrl:
                  "https://test.supabase.co/storage/v1/object/sign/" +
                  BUCKET +
                  "/" +
                  path +
                  "?token=signed",
              })),
              error: null,
            };
          },
        };
      },
    },
  };
  const supabase = {
    auth: {
      getUser: async (token) =>
        users[token]
          ? { data: { user: { id: users[token] } }, error: null }
          : { data: null, error: { status: 401 } },
    },
  };
  const app = createApp({ supabase, admin });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port;
  return {
    rows,
    uploads,
    failDb: () => {
      failDb = true;
    },
    failStorage: () => {
      failStorage = true;
    },
    call: (path, token = "a", method = "GET", body) =>
      fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: "Bearer " + token } : {}),
          ...(body && !(body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(body
          ? { body: body instanceof FormData ? body : JSON.stringify(body) }
          : {}),
      }),
  };
}
test("submits real requests with private image paths, retries safely and restricts user/Admin reads and reviews", async (t) => {
  const { call, rows, uploads } = await setup(t);
  const data = submission({ user_id: B, status: "Accepted" });
  const response = await call("/api/requests", "a", "POST", form(data));
  assert.equal(response.status, 201);
  const saved = (await response.json()).request;
  assert.equal(saved.status, "Pending");
  assert.equal(rows[0].user_id, A);
  assert.equal(saved.author, "user-1");
  assert.ok([...uploads.keys()][0].startsWith(A + "/" + data.id + "/"));
  assert.match(saved.images[0], /\/object\/sign\/request-attachments\//);
  assert.ok(!("submission_hash" in saved));
  assert.ok(!("user_id" in saved));
  assert.equal(
    (await call("/api/requests", "a", "POST", form(data))).status,
    200,
  );
  assert.equal(rows.length, 1);
  assert.equal(
    (
      await call(
        "/api/requests",
        "a",
        "POST",
        form({ ...data, title: "Changed" }),
      )
    ).status,
    409,
  );
  assert.equal(
    (await (await call("/api/requests", "b")).json()).requests.length,
    0,
  );
  assert.equal(
    (await (await call("/api/requests?user_id=" + B)).json()).requests.length,
    1,
  );
  assert.equal((await call("/api/admin/requests", "a")).status, 403);
  const adminList = await call("/api/admin/requests", "admin");
  assert.equal(adminList.status, 200);
  assert.equal((await adminList.json()).requests[0].id, data.id);
  assert.equal(
    (
      await call("/api/admin/requests/" + data.id + "/status", "a", "PATCH", {
        status: "Accepted",
      })
    ).status,
    403,
  );
  const review = await call(
    "/api/admin/requests/" + data.id + "/status",
    "admin",
    "PATCH",
    { status: "Accepted" },
  );
  assert.equal(review.status, 200);
  assert.equal((await review.json()).request.status, "Accepted");
  assert.equal(
    (await (await call("/api/requests")).json()).requests[0].status,
    "Accepted",
  );
  assert.equal(
    (
      await call(
        "/api/admin/requests/" + data.id + "/status",
        "admin",
        "PATCH",
        { status: "Rejected" },
      )
    ).status,
    200,
  );
  assert.equal(rows[0].status, "Rejected");
});
test("rejects malformed metadata, incompatible MIME, excessive attachments and unauthenticated uploads before writing", async (t) => {
  const { call, rows, uploads } = await setup(t);
  assert.equal(
    (await call("/api/requests", null, "POST", form(submission()))).status,
    401,
  );
  assert.equal(
    (await call("/api/requests", "inactive", "POST", form(submission())))
      .status,
    403,
  );
  for (const data of [
    submission({ title: "" }),
    submission({ kind: "part" }),
    submission({ source: "javascript:alert(1)" }),
    submission({ id: "bad" }),
  ])
    assert.equal(
      (await call("/api/requests", "a", "POST", form(data))).status,
      400,
    );
  assert.equal(
    (await call("/api/requests", "a", "POST", form(submission(), []))).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/requests",
        "a",
        "POST",
        form(submission(), [
          new File(["not a PNG"], "bad.png", { type: "image/png" }),
        ]),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "/api/requests",
        "a",
        "POST",
        form(
          submission(),
          Array.from(
            { length: 6 },
            () => new File([png], "a.png", { type: "image/png" }),
          ),
        ),
      )
    ).status,
    400,
  );
  assert.equal(rows.length, 0);
  assert.equal(uploads.size, 0);
});
test("supports bounded pagination and exposes no fake records during database/Storage failures", async (t) => {
  const { call, rows, failDb, failStorage } = await setup(t);
  for (let i = 0; i < 101; i++)
    rows.push({
      id: randomUUID(),
      user_id: A,
      title: "Request " + i,
      status: "Pending",
      image_paths: [],
      request_details: {},
    });
  const first = await (await call("/api/requests")).json();
  assert.equal(first.requests.length, 100);
  assert.equal(first.nextOffset, 100);
  assert.equal(
    (await (await call("/api/requests?offset=100")).json()).requests.length,
    1,
  );
  assert.equal((await call("/api/requests?offset=-1")).status, 400);
  failStorage();
  assert.equal(
    (await call("/api/requests", "a", "POST", form(submission()))).status,
    503,
  );
  assert.equal(rows.length, 101);
  failDb();
  const res = await call("/api/requests");
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes("private-database-details"));
});
