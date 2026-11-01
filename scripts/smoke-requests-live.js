// Opt-in integration test; creates and cleans only its own temporary accounts/files.
require("dotenv").config({ quiet: true });
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { createAdmin, createSupabase } = require("../src/config/supabase");
const { createApp } = require("../src/app");
const { BUCKET } = require("../src/services/requests");
async function main() {
  const admin = createAdmin(process.env),
    supabase = createSupabase(process.env);
  assert.ok(admin && supabase, "Supabase configuration required");
  const nonce = randomBytes(6).toString("hex"),
    requestId = randomUUID();
  const accounts = [];
  let server;
  try {
    const columns = await admin
      .from("part_requests")
      .select("id,request_details,image_paths,submission_hash")
      .limit(1);
    assert.ifError(columns.error);
    const bucket = await admin.storage.getBucket(BUCKET);
    assert.ifError(bucket.error);
    assert.equal(bucket.data.public, false);
    for (const role of ["User", "Admin"]) {
      const password = randomBytes(32).toString("base64url");
      const created = await admin.auth.admin.createUser({
        email: `request-smoke-${role.toLowerCase()}-${nonce}@example.com`,
        password,
        email_confirm: true,
      });
      assert.ifError(created.error);
      const user = created.data.user;
      assert.ok(user?.id);
      accounts.push({ id: user.id });
      const profile = await admin
        .from("profiles")
        .upsert({
          id: user.id,
          username: `req_${role}_${nonce}`,
          role,
          status: "Active",
        });
      assert.ifError(profile.error);
      const login = await createSupabase(process.env).auth.signInWithPassword({
        email: user.email,
        password,
      });
      assert.ifError(login.error);
      accounts.at(-1).token = login.data.session.access_token;
    }
    server = await new Promise((resolve) => {
      const s = createApp({ admin, supabase }).listen(0, "127.0.0.1", () =>
        resolve(s),
      );
    });
    const base = "http://127.0.0.1:" + server.address().port;
    const call = (path, account = accounts[0], method = "GET", body) =>
      fetch(base + path, {
        method,
        headers: {
          Authorization: "Bearer " + account.token,
          ...(body && !(body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(body
          ? { body: body instanceof FormData ? body : JSON.stringify(body) }
          : {}),
      });
    const metadata = {
      id: requestId,
      kind: "brand",
      title: "Temporary Requests integration check",
      description: "This temporary request will be removed by its smoke test.",
    };
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVd8AAAAASUVORK5CYII=",
      "base64",
    );
    const body = () => {
      const form = new FormData();
      form.append("data", JSON.stringify(metadata));
      form.append(
        "images",
        new File([png], "reference.png", { type: "image/png" }),
      );
      return form;
    };
    const created = await call("/api/requests", accounts[0], "POST", body());
    assert.equal(created.status, 201, await created.clone().text());
    const saved = (await created.json()).request;
    assert.equal(saved.status, "Pending");
    assert.equal(saved.id, requestId);
    assert.equal(saved.images.length, 1);
    const image = await fetch(saved.images[0]);
    assert.equal(image.status, 200);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal(
      (await call("/api/requests", accounts[0], "POST", body())).status,
      200,
    );
    const count = await admin
      .from("part_requests")
      .select("id", { count: "exact", head: true })
      .eq("id", requestId);
    assert.ifError(count.error);
    assert.equal(count.count, 1);
    const mine = await (await call("/api/requests")).json();
    assert.ok(mine.requests.some((row) => row.id === requestId));
    const other = await (await call("/api/requests", accounts[1])).json();
    assert.ok(!other.requests.some((row) => row.id === requestId));
    assert.equal((await call("/api/admin/requests")).status, 403);
    const list = await call("/api/admin/requests", accounts[1]);
    assert.equal(list.status, 200);
    assert.ok((await list.json()).requests.some((row) => row.id === requestId));
    for (const status of ["Accepted", "Rejected"]) {
      const review = await call(
        `/api/admin/requests/${requestId}/status`,
        accounts[1],
        "PATCH",
        { status },
      );
      assert.equal(review.status, 200);
      assert.equal((await review.json()).request.status, status);
      const current = await (await call("/api/requests")).json();
      assert.equal(
        current.requests.find((row) => row.id === requestId).status,
        status,
      );
    }
    console.log(
      "PASS: real multipart upload, signed image, idempotent retry, owner isolation, Admin list and Accept/Reject",
    );
  } finally {
    const failures = [];
    if (accounts[0]) {
      const prefix = `${accounts[0].id}/${requestId}`;
      const listed = await admin.storage
        .from(BUCKET)
        .list(prefix, { limit: 100 });
      if (listed.error) failures.push("list attachments");
      else if (listed.data.length) {
        const removed = await admin.storage
          .from(BUCKET)
          .remove(
            listed.data
              .filter((file) => file.id !== null)
              .map((file) => prefix + "/" + file.name),
          );
        if (removed.error) failures.push("remove attachments");
      }
      const removed = await admin
        .from("part_requests")
        .delete()
        .eq("id", requestId)
        .eq("user_id", accounts[0].id);
      if (removed.error) failures.push("remove request");
    }
    for (const account of accounts) {
      const result = await admin.auth.admin.deleteUser(account.id);
      if (result.error) failures.push("remove temporary account");
    }
    if (server) await new Promise((resolve) => server.close(resolve));
    assert.deepEqual(failures, [], "Temporary-data cleanup failed");
    console.log("Temporary accounts, request and attachments cleaned.");
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
