require('dotenv').config({ quiet: true });
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createAdmin } = require('../src/config/supabase');
const dataset = require('../data/reference/car-brands.json');

async function readAll(admin) {
  const rows = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const { data, error } = await admin.from('car_brand_reference').select('*').order('id').range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  throw new Error('Catalog exceeds safety limit');
}

async function main() {
  const admin = createAdmin(process.env);
  if (!admin) throw new Error('Backend Supabase configuration is missing');
  const ids = dataset.brands.map((brand) => brand.id);
  assert.equal(ids.length, 28);
  assert.equal(new Set(ids).size, 28);
  const existing = await readAll(admin);
  const obsolete = existing.filter((row) => !ids.includes(row.id)).map((row) => row.id);
  console.log(JSON.stringify({ existing: existing.length, selected: ids.length, remove: obsolete.length }));
  if (!process.argv.includes('--apply')) return;

  // Save every original row before any remote write. Never touch auth or build tables.
  const folder = path.resolve(__dirname, '../tmp');
  await mkdir(folder, { recursive: true });
  const backup = path.join(folder, `car-brand-reference-backup-${Date.now()}.json`);
  await writeFile(backup, JSON.stringify({ savedAt: new Date().toISOString(), table: 'car_brand_reference', rows: existing }, null, 2), { flag: 'wx' });
  console.log(`Backup: ${backup}`);
  const rows = dataset.brands.map((brand) => ({ id: brand.id, slug: brand.slug, name: brand.name, details: { ...existing.find(row => row.id === brand.id)?.details, ...brand }, collected_at: dataset.collectedAt }));
  const { error } = await admin.from('car_brand_reference').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(error.message);
  // Remove only the IDs observed in the backed-up snapshot, never an unrestricted delete.
  for (let start = 0; start < obsolete.length; start += 100) {
    const { error: removalError } = await admin.from('car_brand_reference').delete().in('id', obsolete.slice(start, start + 100));
    if (removalError) throw new Error(`Removal failed; original rows are in ${backup}: ${removalError.message}`);
  }
  const result = await readAll(admin);
  assert.deepEqual(result.map((row) => row.id).sort(), [...ids].sort());
  for (const row of result) assert.equal(row.name, rows.find((brand) => brand.id === row.id).name);
  console.log(`Verified ${result.length} selected brands in Supabase.`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
