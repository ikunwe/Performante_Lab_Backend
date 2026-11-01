const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");

test("retired reference routes return 404 without querying reference tables", async (t) => {
  const app = createApp({
    supabase: null,
    admin: { from() { assert.fail("Reference tables must not be queried"); } },
  });
  const server = await new Promise((resolve) => {
    const handle = app.listen(0, "127.0.0.1", () => resolve(handle));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/catalog`;
  for (const path of ["/brands", "/brands?scope=all", "/models?brandId=honda", "/models/export"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).error, "NOT_FOUND");
  }
  // The active Storage API remains registered, even without Storage credentials.
  assert.equal((await fetch(base + "/storage")).status, 503);
});
