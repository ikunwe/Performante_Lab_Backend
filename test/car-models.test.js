const { test } = require("node:test");
const assert = require("node:assert/strict");
const dataset = require("../data/models/car-models.json");
const { normalizeModels } = require("../scripts/lib/car-models");
const { createModelCatalog } = require("../src/services/model-catalog");
const { createApp } = require("../src/app");

test("model data covers exactly selected brands and never invents missing chassis/generation records", () => {
  assert.deepEqual(
    dataset.brands.map((brand) => brand.brandId).sort(),
    [...require("../data/reference/starter-brand-ids.json")].sort(),
  );
  const allIds = new Set();
  for (const brand of dataset.brands) {
    assert.ok(brand.models.length);
    for (const model of brand.models) {
      assert.equal(allIds.has(model.id), false);
      allIds.add(model.id);
      assert.ok(model.sourceUrl.startsWith("https://"));
      assert.deepEqual(Object.keys(model).sort(), ['brandId', 'id', 'name', 'sourceUrl']);
    }
  }
  const missing = normalizeModels(
    "test",
    [{ name: "Model" }],
    "https://example.com",
  )[0];
  assert.deepEqual(Object.keys(missing).sort(), ['brandId', 'id', 'name', 'sourceUrl']);
  const sourceWithDetails = normalizeModels('test', [{ name: 'Model', yearStart: 2020, generations: [{ name: 'Version', chassisCodes: ['X1'] }] }], 'https://example.com')[0];
  assert.deepEqual(sourceWithDetails, missing);
});

test("per-brand cache shares in-flight reads, isolates brands, expires and backs off outages", async () => {
  let calls = 0;
  let clock = 0;
  let failed = false;
  const admin = {
    from(table) {
      assert.equal(table, "car_brand_reference");
      return {
        select() {
          return {
            eq(_field, brandId) {
              return {
                single() {
                  return {
                    async abortSignal() {
                      calls++;
                      const brand = dataset.brands.find(
                        (brand) => brand.brandId === brandId,
                      );
                      return failed
                        ? { error: {} }
                        : {
                            data: {
                              modelCatalog: { schemaVersion: 2, ...brand },
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
    },
  };
  const catalog = createModelCatalog({ admin, now: () => clock, ttlMs: 100 });
  const responses = await Promise.all([
    catalog.get("honda"),
    catalog.get("honda"),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(responses[0], responses[1]);
  await catalog.get("toyota");
  assert.equal(calls, 2);
  await catalog.get("honda");
  assert.equal(calls, 2);
  clock = 101;
  failed = true;
  assert.equal((await catalog.get("honda")).stale, true);
  await catalog.get("honda");
  assert.equal(calls, 3);
  await assert.rejects(catalog.get("outside-project"), /INVALID_BRAND/);
});

test("models routes validate brand IDs, report missing config and offer the attributed adapted dataset", async (t) => {
  const app = createApp({ supabase: null, admin: null });
  const server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/catalog`;
  assert.equal((await fetch(base + "/models")).status, 400);
  assert.equal((await fetch(base + "/models?brandId=unselected")).status, 400);
  assert.equal((await fetch(base + "/models?brandId=honda")).status, 503);
  const exportResponse = await fetch(base + "/models/export");
  assert.equal(exportResponse.status, 200);
  const exported = await exportResponse.json();
  assert.equal(exported.license, "ODbL-1.0");
  assert.equal(exported.counts.brands, 28);
  assert.match(exported.attribution, /autoevolution/);
});
