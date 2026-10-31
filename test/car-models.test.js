const { test } = require("node:test");
const assert = require("node:assert/strict");
const dataset = require("../data/models/car-models.json");
const { normalizeModels } = require("../scripts/lib/car-models");

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
