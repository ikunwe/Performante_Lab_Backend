require("dotenv").config({ quiet: true });
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createAdmin } = require("../src/config/supabase");
const dataset = require("../data/models/car-models.json");
const selectedIds = require("../data/reference/starter-brand-ids.json");
async function main() {
  assert.deepEqual(
    dataset.brands.map((brand) => brand.brandId).sort(),
    [...selectedIds].sort(),
  );
  const admin = createAdmin(process.env);
  if (!admin) throw new Error("Supabase backend configuration missing");
  const { data: existing, error } = await admin
    .from("car_brand_reference")
    .select("*")
    .in("id", selectedIds);
  if (error) throw new Error(error.message);
  assert.equal(existing.length, 28);
  console.log(JSON.stringify(dataset.counts));
  if (!process.argv.includes("--apply")) return;
  const folder = path.resolve(__dirname, "../tmp");
  await mkdir(folder, { recursive: true });
  const backup = path.join(folder, `before-model-import-${Date.now()}.json`);
  await writeFile(backup, JSON.stringify(existing, null, 2), { flag: "wx" });
  console.log("Backup: " + backup);
  for (const brand of dataset.brands) {
    const previous = existing.find((row) => row.id === brand.brandId);
    const modelCatalog = {
      schemaVersion: dataset.schemaVersion,
      revision: dataset.revision,
      license: dataset.license,
      attribution: dataset.attribution,
      repository: dataset.repository,
      ...brand,
    };
    const details = { ...previous.details, modelCatalog };
    const { error: updateError } = await admin
      .from("car_brand_reference")
      .update({ details })
      .eq("id", brand.brandId);
    if (updateError)
      throw new Error(
        `${brand.brandId}: ${updateError.message}; backup ${backup}`,
      );
    // Read back each write; a zero-row update must never be reported as imported.
    const { data: saved, error: readError } = await admin
      .from("car_brand_reference")
      .select("details")
      .eq("id", brand.brandId)
      .single();
    if (readError) throw new Error(readError.message);
    assert.deepEqual(saved.details.modelCatalog, modelCatalog);
  }
  console.log("Verified models in Supabase for all 28 brands.");
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
