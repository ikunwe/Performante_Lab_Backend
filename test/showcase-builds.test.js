const { test } = require("node:test");
const assert = require("node:assert/strict");
const { showcaseBuilds } = require("../src/services/showcase-builds");

test("showcase preserves saved part IDs separately from labels for public, liked and admin previews", async () => {
  const admin = {
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{ id: "owner", username: "driver" }] }),
      }),
    }),
  };
  const ids = ["storage-part:front", "storage-part:wheels"];
  const rows = [
    {
      id: "build",
      user_id: "owner",
      tag: "storage-car:Honda/Civic",
      parts: [...ids, null],
      is_public: true,
    },
  ];
  const storage = {
    get: async () => ({
      cars: [],
      parts: ids.map((id, i) => ({
        id,
        name: ["FL5", "Wheel 1"][i],
        category: ["front", "wheels"][i],
      })),
    }),
  };
  const [build] = await showcaseBuilds(admin, storage, rows, "viewer");
  assert.deepEqual(build.partIds, ids);
  assert.deepEqual(build.parts, ["FL5", "Wheel 1"]);
  assert.deepEqual(build.partDetails, [
    { id: ids[0], name: "FL5", category: "front" },
    { id: ids[1], name: "Wheel 1", category: "wheels" },
  ]);
  assert.equal(build.carId, rows[0].tag);
  assert.equal(build.isOwn, false);
  const [legacy] = await showcaseBuilds(
    admin,
    storage,
    [{ ...rows[0], parts: null }],
    "viewer",
  );
  assert.deepEqual(legacy.partIds, []);
});
