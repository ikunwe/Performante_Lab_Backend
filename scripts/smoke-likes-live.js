// Opt-in cloud integration check; deletes only its own temporary accounts/build.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { createAdmin, createSupabase } = require("../src/config/supabase");
const { createApp } = require("../src/app");
async function main() {
  const admin = createAdmin(process.env),
    supabase = createSupabase(process.env);
  assert.ok(admin && supabase, "Supabase configuration required");
  const nonce = randomBytes(6).toString("hex"),
    buildId = randomUUID(),
    accounts = [];
  let server;
  try {
    const schema = await admin
      .from("build_likes")
      .select("user_id,build_id")
      .limit(1);
    assert.ifError(schema.error);
    for (let i = 0; i < 2; i++) {
      const password = randomBytes(32).toString("base64url");
      const created = await admin.auth.admin.createUser({
        email: `like-smoke-${i}-${nonce}@example.com`,
        password,
        email_confirm: true,
      });
      assert.ifError(created.error);
      const user = created.data.user;
      assert.ok(user?.id);
      accounts.push({ id: user.id });
      assert.ifError(
        (
          await admin.from("profiles").upsert({
            id: user.id,
            username: `like_test_${i}_${nonce}`,
            role: "User",
            status: "Active",
          })
        ).error,
      );
      const client = createSupabase(process.env);
      const login = await client.auth.signInWithPassword({
        email: user.email,
        password,
      });
      assert.ifError(login.error);
      accounts.at(-1).token = login.data.session.access_token;
      accounts.at(-1).client = client;
    }
    assert.ifError(
      (
        await admin.from("builds").insert({
          id: buildId,
          user_id: accounts[1].id,
          title: "Temporary Like integration check",
          car_name: "Temporary car",
          tag: "smoke-recorded-car",
          image_url: "",
          parts: [],
          is_public: true,
          likes: 777,
          is_deleted: false,
        })
      ).error,
    );
    server = await new Promise((resolve) => {
      const s = createApp({ admin, supabase }).listen(0, "127.0.0.1", () =>
        resolve(s),
      );
    });
    const base = "http://127.0.0.1:" + server.address().port + "/api/likes";
    const call = (path, method = "GET", account = accounts[0]) =>
      fetch(base + path, {
        method,
        headers: { Authorization: "Bearer " + account.token },
      });
    const counter = async () => {
      const r = await admin
        .from("builds")
        .select("likes")
        .eq("id", buildId)
        .eq("user_id", accounts[1].id)
        .single();
      assert.ifError(r.error);
      return r.data.likes;
    };
    assert.equal(
      await counter(),
      0,
      "New Builds must start at zero real Likes",
    );
    assert.ifError(
      (
        await admin
          .from("builds")
          .update({ likes: 999999 })
          .eq("id", buildId)
          .eq("user_id", accounts[1].id)
      ).error,
    );
    assert.equal(await counter(), 0, "Direct counter writes must be ignored");
    assert.equal((await call("/" + buildId, "PUT")).status, 200);
    assert.equal((await call("/" + buildId, "PUT")).status, 200);
    const count = await admin
      .from("build_likes")
      .select("build_id", { count: "exact", head: true })
      .eq("user_id", accounts[0].id)
      .eq("build_id", buildId);
    assert.ifError(count.error);
    assert.equal(count.count, 1);
    assert.equal(await counter(), 1);
    let response = await call("/builds");
    assert.equal(response.status, 200, await response.clone().text());
    let rows = (await response.json()).builds;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, buildId);
    assert.equal(rows[0].isOwn, false);
    assert.equal(
      (await (await call("/builds", "GET", accounts[1])).json()).builds.length,
      0,
    );
    const concurrent = await Promise.all([
      call("/" + buildId, "PUT", accounts[1]),
      call("/" + buildId, "PUT", accounts[1]),
      call("/" + buildId, "PUT"),
    ]);
    assert.ok(concurrent.every((response) => response.status === 200));
    assert.equal(
      await counter(),
      2,
      "Concurrent retries must count two distinct users only",
    );
    assert.equal(
      (await (await call("/builds", "GET", accounts[1])).json()).builds[0]
        .isOwn,
      true,
    );
    const visible = await accounts[0].client
      .from("build_likes")
      .select("user_id,build_id");
    assert.ifError(visible.error);
    assert.ok(visible.data.every((row) => row.user_id === accounts[0].id));
    assert.equal((await call("/" + buildId, "DELETE")).status, 200);
    assert.equal((await call("/" + buildId, "DELETE")).status, 200);
    assert.equal((await (await call("/builds")).json()).builds.length, 0);
    assert.equal(await counter(), 1);
    assert.equal(
      (await (await call("/builds", "GET", accounts[1])).json()).builds.length,
      1,
    );
    await call("/" + buildId, "PUT");
    assert.equal(await counter(), 2);
    assert.ifError(
      (
        await admin
          .from("builds")
          .update({ is_public: false })
          .eq("id", buildId)
          .eq("user_id", accounts[1].id)
      ).error,
    );
    assert.equal((await (await call("/builds")).json()).builds.length, 0);
    assert.equal((await call("/" + buildId, "PUT")).status, 404);
    assert.ifError(
      (
        await admin
          .from("builds")
          .update({ is_public: true, is_deleted: true })
          .eq("id", buildId)
          .eq("user_id", accounts[1].id)
      ).error,
    );
    assert.equal((await (await call("/builds")).json()).builds.length, 0);
    assert.ifError((await admin.auth.admin.deleteUser(accounts[0].id)).error);
    accounts[0].deleted = true;
    assert.equal(
      await counter(),
      1,
      "Deleting a liker must decrement the aggregate via cascade",
    );
    console.log(
      "PASS: real Like/Unlike persistence, idempotency, own-build likes, RLS/account isolation, private/deleted exclusion, aggregate counts and concurrent retries",
    );
  } finally {
    const errors = [];
    if (accounts[1]) {
      const removed = await admin
        .from("builds")
        .delete()
        .eq("id", buildId)
        .eq("user_id", accounts[1].id);
      if (removed.error) errors.push("remove temporary build");
    }
    for (const account of accounts) {
      if (account.deleted) continue;
      const removed = await admin.auth.admin.deleteUser(account.id);
      if (removed.error) errors.push("remove temporary account");
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(errors, [], "Temporary-data cleanup failed");
    console.log("Temporary accounts, build and Like rows cleaned.");
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
