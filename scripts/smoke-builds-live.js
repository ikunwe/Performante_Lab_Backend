// Opt-in cloud smoke test. Creates and removes only its own temporary account/data.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { createAdmin, createSupabase } = require("../src/config/supabase");
const { createApp } = require("../src/app");
const dataset = require("../data/models/car-models.json");
const assets = require("../data/build-assets.json");

async function main() {
  const admin = createAdmin(process.env),
    supabase = createSupabase(process.env);
  assert.ok(admin && supabase, "Backend Supabase configuration required");
  const nonce = randomBytes(8).toString("hex"),
    buildId = randomUUID();
  const password = randomBytes(32).toString("base64url");
  let user, server;
  try {
    const created = await admin.auth.admin.createUser({
      email: `build-smoke-${nonce}@example.com`,
      password,
      email_confirm: true,
    });
    assert.ifError(created.error);
    user = created.data.user;
    assert.ok(user?.id);
    const profile = await admin
      .from("profiles")
      .upsert({
        id: user.id,
        username: "build_test_" + nonce,
        role: "User",
        status: "Active",
      });
    assert.ifError(profile.error);
    const login = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });
    assert.ifError(login.error);
    assert.ok(login.data.session);
    const app = createApp({ supabase, admin });
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = "http://127.0.0.1:" + server.address().port + "/api/builds";
    const request = (method, path = "", body) =>
      fetch(base + path, {
        method,
        headers: {
          authorization: "Bearer " + login.data.session.access_token,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const model = dataset.brands
      .find((b) => b.brandId === "honda")
      .models.find((m) => m.name === "Civic");
    const parts = assets.parts.filter(
      (p) => p.brandId === "honda" && p.model === "civic",
    );
    const selected = ["front", "rear", "wheels", "spoilers"]
      .map((category) => parts.find((p) => p.category === category)?.id)
      .filter(Boolean);
    const draft = {
      id: buildId,
      name: "Temporary Build API smoke test",
      carId: "ref:" + model.id,
      partIds: selected,
      user_id: randomUUID(),
    };
    const response = await request("POST", "", draft);
    assert.equal(
      response.status,
      201,
      "Create failed: " + (response.ok ? "" : await response.text()),
    );
    const saved = (await response.json()).build;
    assert.deepEqual(saved.partIds, selected);
    const row = await admin
      .from("builds")
      .select("user_id,tag,parts,is_public,is_deleted")
      .eq("id", buildId)
      .single();
    assert.ifError(row.error);
    assert.equal(row.data.user_id, user.id);
    assert.equal(row.data.is_public, false);
    assert.equal((await request("POST", "", draft)).status, 200);
    assert.ok(
      (await (await request("GET")).json()).builds.some(
        (b) => b.id === buildId,
      ),
    );
    const updated = await request("PUT", "/" + buildId, {
      ...draft,
      name: "Updated temporary build",
      partIds: [],
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).build.createdAt, saved.createdAt);
    assert.equal((await request("DELETE", "/" + buildId)).status, 204);
    assert.ok(
      !(await (await request("GET")).json()).builds.some(
        (b) => b.id === buildId,
      ),
    );
    console.log(
      "Verified live Supabase build create, retry, list, update, owner assignment and soft delete.",
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (user?.id) {
      const cleanup = await admin
        .from("builds")
        .delete()
        .eq("id", buildId)
        .eq("user_id", user.id);
      assert.ifError(cleanup.error);
      const removed = await admin.auth.admin.deleteUser(user.id);
      assert.ifError(removed.error);
      console.log("Removed the temporary smoke-test account and its build.");
    }
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
