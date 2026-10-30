const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("Catalog storage bucket migration sanity check", () => {
  const migrationPath = path.join(
    __dirname,
    "../supabase/migrations/202610310003_catalog_storage_bucket.sql"
  );

  assert.ok(fs.existsSync(migrationPath), "Migration file must exist");

  const sql = fs.readFileSync(migrationPath, "utf8");

  // ตรวจสอบ Bucket Configuration
  assert.match(sql, /'catalog'/, "Must specify bucket id as 'catalog'");
  assert.match(sql, /true/, "Must set bucket as public");
  assert.match(sql, /10485760/, "Must enforce 10MB file size limit");
  assert.match(sql, /image\/jpeg/, "Must allow JPEG");
  assert.match(sql, /image\/png/, "Must allow PNG");
  assert.match(sql, /image\/webp/, "Must allow WebP");

  // ตรวจสอบ RLS Policies
  assert.match(sql, /Public read catalog assets/, "Must have public read policy");
  assert.match(sql, /Admins can upload catalog assets/, "Must have admin upload policy");
  assert.match(sql, /Admins can update catalog assets/, "Must have admin update policy");
  assert.match(sql, /Admins can delete catalog assets/, "Must have admin delete policy");
  assert.match(sql, /is_admin_or_superadmin/, "Must check role using is_admin_or_superadmin()");
});

test("Car catalog schema migration sanity check", () => {
  const migrationPath = path.join(
    __dirname,
    "../supabase/migrations/202610310004_car_catalog_schema.sql"
  );

  assert.ok(fs.existsSync(migrationPath), "Migration file must exist");

  const sql = fs.readFileSync(migrationPath, "utf8");

  // ตรวจสอบตารางและคอลัมน์
  assert.match(sql, /create table if not exists public\.car_brands/, "Must create car_brands");
  assert.match(sql, /create table if not exists public\.car_models/, "Must create car_models");
  assert.match(sql, /create table if not exists public\.car_parts/, "Must create car_parts");

  // ตรวจสอบ Foreign Keys & Constraints
  assert.match(sql, /references public\.car_brands\(id\) on delete cascade/, "car_models must reference car_brands cascade");
  assert.match(sql, /references public\.car_models\(id\) on delete cascade/, "car_parts must reference car_models cascade");

  // ตรวจสอบ RLS Policies
  assert.match(sql, /Public read car_brands/, "Must have public read for brands");
  assert.match(sql, /Public read car_models/, "Must have public read for models");
  assert.match(sql, /Public read car_parts/, "Must have public read for parts");
  assert.match(sql, /Admins can insert car_brands/, "Must have admin write for brands");
  assert.match(sql, /Admins can insert car_models/, "Must have admin write for models");
  assert.match(sql, /Admins can insert car_parts/, "Must have admin write for parts");
});


