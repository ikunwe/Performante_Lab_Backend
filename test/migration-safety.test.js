const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

test("RBAC migration replay preserves existing role and account status assignments", () => {
  const sql = readFileSync(
    path.join(
      __dirname,
      "../supabase/migrations/202610310001_admin_rbac_and_features.sql",
    ),
    "utf8",
  ).replace(/--[^\n]*/g, "");
  assert.doesNotMatch(
    sql,
    /update\s+(?:public\.)?profiles\s+set\s+(?:role|status)\s*=/i,
  );
  assert.match(
    sql,
    /add column if not exists role text not null default 'User'/i,
  );
  assert.match(
    sql,
    /add column if not exists status text not null default 'Active'/i,
  );
});
