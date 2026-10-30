const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createBrandCatalog,
  BRAND_CACHE_TTL_MS,
} = require("../src/services/brand-catalog");
const { createApp } = require("../src/app");
test("paginates the Supabase table without truncating at the default row limit", async () => {
  const large = Array.from({ length: 1001 }, (_, index) => ({
    id: `brand-${index}`,
    slug: `brand-${index}`,
    name: `Brand ${index}`,
    details: {},
  }));
  large[1000] = { id: 'toyota', slug: 'toyota', name: 'Toyota', details: {} };
  const ranges = [];
  const catalog = createBrandCatalog({
    admin: mockAdmin(async (start, end) => {
      ranges.push([start, end]);
      return { data: large.slice(start, end + 1), error: null };
    }),
  });
  const result = await catalog.get("all");
  assert.deepEqual(result.brands.map((brand) => brand.id), ['toyota']);
  assert.deepEqual(ranges, [
    [0, 999],
    [1000, 1999],
  ]);
});
const rows = [
  {
    id: "ferrari",
    slug: "ferrari",
    name: "Ferrari",
    details: {
      aliases: ["FERRARI"],
      logoReferenceUrl:
        "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/hash/logos/ferrari.png",
      privateField: "not-exposed",
    },
  },
  {
    id: "research-only",
    slug: "research-only",
    name: "Research Only",
    details: {},
  },
];
function mockAdmin(respond) {
  return {
    from(table) {
      assert.equal(table, "car_brand_reference");
      return {
        select() {
          return {
            order() {
              return {
                range(start, end) {
                  return {
                    abortSignal() {
                      return respond(start, end);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("coalesces concurrent scopes and caches Supabase reads for an hour", async () => {
  let calls = 0;
  let now = Date.now();
  let finish;
  const admin = mockAdmin(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const catalog = createBrandCatalog({ admin, now: () => now });
  const starter = catalog.get("starter");
  const all = catalog.get("all");
  assert.equal(calls, 1);
  finish({ data: rows, error: null });
  assert.equal((await starter).brands.length, 1);
  assert.equal((await all).brands.length, 1);
  await catalog.get("all");
  assert.equal(calls, 1);
  now += BRAND_CACHE_TTL_MS + 1;
  const refresh = catalog.get("all");
  assert.equal(calls, 2);
  finish({ data: rows, error: null });
  await refresh;
});

test("returns stale cached brands during an outage and backs off refresh attempts", async () => {
  let now = Date.now();
  let fail = false;
  let calls = 0;
  const catalog = createBrandCatalog({
    now: () => now,
    admin: mockAdmin(async () => {
      calls++;
      return fail ? { data: null, error: {} } : { data: rows, error: null };
    }),
  });
  await catalog.get("all");
  now += BRAND_CACHE_TTL_MS + 1;
  fail = true;
  assert.equal((await catalog.get("all")).stale, true);
  await catalog.get("all");
  assert.equal(calls, 2);
});

test("catalog API exposes only public brand fields and reports configuration failures", async (t) => {
  const start = async (admin) => {
    const app = createApp({ supabase: null, admin });
    const server = await new Promise((resolve) => {
      const handle = app.listen(0, "127.0.0.1", () => resolve(handle));
    });
    t.after(() => new Promise((resolve) => server.close(resolve)));
    return `http://127.0.0.1:${server.address().port}`;
  };
  const base = await start(
    mockAdmin(async () => ({ data: rows, error: null })),
  );
  const response = await fetch(base + "/api/catalog/brands?scope=all");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.brands.length, 1);
  assert.equal(data.brands[0].details, undefined);
  assert.equal(JSON.stringify(data).includes("privateField"), false);
  assert.equal(
    (await fetch(base + "/api/catalog/brands?scope=invalid")).status,
    400,
  );
  const missing = await start(null);
  assert.equal((await fetch(missing + "/api/catalog/brands")).status, 503);
});
