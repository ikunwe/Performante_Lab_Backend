const { readFile, writeFile, mkdir } = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { gzipSync, gunzipSync } = require("node:zlib");
const { normalizeModels } = require("./lib/car-models");
const brands = require("../data/reference/car-brands.json").brands;
const folder = path.resolve(__dirname, "../data/models");
const revision = "ee99776470a45214bf524cdfe22e5dbf4bd67f93";
const base = `https://raw.githubusercontent.com/gor3a/vehicle-makes-models/${revision}/`;
const missing = new Set(["great-wall", "neta", "deepal", "jaecoo", "denza"]);
const hash = (body) => createHash("sha256").update(body).digest("hex");
async function main() {
  await mkdir(path.join(folder, "raw"), { recursive: true });
  const sources = [];
  const offlineManifest = process.argv.includes("--offline")
    ? JSON.parse(await readFile(path.join(folder, "raw/manifest.json"), "utf8"))
    : null;
  const catalog = [];
  // Bounded concurrency: download only selected makes, discard engines on normalization.
  for (let start = 0; start < brands.length; start += 4) {
    const batch = await Promise.all(
      brands.slice(start, start + 4).map(async (brand) => {
        let models = [];
        let sourceUrl = null;
        if (!missing.has(brand.id)) {
          const group = brand.id === "aion" ? "gac" : brand.id;
          sourceUrl = base + "data/json/" + group + ".json";
          const file = path.join(folder, "raw", group + ".json.gz");
          let bytes;
          if (process.argv.includes("--offline"))
            bytes = gunzipSync(await readFile(file));
          else {
            const response = await fetch(sourceUrl, {
              signal: AbortSignal.timeout(30000),
            });
            if (!response.ok)
              throw new Error(`${brand.id}: HTTP ${response.status}`);
            bytes = Buffer.from(await response.arrayBuffer());
            JSON.parse(bytes.toString("utf8"));
            await writeFile(file, gzipSync(bytes));
          }
          const data = JSON.parse(bytes.toString("utf8"));
          if (
            offlineManifest &&
            offlineManifest.find((entry) => entry.brandId === brand.id)
              ?.sha256 !== hash(bytes)
          )
            throw new Error("Snapshot checksum mismatch: " + brand.id);
          const make = data.makes.find(
            (make) =>
              make.name.toLowerCase() ===
              (brand.id === "aion" ? "gac" : brand.name).toLowerCase(),
          );
          if (!make) throw new Error("Source make mismatch: " + brand.id);
          models = make.models;
          if (brand.id === "aion")
            models = models
              .filter((model) => /^Aion /i.test(model.name))
              .map((model) => ({
                ...model,
                name: model.name.replace(/^Aion /i, ""),
              }));
          sources.push({
            brandId: brand.id,
            url: sourceUrl,
            sha256: hash(bytes),
            snapshot: "raw/" + group + ".json.gz",
          });
        }
        return {
          brandId: brand.id,
          brandName: brand.name,
          models: normalizeModels(brand.id, models, sourceUrl),
        };
      }),
    );
    catalog.push(...batch);
  }
  const supplements = JSON.parse(
    await readFile(path.join(folder, "official-models.json"), "utf8"),
  );
  for (const entry of supplements) {
    const target = catalog.find((brand) => brand.brandId === entry.brandId);
    if (!target) throw new Error("Supplement outside selected brands");
    const additions = normalizeModels(
      entry.brandId,
      entry.models,
      entry.sourceUrl,
    );
    for (const model of additions)
      if (
        !target.models.some(
          (existing) =>
            existing.name.toLowerCase() === model.name.toLowerCase(),
        )
      )
        target.models.push(model);
    target.models.sort((a, b) => a.name.localeCompare(b.name, "en"));
  }
  if (catalog.length !== 28 || catalog.some((brand) => !brand.models.length))
    throw new Error("Incomplete brand coverage");
  const dataset = {
    schemaVersion: 2,
    revision,
    license: "ODbL-1.0",
    attribution:
      "Adapted from gor3a/vehicle-makes-models and autoevolution.com; filtered to 28 brands, engines, generations, years and chassis data removed; official model names added. Not proof of Thai-market fitment.",
    repository: "https://github.com/gor3a/vehicle-makes-models",
    counts: {
      brands: catalog.length,
      models: catalog.reduce((total, brand) => total + brand.models.length, 0),
    },
    sources: sources.sort((a, b) => a.brandId.localeCompare(b.brandId)),
    brands: catalog,
  };
  await writeFile(
    path.join(folder, "car-models.json"),
    JSON.stringify(dataset, null, 2) + "\n",
  );
  await writeFile(
    path.join(folder, "raw/manifest.json"),
    JSON.stringify(dataset.sources, null, 2) + "\n",
  );
  for (const file of ["LICENSE-DATA", "README.md"]) {
    if (!process.argv.includes("--offline")) {
      const response = await fetch(base + file);
      if (!response.ok) throw new Error("Missing source notice");
      await writeFile(path.join(folder, "raw", file), await response.text());
    }
  }
  console.log(
    JSON.stringify(
      {
        counts: dataset.counts,
        coverage: catalog.map((brand) => ({
          brand: brand.brandName,
          models: brand.models.length,
        })),
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
