const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { combineBrands, toCsv, toSql } = require("../scripts/lib/car-brands");
const base = path.resolve(__dirname, "../data/reference");
const readJson = (name) =>
  JSON.parse(readFileSync(path.join(base, name), "utf8"));

test("reference dataset has unique IDs/names and traceable sources without invented compatibility", () => {
  const data = readJson("car-brands.json");
  assert.equal(data.brands.length, 28);
  assert.deepEqual(new Set(data.brands.map((brand) => brand.id)), new Set(readJson("starter-brand-ids.json")));
  assert.equal(data.brands.find((brand) => brand.id === "great-wall").name, "GWM");
  assert.equal(data.brands.find((brand) => brand.id === "ora").parentBrandId, "great-wall");
  assert.equal(data.counts.total, data.brands.length);
  assert.equal(
    new Set(data.brands.map((brand) => brand.id)).size,
    data.brands.length,
  );
  assert.equal(
    new Set(data.brands.map((brand) => brand.slug)).size,
    data.brands.length,
  );
  for (const brand of data.brands) {
    assert.ok(brand.name.trim());
    assert.ok(brand.sources.length);
    assert.equal(brand.isBuildReady, false);
    assert.equal(brand.country, null);
    assert.equal(brand.operatingStatus, "unknown");
    if (brand.reviewStatus === "vehicle_registry_match")
      assert.ok(brand.nhtsaMakeIds.length);
    for (const type of brand.vehicleTypes) assert.ok([2, 7].includes(type.id));
  }
});

test("saved snapshots have matching checksums and reproduce normalized records offline", () => {
  const manifest = readJson("raw/manifest.json");
  for (const source of manifest.sources) {
    const bytes = readFileSync(path.join(base, "raw", source.filename));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
    );
  }
  const registry = manifest.sources
    .filter((source) => source.vehicleTypeId)
    .map((source) => ({ ...source, data: readJson("raw/" + source.filename) }));
  const candidates = combineBrands(
      readJson("raw/car-logos.json"),
      registry,
      manifest.logoDatasetRevision,
      readJson("official-additions.json"),
    );
  for (const brand of readJson("car-brands.json").brands) {
    const source = candidates.find((item) => item.id === brand.id);
    assert.ok(source, brand.id);
    assert.deepEqual(brand.sources, source.sources);
    assert.equal(brand.logoReferenceUrl, source.logoReferenceUrl);
  }
});

test("starter selection references real records and includes important local-market brands", () => {
  const all = readJson("car-brands.json");
  const starter = readJson("car-brands-starter.json");
  assert.equal(starter.count, starter.brands.length);
  assert.equal(
    new Set(starter.brands.map((brand) => brand.id)).size,
    starter.count,
  );
  for (const brand of starter.brands)
    assert.ok(all.brands.some((entry) => entry.id === brand.id));
  for (const id of [
    "toyota",
    "honda",
    "isuzu",
    "mg",
    "byd",
    "deepal",
    "neta",
    "great-wall",
    "aion",
    "denza",
    "jaecoo",
    "ferrari",
    "lamborghini",
  ])
    assert.ok(
      starter.brands.some((brand) => brand.id === id),
      id,
    );
  assert.ok(
    !starter.brands.some((brand) =>
      ["toyota-alphard", "ford-mustang", "bmw-m"].includes(brand.id),
    ),
  );
});

test("merges equivalent brand spellings but keeps performance divisions separate", () => {
  const result = combineBrands(
    [
      { name: "Mercedes-Benz", slug: "mercedes-benz" },
      { name: "BMW", slug: "bmw" },
      { name: "BMW M", slug: "bmw-m" },
    ],
    [
      {
        id: "car",
        vehicleTypeId: 2,
        data: {
          Results: [
            {
              MakeId: 449,
              MakeName: "MERCEDES BENZ",
              VehicleTypeId: 2,
              VehicleTypeName: "Passenger Car",
            },
          ],
        },
      },
    ],
    "a".repeat(40),
  );
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.find((brand) => brand.id === "mercedes-benz").nhtsaMakeIds,
    [449],
  );
  assert.ok(
    result
      .find((brand) => brand.id === "mercedes-benz")
      .aliases.includes("MERCEDES BENZ"),
  );
});

test("CSV and SQL preserve quoted brand names and seed has no automatic publishing policy", () => {
  const brand = {
    id: "test",
    slug: "test",
    name: `O'Connor, "Cars"`,
    aliases: [],
    nhtsaMakeIds: [],
    vehicleTypes: [],
    reviewStatus: "source_only",
    isBuildReady: false,
  };
  assert.ok(toCsv([brand]).includes(`"O'Connor, ""Cars"""`));
  const sql = toSql([brand], "2026-10-30T00:00:00Z");
  assert.ok(sql.includes(`O''Connor`));
  assert.ok(sql.includes("enable row level security"));
  assert.ok(!sql.includes("create policy"));
  assert.ok(sql.includes("on conflict (id) do update"));
  assert.ok(sql.includes("delete from public.car_brand_reference where id not in ('test')"));
});
