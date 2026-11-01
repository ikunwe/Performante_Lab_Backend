const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createStorageCatalog,
  partCategory,
} = require("../src/services/storage-catalog");
const { payload } = require("../src/routes/builds");
const folder = (name) => ({ name, id: null, metadata: null });
const file = (name) => ({
  name,
  id: "file-" + name,
  updated_at: "2026-11-01T00:00:00Z",
  metadata: { size: 100 },
});
function fixture() {
  let failed = false,
    calls = 0;
  const tree = {
    "": [folder("Honda"), folder("brands")],
    Honda: [file("logo.png"), folder("Civic-FE")],
    brands: [file("random.png")],
    "Honda/Civic-FE": [
      file("CarPicture.jpg"),
      folder("BodyKit"),
      folder("Part"),
    ],
    "Honda/Civic-FE/BodyKit": [folder("Mugen")],
    "Honda/Civic-FE/BodyKit/Mugen": [file("logo.png"), file("Aero-Kit.png")],
    "Honda/Civic-FE/Part": [folder("Enkei")],
    "Honda/Civic-FE/Part/Enkei": [
      file("logo.svg"),
      file("Wheel-01.png"),
      file("Front-Bumper.png"),
    ],
  };
  const admin = {
    storage: {
      from(bucket) {
        assert.equal(bucket, "catalog");
        return {
          async list(path, { offset, limit }) {
            calls++;
            return failed
              ? { data: null, error: { message: "private" } }
              : {
                  data: (tree[path] || []).slice(offset, offset + limit),
                  error: null,
                };
          },
          getPublicUrl(path) {
            return {
              data: {
                publicUrl:
                  "https://test.supabase.co/storage/v1/object/public/catalog/" +
                  path,
              },
            };
          },
        };
      },
    },
  };

  return {
    tree,
    admin,
    calls: () => calls,
    fail: () => {
      failed = true;
    },
  };
}
test("reads exact tree paths, excludes workshop logos and unrelated namespaces, and keeps stable IDs", async () => {
  const f = fixture(),
    catalog = createStorageCatalog({ admin: f.admin });
  const first = await catalog.get();
  assert.deepEqual(
    first.brands.map((b) => b.name),
    ["Honda"],
  );
  assert.equal(first.cars[0].name, "Honda Civic FE");
  assert.equal(first.parts.length, 3);
  assert.deepEqual(
    first.parts.map((p) => p.category),
    ["bodykits", "wheels", "front"],
  );
  assert.ok(
    first.parts.every((p) => p.previewImage.includes("/catalog/Honda/")),
  );
  assert.ok(first.parts[0].manufacturerLogo.endsWith("00%3A00%3A00Z"));
  const calls = f.calls();
  await catalog.get();
  assert.equal(f.calls(), calls);
  const next = await catalog.get(true);
  assert.equal(next.parts[0].id, first.parts[0].id);
});
test("coalesces parallel requests and reports storage failures instead of asset fallback", async () => {
  const f = fixture(),
    catalog = createStorageCatalog({ admin: f.admin });
  const [a, b] = await Promise.all([catalog.get(), catalog.get()]);
  assert.strictEqual(a, b);
  f.fail();
  await assert.rejects(catalog.get(true), /STORAGE_UNAVAILABLE/);
  await assert.rejects(
    createStorageCatalog({ admin: null }).get(),
    /STORAGE_NOT_CONFIGURED/,
  );
});
test("paginates product images beyond 1000 without returning logos as products", async () => {
  const f = fixture();
  f.tree["Honda/Civic-FE/Part/Enkei"] = Array.from({ length: 1001 }, (_, i) =>
    file("Wheel-" + i + ".png"),
  );
  const d = await createStorageCatalog({ admin: f.admin }).get();
  assert.equal(d.parts.length, 1002);
});
test("validates Storage vehicles and parts for saving builds, including full kit exclusivity", async () => {
  const f = fixture(),
    d = await createStorageCatalog({ admin: f.admin }).get();
  const car = d.cars[0],
    kit = d.parts.find((p) => p.category === "bodykits"),
    wheel = d.parts.find((p) => p.category === "wheels");
  assert.ok(payload({ name: "My car", carId: car.id, partIds: [wheel.id] }, d));
  assert.equal(
    payload({ name: "Wrong", carId: car.id, partIds: [kit.id, wheel.id] }, d),
    null,
  );
  assert.equal(
    payload({ name: "Wrong", carId: car.id, partIds: ["invented"] }, d),
    null,
  );
});
test("uses BodyKit folder for full kits and categorizes separate parts without guessing unknown products", () => {
  assert.equal(partCategory("Front-Bumper-1"), "front");
  assert.equal(partCategory("Rear-Diffuser"), "rear");
  assert.equal(partCategory("Unknown-Accessory"), "others");
  assert.equal(partCategory("Carbon-Ceramic-Rotors"), "brakes");
});

test("reads Admin multi-angle car and nested category/product folders without CarPicture", async () => {
  const f = fixture();
  const base = "Honda/Civic-FE";
  f.tree[base] = [
    file("45_front.jpg"),
    file("front.png"),
    file("45_Back.webp"),
    file("Back.jpg"),
    folder("BodyKit"),
    folder("Part"),
  ];
  f.tree[base + "/BodyKit/Mugen"] = [file("logo.png"), folder("Aero-Kit")];
  f.tree[base + "/BodyKit/Mugen/Aero-Kit"] = [
    file("45_front.png"),
    file("Back.png"),
  ];
  f.tree[base + "/Part"] = [folder("Rear-Bumper"), folder("Wheels")];
  f.tree[base + "/Part/Rear-Bumper"] = [folder("Mugen")];
  f.tree[base + "/Part/Rear-Bumper/Mugen"] = [folder("Custom-Rear")];
  f.tree[base + "/Part/Rear-Bumper/Mugen/Custom-Rear"] = [
    file("45_Back.png"),
    file("Back.png"),
  ];
  f.tree[base + "/Part/Wheels"] = [folder("Enkei")];
  f.tree[base + "/Part/Wheels/Enkei"] = [folder("RPF1")];
  f.tree[base + "/Part/Wheels/Enkei/RPF1"] = [
    file("45_front.png"),
    file("45_Back.png"),
  ];
  const catalog = createStorageCatalog({ admin: f.admin });
  const data = await catalog.get();
  assert.equal(data.cars.length, 1);
  assert.match(data.cars[0].image, /45_front\.jpg/);
  assert.match(data.cars[0].views.rear45, /45_Back\.webp/);
  assert.deepEqual(
    data.parts.map((p) => p.category),
    ["bodykits", "rear", "wheels"],
  );
  assert.equal(data.parts.length, 3); // One product, not one per camera angle.
  assert.match(data.parts[1].previewImage, /45_Back\.png/);
  assert.equal(data.parts[1].finish, "Mugen");
  assert.equal(data.parts[1].name, "Custom Rear");
  assert.match(data.parts[0].manufacturerLogo, /logo\.png/);
  const legacyId = data.cars[0].id;
  f.tree[base].push(file("CarPicture.png"));
  assert.equal((await catalog.get(true)).cars[0].id, legacyId);
  assert.ok(
    payload(
      { name: "Storage build", carId: legacyId, partIds: [data.parts[1].id] },
      data,
    ),
  );
});
